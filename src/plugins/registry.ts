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
    description: "状态、差异、提交、分支与远端。",
    icon: GitBranch,
    panel: GitPanel,
    fullHeight: true,
  },
  {
    id: "site",
    name: "发布",
    description: "文档范围、构建结果与静态发布。",
    icon: BookOpenCheck,
    panel: SitePanel,
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
    id: "store",
    name: "数据",
    description: "配置浏览、环境切换与远程同步。",
    icon: Database,
    panel: StorePanel,
    fullHeight: true,
  },
];
