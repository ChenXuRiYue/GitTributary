import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = resolve(root, "plugins");

function fail(message) {
  throw new Error(`[plugin:build] ${message}`);
}

function pluginPath(pluginRoot, value, label) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    fail(`${label} must be a non-empty relative path`);
  }
  const path = resolve(pluginRoot, ...value.split("/"));
  const fromRoot = relative(pluginRoot, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    fail(`${label} escapes the plugin directory: ${value}`);
  }
  return path;
}

function findProjectFile(pluginRoot, entry, filename, label) {
  let directory = dirname(pluginPath(pluginRoot, entry, label));
  while (directory.startsWith(pluginRoot)) {
    const candidate = resolve(directory, filename);
    if (existsSync(candidate)) return candidate;
    if (directory === pluginRoot) break;
    directory = dirname(directory);
  }
  fail(`${label} has no ${filename}: ${entry}`);
}

function run(command, args, pluginId) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`${pluginId} could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${pluginId} build failed with exit code ${result.status}`);
}

function buildPlugin(directory) {
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
    fail(`${manifest.id} must contribute at least one view`);
  }
  const frontendProjects = new Set(
    views.map((view, index) => findProjectFile(
      pluginRoot,
      view?.entry,
      "package.json",
      `${manifest.id} view[${index}].entry`,
    )),
  );
  for (const packageJson of frontendProjects) {
    console.log(`Building frontend for ${manifest.id}`);
    run(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", dirname(packageJson), "run", "build"], manifest.id);
  }

  if (manifest.backend !== undefined) {
    if (manifest.backend?.runtime !== "rust-cdylib") {
      fail(`${manifest.id} uses unsupported backend runtime: ${manifest.backend?.runtime}`);
    }
    const cargoToml = findProjectFile(
      pluginRoot,
      manifest.backend.entry,
      "Cargo.toml",
      `${manifest.id} backend.entry`,
    );
    console.log(`Building backend for ${manifest.id}`);
    run("cargo", ["build", "--release", "--manifest-path", cargoToml], manifest.id);
  }

  return true;
}

if (!existsSync(pluginsRoot)) fail("plugins directory does not exist");

const directories = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();
const count = directories.reduce(
  (total, directory) => total + (buildPlugin(directory) ? 1 : 0),
  0,
);
if (count === 0) fail("no plugins/*/manifest.json files were found");
console.log(`Built ${count} plugin(s) from plugins/`);
