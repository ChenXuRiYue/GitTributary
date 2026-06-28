import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/** 插件分类：extension = 可扩展/可选安装的功能插件；system = 固定的系统功能 */
export type PluginCategory = "extension" | "system";

/**
 * 拓展插件二级分类。
 * 用于插件市场/插件系列中继续区分安装包形态和能力域。
 */
export type ExtensionPluginSeries =
  | "productivity"
  | "automation"
  | "data"
  | "integration"
  | "ai"
  | "theme";

/**
 * 插件描述。后续每个功能（备份、复习、AI 等）都以插件形式注册，
 * 侧边栏据此渲染按钮，内容区据此渲染对应面板。
 */
export interface PluginDescriptor {
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
  /**
   * 分区归属。
   * - extension：上部「扩展插件区」，后续支持可选安装
   * - system：底部固定「系统按钮区」，如设置
   * 缺省视为 extension。
   */
  category?: PluginCategory;
  /**
   * 拓展类插件的二级分类。
   * 内置平台级插件可不填；插件市场条目用该字段进入二级分组。
   */
  extensionSeries?: ExtensionPluginSeries;
  /**
   * 是否固定展示在侧边栏中。
   * true(默认):直接显示
   * false:归入 「...」折叠区
   */
  pinned?: boolean;
}
