import { Braces, List, ListTree, Settings2 } from "lucide-react";

import type { NavItem } from "@/components/IconNav";
import type { ViewMode } from "./types";

export const VIEW_MODES: Array<{
  id: ViewMode;
  label: string;
  title: string;
  icon: typeof List;
}> = [
  { id: "compact", label: "当前", title: "当前紧凑展示", icon: List },
  { id: "tree", label: "树形", title: "按点分 key 展开为 YAML 风格树", icon: ListTree },
  { id: "json", label: "JSON", title: "按 JSON 结构展开", icon: Braces },
];

export const STORE_NAV_ITEMS: NavItem[] = [
  { id: "detail", name: "配置", icon: Settings2 },
];

export const DEFAULT_VIEW_MODE = VIEW_MODES[0].id;
export const STORE_VIEW_STATE_NS = "ui-state";
export const STORE_VIEW_STATE_KEY = "store.view.active";
export const STORE_MORE_STATE_KEY = "store.nav.more.open";
export const STORE_DOMAIN_WIDTH_KEY = "store.domain.width";
export const STORE_VIEW_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const STORE_DOMAIN_MIN_WIDTH = 160;
export const STORE_DOMAIN_DEFAULT_WIDTH = 208;
