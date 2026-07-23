import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = resolve(root, "src-tauri");
const rustcInfo = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const host = rustcInfo.match(/^host:\s+(.+)$/m)?.[1]?.trim();

if (!host) {
  throw new Error("Unable to determine the Rust host target triple");
}

execFileSync(
  "cargo",
  ["build", "--release", "--manifest-path", resolve(tauriDir, "Cargo.toml"), "-p", "na-plugin-host"],
  { cwd: root, stdio: "inherit" },
);

const extension = process.platform === "win32" ? ".exe" : "";
const source = resolve(tauriDir, "target", "release", `na-plugin-host${extension}`);
const bundleDir = resolve(tauriDir, "binaries");
const bundleTarget = resolve(bundleDir, `na-plugin-host-${host}${extension}`);
const developmentTarget = resolve(tauriDir, "target", "debug", `na-plugin-host${extension}`);

mkdirSync(bundleDir, { recursive: true });
mkdirSync(dirname(developmentTarget), { recursive: true });
copyFileSync(source, bundleTarget);
copyFileSync(source, developmentTarget);

console.log(`Prepared na-plugin-host for ${host}`);
