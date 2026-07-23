import { Blocks, GitBranch, Settings, Workflow } from "lucide-react";

import type { CoreModuleDescriptor } from "./types";
import { FlowPanel } from "@/modules/flow/FlowPanel";
import { GitPanel } from "@/modules/git/GitPanel";
import { PluginManagerPanel } from "@/modules/plugin-manager/PluginManagerPanel";
import { SettingsPanel } from "@/modules/settings/SettingsPanel";

/** Core 模块注册表。这里的功能随主应用编译，不属于可安装插件。 */
export const coreModules: CoreModuleDescriptor[] = [
  {
    id: "git",
    name: "Git",
    description: "状态、差异、提交、分支与远端。",
    icon: GitBranch,
    panel: GitPanel,
    fullHeight: true,
  },
  {
    id: "flow",
    name: "Flow",
    description: "事件、节点与任务编排。",
    icon: Workflow,
    panel: FlowPanel,
    fullHeight: true,
  },
  {
    id: "plugins",
    name: "插件",
    description: "安装、更新和管理随应用提供的插件。",
    icon: Blocks,
    panel: PluginManagerPanel,
    group: "system",
    navigationKind: "function",
    fullHeight: true,
  },
  {
    id: "settings",
    name: "设置",
    description: "管理数据同步、界面与应用行为。",
    icon: Settings,
    panel: SettingsPanel,
    group: "system",
    navigationKind: "function",
    canHide: false,
    fullHeight: true,
  },
];
