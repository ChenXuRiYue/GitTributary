import {
  Bot,
  ChartNoAxesColumnIncreasing,
  Code2,
  Database,
  Globe,
  Paperclip,
  Puzzle,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const extensionIcons: Record<string, LucideIcon> = {
  bot: Bot,
  chart: ChartNoAxesColumnIncreasing,
  code: Code2,
  database: Database,
  globe: Globe,
  paperclip: Paperclip,
  search: Search,
  send: Send,
  settings: Settings2,
  shield: ShieldCheck,
  terminal: Terminal,
  wand: WandSparkles,
  workflow: Workflow,
};

const legacyPluginIcons: Record<string, LucideIcon> = {
  "dev.gittributary.attachment-manager": Paperclip,
  "dev.gittributary.site-publisher": Send,
};

/** Resolve manifest icons, while keeping old installed plugin versions distinct. */
export function resolveExtensionIcon(
  value: string | null | undefined,
  pluginId?: string,
): LucideIcon {
  const name = value?.startsWith("lucide:") ? value.slice("lucide:".length) : null;
  if (name && extensionIcons[name]) return extensionIcons[name];
  if (pluginId && legacyPluginIcons[pluginId]) return legacyPluginIcons[pluginId];
  return Puzzle;
}
