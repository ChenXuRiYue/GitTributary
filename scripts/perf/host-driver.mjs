import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PROTOCOL_VERSION = 1;

export class HostDriver {
  constructor(hostPath, { cwd = process.cwd(), timeoutMs = 10_000 } = {}) {
    this.hostPath = hostPath;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.requests = new Map();
    this.nextRequestId = 1;
    this.stderr = "";
    this.hello = null;
    this.helloElapsedMs = null;
  }

  async start() {
    if (this.child) throw new Error("plugin host is already running");
    const started = process.hrtime.bigint();
    const child = spawn(this.hostPath, [], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });

    const helloPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for host hello")), this.timeoutMs);
      this.resolveHello = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.rejectHello = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });

    child.once("error", (error) => this.rejectAll(error));
    child.once("exit", (code, signal) => {
      const detail = this.stderr.trim();
      const error = new Error(
        `plugin host exited before request completion (code=${code}, signal=${signal})${detail ? `: ${detail}` : ""}`,
      );
      this.rejectAll(error);
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));

    try {
      this.hello = await helloPromise;
      this.helloElapsedMs = elapsedMs(started);
      return this.hello;
    } catch (error) {
      await this.terminate();
      throw error;
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.rejectAll(new Error(`host emitted invalid JSON: ${error.message}`));
      return;
    }
    if (message.type === "event" && message.event === "hello" && this.resolveHello) {
      const resolve = this.resolveHello;
      this.resolveHello = null;
      this.rejectHello = null;
      resolve(message);
      return;
    }
    if (message.type !== "response" || typeof message.id !== "string") return;
    const pending = this.requests.get(message.id);
    if (!pending) return;
    this.requests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(message.error.message ?? "plugin host RPC failed");
      error.code = message.error.code;
      error.data = message.error.data;
      pending.reject(error);
    } else {
      pending.resolve(message.result ?? null);
    }
  }

  async request(method, params = {}, timeoutMs = this.timeoutMs) {
    if (!this.child?.stdin?.writable) throw new Error("plugin host is not writable");
    const id = `perf-${this.nextRequestId++}`;
    const message = {
      type: "request",
      protocolVersion: PROTOCOL_VERSION,
      id,
      method,
      params,
    };
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`host request timed out: ${method}`));
      }, timeoutMs);
      this.requests.set(id, { resolve, reject, timer });
    });
    await new Promise((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => error ? reject(error) : resolve());
    });
    return response;
  }

  async rssBytes() {
    const sample = await this.rssSample();
    return sample.status === "ok" ? sample.bytes : null;
  }

  async rssSample() {
    if (!this.child?.pid) return null;
    if (process.platform !== "darwin" && process.platform !== "linux") {
      return { status: "unsupported", bytes: null, platform: process.platform };
    }
    try {
      const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(this.child.pid)], {
        encoding: "utf8",
      });
      const kibibytes = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(kibibytes)) {
        return { status: "error", bytes: null, message: `invalid ps RSS output: ${stdout.trim()}` };
      }
      return { status: "ok", bytes: kibibytes * 1024, source: "ps" };
    } catch (error) {
      return {
        status: "error",
        bytes: null,
        source: "ps",
        message: error?.message ?? String(error),
      };
    }
  }

  async close() {
    if (!this.child) return;
    const child = this.child;
    try {
      await this.request("shutdown", {}, 2_000);
    } catch {
      // The benchmark still owns and terminates the child below.
    }
    child.stdin.end();
    await waitForExit(child, 2_000);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    this.child = null;
  }

  async terminate() {
    if (!this.child) return;
    const child = this.child;
    child.kill();
    await waitForExit(child, 1_000);
    this.child = null;
  }

  rejectAll(error) {
    if (this.rejectHello) {
      this.rejectHello(error);
      this.resolveHello = null;
      this.rejectHello = null;
    }
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.requests.clear();
  }
}

export async function measureRequest(driver, method, params = {}, timeoutMs) {
  const started = process.hrtime.bigint();
  const result = await driver.request(method, params, timeoutMs);
  return { elapsedMs: elapsedMs(started), result };
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
