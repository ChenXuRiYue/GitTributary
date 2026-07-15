import { Radio, Split, Workflow } from "lucide-react";

import type { NavItem } from "@/components/IconNav";

/** Flow 二级视图注册表，与 Git 插件使用相同的导航注册模式。 */
export const flowNavItems: NavItem[] = [
  { id: "flows", name: "编排", icon: Workflow },
  { id: "events", name: "事件", icon: Radio },
  { id: "nodes", name: "节点", icon: Split },
];
