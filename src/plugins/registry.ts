import { BookOpenCheck, GitBranch, Database, Workflow } from "lucide-react";

import type { ModuleDescriptor } from "./types";
import { FlowPanel } from "./flow/FlowPanel";
import { GitPanel } from "./git/GitPanel";
import { SitePanel } from "./site/SitePanel";
import { StorePanel } from "./store/StorePanel";

/** 模块注册表。侧边栏与内容区会按这里的描述自动渲染。 */
export const modules: ModuleDescriptor[] = [
  {
    id: "git",
    name: "Git",
    description: "仓库状态、变更管理与提交 —— 平台级 Git 基础能力。",
    icon: GitBranch,
    panel: GitPanel,
    fullHeight: true,
  },
  {
    id: "site",
    name: "文档发布",
    description: "捕捉仓库文档,构建阅读页并发布到 Pages。",
    icon: BookOpenCheck,
    panel: SitePanel,
    fullHeight: true,
  },
  {
    id: "flow",
    name: "流",
    description: "事件触发、自动化与任务编排。",
    icon: Workflow,
    panel: FlowPanel,
    fullHeight: true,
  },
  {
    id: "store",
    name: "数据",
    description: "统一配置管理 — 所有配置项的可视化浏览与 Profile 切换。",
    icon: Database,
    panel: StorePanel,
    fullHeight: true,
  },
];
