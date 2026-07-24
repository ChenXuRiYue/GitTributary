import {
  FileStack,
  GitBranch,
  History,
} from "lucide-react";

import type { GitViewDescriptor } from "./types";
import { ChangesView } from "./views/ChangesView";
import { BranchesView } from "./views/BranchesView";
import { HistoryView } from "./views/HistoryView";

/**
 * Git 二级视图注册表。
 * pinned: true(默认) → 固定展示在二级栏
 * pinned: false → 归入 "..." 折叠区
 */
export const gitViews: GitViewDescriptor[] = [
  {
    id: "changes",
    name: "变更",
    icon: FileStack,
    panel: ChangesView,
    pinned: true,
  },
  {
    id: "branches",
    name: "分支",
    icon: GitBranch,
    panel: BranchesView,
    pinned: false,
  },
  {
    id: "history",
    name: "历史",
    icon: History,
    panel: HistoryView,
    pinned: true,
  },
];
