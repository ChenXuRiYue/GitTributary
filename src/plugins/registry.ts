import { Boxes, GitBranch, Database, Settings, Workflow } from "lucide-react";

import type { PluginDescriptor } from "./types";
import { SettingsPanel } from "./panels";
import { ExtensionsPanel } from "./extensions/ExtensionsPanel";
import { FlowPanel } from "./flow/FlowPanel";
import { GitPanel } from "./git/GitPanel";
import { StorePanel } from "./store/StorePanel";

/**
 * 插件注册表。后续新增功能只需往这里追加一个描述对象，
 * 侧边栏与内容区会自动渲染，无需改动 shell 布局。
 */
export const plugins: PluginDescriptor[] = [
  {
    id: "git",
    name: "Git",
    description: "仓库状态、变更管理与提交 —— 平台级 Git 基础能力。",
    icon: GitBranch,
    panel: GitPanel,
  },
  {
    id: "flow",
    name: "流",
    description: "事件触发、自动化与任务编排。",
    icon: Workflow,
    panel: FlowPanel,
  },
  {
    id: "store",
    name: "数据",
    description: "统一配置管理 — 所有配置项的可视化浏览与 Profile 切换。",
    icon: Database,
    panel: StorePanel,
  },
  {
    id: "extensions",
    name: "拓展",
    description: "二级拓展类插件分组，为后续插件市场预留入口。",
    icon: Boxes,
    panel: ExtensionsPanel,
  },
  {
    id: "settings",
    name: "设置",
    description: "通用、安全与插件管理。",
    icon: Settings,
    panel: SettingsPanel,
    category: "system",
  },
];

/** 上部扩展插件区（可选安装的功能插件） */
export const extensionPlugins = plugins.filter(
  (p) => (p.category ?? "extension") === "extension",
);

/** 底部固定系统按钮区（设置等系统功能） */
export const systemPlugins = plugins.filter((p) => p.category === "system");
