import {
  FileStack,
  GitBranch,
  Upload,
  History,
  Timer,
  Shield,
} from "lucide-react";

import type { GitViewDescriptor } from "./types";
import { ChangesView } from "./views/ChangesView";
import { BranchesView } from "./views/BranchesView";
import { RemoteView } from "./views/RemoteView";
import { HistoryView } from "./views/HistoryView";
import { AutoView } from "./views/AutoView";
import { SafetyView } from "./views/SafetyView";

/**
 * Git 二级视图注册表。
 * 新增 Git 操作视图只需往数组追加一个对象,
 * 二级侧边栏与内容区自动渲染。
 */
export const gitViews: GitViewDescriptor[] = [
  {
    id: "changes",
    name: "变更",
    icon: FileStack,
    panel: ChangesView,
  },
  {
    id: "branches",
    name: "分支",
    icon: GitBranch,
    panel: BranchesView,
  },
  {
    id: "remote",
    name: "远程",
    icon: Upload,
    panel: RemoteView,
  },
  {
    id: "history",
    name: "历史",
    icon: History,
    panel: HistoryView,
  },
  {
    id: "auto",
    name: "自动",
    icon: Timer,
    panel: AutoView,
  },
  {
    id: "safety",
    name: "安全",
    icon: Shield,
    panel: SafetyView,
  },
];
