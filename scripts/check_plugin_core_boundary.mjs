import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = resolve(root, "plugins");
const forbiddenPackages = [
  "na-git",
  "na-files",
  "na-data",
  "na-flow",
  "na-plugin-host",
  "na-plugin-protocol",
];

function cargoManifests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["target", "node_modules", ".git"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return cargoManifests(path);
    return entry.isFile() && entry.name === "Cargo.toml" ? [path] : [];
  });
}

const violations = [];
for (const manifest of cargoManifests(pluginsRoot)) {
  const source = readFileSync(manifest, "utf8");
  if (source.includes("src-tauri/crates")) {
    violations.push(`${relative(root, manifest)} references src-tauri/crates`);
  }
  for (const packageName of forbiddenPackages) {
    const dependency = new RegExp(`^\\s*${packageName}\\s*=`, "m");
    const renamedDependency = new RegExp(`package\\s*=\\s*["']${packageName}["']`);
    if (dependency.test(source) || renamedDependency.test(source)) {
      violations.push(`${relative(root, manifest)} depends on internal package ${packageName}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Plugin/core boundary violations:\n${violations.join("\n")}`);
}

console.log("Plugin manifests depend only on public protocols and plugin-local libraries.");
