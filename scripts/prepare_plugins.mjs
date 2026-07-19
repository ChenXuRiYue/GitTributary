import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = resolve(root, "plugins");
const resourcesRoot = resolve(root, "src-tauri", "resources");
const destination = resolve(resourcesRoot, "plugins");
const staging = resolve(resourcesRoot, ".plugins-staging");

function fail(message) {
  throw new Error(`[plugin:bundle:prepare] ${message}`);
}

function relativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    fail(`${label} must be a non-empty relative path`);
  }
  if (value.includes("\\")) {
    fail(`${label} must use forward slashes: ${value}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    fail(`${label} contains an invalid path segment: ${value}`);
  }
  return value;
}

function sourcePath(pluginRoot, value, label, expectedType) {
  const normalized = relativePath(value, label);
  const path = resolve(pluginRoot, ...normalized.split("/"));
  const fromRoot = relative(pluginRoot, path);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    fail(`${label} escapes the plugin directory: ${value}`);
  }
  if (!existsSync(path)) {
    fail(`${label} does not exist: ${value}`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    fail(`${label} cannot be a symbolic link: ${value}`);
  }
  if (expectedType === "file" && !stat.isFile()) {
    fail(`${label} must be a file: ${value}`);
  }
  if (expectedType === "directory" && !stat.isDirectory()) {
    fail(`${label} must be a directory: ${value}`);
  }
  return { normalized, path };
}

function copyPath(source, pluginRoot, outputRoot) {
  const target = resolve(outputRoot, relative(pluginRoot, source));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, errorOnExist: false, force: true });
}

function nativeLibraryName(library) {
  if (typeof library !== "string" || !/^[A-Za-z0-9_-]+$/.test(library)) {
    fail(`backend.library is invalid: ${String(library)}`);
  }
  if (process.platform === "win32") return `${library}.dll`;
  if (process.platform === "darwin") return `lib${library}.dylib`;
  return `lib${library}.so`;
}

function preparePlugin(directory) {
  const pluginRoot = resolve(pluginsRoot, directory);
  const manifestPath = resolve(pluginRoot, "manifest.json");
  if (!existsSync(manifestPath)) return false;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`${directory}/manifest.json is invalid JSON: ${error.message}`);
  }

  if (typeof manifest.id !== "string" || manifest.id.length === 0) {
    fail(`${directory}/manifest.json is missing id`);
  }
  const views = manifest.contributes?.views;
  if (!Array.isArray(views) || views.length === 0) {
    fail(`${directory}/manifest.json must contribute at least one view`);
  }

  const outputRoot = resolve(staging, directory);
  mkdirSync(outputRoot, { recursive: true });
  cpSync(manifestPath, resolve(outputRoot, "manifest.json"));

  const buildDirectories = new Set();
  for (const [index, view] of views.entries()) {
    const entry = sourcePath(
      pluginRoot,
      view?.entry,
      `${directory} view[${index}].entry`,
      "file",
    );
    const buildDirectory = dirname(entry.path);
    if (buildDirectory === pluginRoot) {
      fail(`${directory} view[${index}].entry must be inside a build directory`);
    }
    buildDirectories.add(buildDirectory);

    if (view.icon !== undefined) {
      const icon = sourcePath(
        pluginRoot,
        view.icon,
        `${directory} view[${index}].icon`,
        "file",
      );
      copyPath(icon.path, pluginRoot, outputRoot);
    }
  }
  for (const buildDirectory of buildDirectories) {
    sourcePath(
      pluginRoot,
      relative(pluginRoot, buildDirectory).split(sep).join("/"),
      `${directory} view build directory`,
      "directory",
    );
    copyPath(buildDirectory, pluginRoot, outputRoot);
  }

  if (manifest.backend !== undefined) {
    if (manifest.backend?.runtime !== "rust-cdylib") {
      fail(`${directory} uses unsupported backend runtime: ${manifest.backend?.runtime}`);
    }
    const entry = relativePath(manifest.backend.entry, `${directory} backend.entry`);
    const library = `${entry}/${nativeLibraryName(manifest.backend.library)}`;
    const backend = sourcePath(pluginRoot, library, `${directory} backend library`, "file");
    copyPath(backend.path, pluginRoot, outputRoot);
  }

  console.log(`Bundled plugin ${manifest.id} from plugins/${directory}`);
  return true;
}

if (!existsSync(pluginsRoot)) {
  fail("plugins directory does not exist");
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

try {
  const directories = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const count = directories.reduce(
    (total, directory) => total + (preparePlugin(directory) ? 1 : 0),
    0,
  );
  if (count === 0) {
    fail("no plugins/*/manifest.json files were found");
  }

  rmSync(destination, { recursive: true, force: true });
  renameSync(staging, destination);
  console.log(`Prepared ${count} plugin(s) in src-tauri/resources/plugins`);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  throw error;
}
