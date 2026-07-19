import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/** Core 模块分组：main = 主导航；system = 底部固定系统入口。 */
export type CoreModuleGroup = "main" | "system";

/** 随主应用编译的 Core 模块，区别于运行时安装的插件。 */
export interface CoreModuleDescriptor {
  /** 唯一标识 */
  id: string;
  /** 侧边栏与面板标题展示的名称 */
  name: string;
  /** 简短描述，展示在面板顶部 */
  description: string;
  /** 侧边栏图标（lucide 图标组件） */
  icon: LucideIcon;
  /** 右侧操作面板组件 */
  panel: ComponentType;
  /** 分区归属，缺省视为主导航模块。 */
  group?: CoreModuleGroup;
  /** 是否使用完整高度渲染，跳过通用标题和内容滚动容器。 */
  fullHeight?: boolean;
  /**
   * 是否固定展示在侧边栏中。
   * true(默认):直接显示
   * false:归入 「...」折叠区
   */
  pinned?: boolean;
}
