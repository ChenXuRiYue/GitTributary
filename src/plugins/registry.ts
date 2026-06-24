import { GitBranch, Brain, Sparkles, Database, Settings } from "lucide-react";

import type { PluginDescriptor } from "./types";
import {
  AiPanel,
  DatabasePanel,
  ReviewPanel,
  SettingsPanel,
} from "./panels";
import { GitPanel } from "./git/GitPanel";

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
    id: "review",
    name: "复习",
    description: "基于遗忘曲线的个人脑库与当周复习导出。",
    icon: Brain,
    panel: ReviewPanel,
  },
  {
    id: "ai",
    name: "AI",
    description: "博学、富有洞察力的笔记助手。",
    icon: Sparkles,
    panel: AiPanel,
  },
  {
    id: "database",
    name: "数据库",
    description: "为笔记库 + AI 而生的数据视图与标签管理。",
    icon: Database,
    panel: DatabasePanel,
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
