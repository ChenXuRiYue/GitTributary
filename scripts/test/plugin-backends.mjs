import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const LEGACY_SUITES = {
  "attachment-manager": {
    id: "plugins-attachment",
    label: "Attachment manager plugin",
  },
  "site-publisher": {
    id: "plugins-site",
    label: "Site publisher plugins",
  },
};

export function discoverPluginBackends(root) {
  const pluginsDirectory = path.join(root, "plugins");
  if (!existsSync(pluginsDirectory)) return [];

  return readdirSync(pluginsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(pluginsDirectory, entry.name, "backend", "Cargo.toml");
      if (!existsSync(manifestPath)) return null;
      const legacy = LEGACY_SUITES[entry.name];
      return {
        directory: entry.name,
        id: legacy?.id ?? `plugins-${entry.name}`,
        label: legacy?.label ?? `${entry.name} plugin`,
        manifest: path.relative(root, manifestPath).split(path.sep).join("/"),
      };
    })
    .filter(Boolean);
}
