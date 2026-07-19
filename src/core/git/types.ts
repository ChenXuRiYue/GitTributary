import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/** Git 二级视图描述 */
export interface GitViewDescriptor {
  /** 唯一标识 */
  id: string;
  /** tooltip 名称 */
  name: string;
  /** 二级栏图标 */
  icon: LucideIcon;
  /** 内容区组件 */
  panel: ComponentType;
  /**
   * 是否固定展示在二级栏中。
   * true(默认):直接显示图标
   * false:归入 「...」折叠区,点击后才展开
   */
  pinned?: boolean;
}
