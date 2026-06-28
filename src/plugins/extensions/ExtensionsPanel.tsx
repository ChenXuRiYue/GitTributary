import { useState } from "react";
import {
  Bot,
  Brush,
  Database,
  PackageSearch,
  PanelsTopLeft,
  PlugZap,
  Puzzle,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ExtensionPluginSeries } from "../types";

type ExtensionViewKind = "market" | "panel" | `plugin:${ExtensionPluginSeries}`;

interface ExtensionPluginDescriptor {
  id: ExtensionPluginSeries;
  name: string;
  summary: string;
  icon: LucideIcon;
  examples: string[];
  pluginCount: number;
}

interface MarketPluginDescriptor {
  id: string;
  name: string;
  summary: string;
  series: ExtensionPluginSeries;
  icon: LucideIcon;
  tags: string[];
}

const extensionPlugins: ExtensionPluginDescriptor[] = [
  {
    id: "productivity",
    name: "效率",
    summary: "笔记处理、提交辅助、批量整理等日常高频能力。",
    icon: Puzzle,
    examples: ["提交信息生成", "笔记清理", "待办同步"],
    pluginCount: 0,
  },
  {
    id: "automation",
    name: "自动",
    summary: "定时任务、事件触发、工作区自动编排能力。",
    icon: Workflow,
    examples: ["定时备份", "文件监听", "发布流水线"],
    pluginCount: 0,
  },
  {
    id: "data",
    name: "知识",
    summary: "索引、统计、知识库加工和跨 Profile 数据视图。",
    icon: Database,
    examples: ["复习索引", "仓库洞察", "知识图谱"],
    pluginCount: 0,
  },
  {
    id: "integration",
    name: "集成",
    summary: "连接外部仓库、云端服务、通知和协作系统。",
    icon: PlugZap,
    examples: ["Webhook", "云盘同步", "消息通知"],
    pluginCount: 0,
  },
  {
    id: "ai",
    name: "AI",
    summary: "上下文生成、语义检索、审查与自动补全能力。",
    icon: Bot,
    examples: ["Diff 审查", "摘要生成", "语义搜索"],
    pluginCount: 0,
  },
  {
    id: "theme",
    name: "主题",
    summary: "主题包、面板布局、图标和展示风格拓展。",
    icon: Brush,
    examples: ["主题包", "图标包", "面板模板"],
    pluginCount: 0,
  },
];

const marketPlugins: MarketPluginDescriptor[] = [
  {
    id: "commit-writer",
    name: "提交助手",
    summary: "根据变更生成提交信息，并按项目规范补充摘要。",
    series: "productivity",
    icon: Puzzle,
    tags: ["Git", "效率"],
  },
  {
    id: "daily-backup",
    name: "定时备份",
    summary: "按时间窗口检测仓库变更，自动提交并可选推送。",
    series: "automation",
    icon: Workflow,
    tags: ["自动化", "备份"],
  },
  {
    id: "diff-review",
    name: "Diff 审查",
    summary: "围绕本次变更做风险扫描、摘要和修复建议。",
    series: "ai",
    icon: Bot,
    tags: ["AI", "审查"],
  },
];

function pluginViewId(id: ExtensionPluginSeries): ExtensionViewKind {
  return `plugin:${id}`;
}

function seriesLabel(id: ExtensionPluginSeries) {
  return extensionPlugins.find((plugin) => plugin.id === id)?.name ?? id;
}

function countLabel(count: number) {
  return count > 0 ? `${count} 个插件` : "预留";
}

function NavButton({
  id,
  name,
  icon: Icon,
  active,
  onSelect,
}: {
  id: ExtensionViewKind;
  name: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: (id: ExtensionViewKind) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(id)}
          aria-label={name}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg transition-all",
            active
              ? "bg-primary/10 text-primary shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {name}
      </TooltipContent>
    </Tooltip>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <header className="border-border flex shrink-0 flex-col gap-1 border-b px-7 py-4">
      <div className="flex items-center gap-2">
        <Icon className="text-primary size-[18px]" />
        <h2 className="gt-title-app">{title}</h2>
      </div>
      <p className="gt-caption text-muted-foreground">{description}</p>
    </header>
  );
}

function MarketView() {
  return (
    <>
      <PanelHeader
        icon={PackageSearch}
        title="市场"
        description="发现并安装新的拓展插件。"
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative min-w-0 flex-1">
                <PackageSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-9 text-sm"
                  placeholder="搜索插件..."
                  disabled
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {extensionPlugins.map((plugin) => (
                  <Badge key={plugin.id} variant="outline" className="h-7 px-2">
                    {plugin.name}
                  </Badge>
                ))}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {marketPlugins.map((plugin) => {
              const Icon = plugin.icon;
              return (
                <div key={plugin.id} className="flex min-h-36 flex-col gap-3 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
                        <Icon className="size-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <div className="gt-body-strong truncate">{plugin.name}</div>
                        <div className="gt-caption text-muted-foreground">可安装</div>
                      </div>
                    </div>
                    <Badge variant="outline">{seriesLabel(plugin.series)}</Badge>
                  </div>
                  <p className="gt-caption min-h-9 text-muted-foreground">{plugin.summary}</p>
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {plugin.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="h-5 px-1.5 text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <Button size="sm" disabled>安装</Button>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </ScrollArea>
    </>
  );
}

function PluginPanelView() {
  return (
    <>
      <PanelHeader
        icon={PanelsTopLeft}
        title="面板"
        description="当前拓展插件的统一面板入口。"
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-7 py-6">
          <section className="rounded-lg border bg-card p-5">
            <div className="gt-title-panel">当前插件栏</div>
            <p className="gt-body mt-2 text-muted-foreground">
              二级侧边栏横线下方展示当前可用拓展。后续每个拓展都可以单独挂载自己的面板。
            </p>
          </section>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {extensionPlugins.map((plugin) => {
              const Icon = plugin.icon;
              return (
                <div key={plugin.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <Icon className="text-muted-foreground size-4" />
                    <div className="gt-body-strong">{plugin.name}</div>
                    <Badge variant="outline" className="ml-auto">{countLabel(plugin.pluginCount)}</Badge>
                  </div>
                  <p className="gt-caption mt-2 text-muted-foreground">{plugin.summary}</p>
                </div>
              );
            })}
          </section>
        </div>
      </ScrollArea>
    </>
  );
}

function PluginDetailView({ plugin }: { plugin: ExtensionPluginDescriptor }) {
  const Icon = plugin.icon;

  return (
    <>
      <PanelHeader
        icon={Icon}
        title={plugin.name}
        description={plugin.summary}
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-7 py-6">
          <section className="rounded-lg border bg-card">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="gt-title-panel">{plugin.name}</h3>
                  <p className="gt-body mt-1 text-muted-foreground">{plugin.summary}</p>
                </div>
              </div>
              <Badge variant="secondary">plugin.{plugin.id}</Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
              {plugin.examples.map((example) => (
                <div key={example} className="rounded-lg border bg-background p-3">
                  <div className="gt-body-strong">{example}</div>
                  <div className="gt-caption mt-1 text-muted-foreground">插件槽位</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>
    </>
  );
}

function resolveActivePanel(activeId: ExtensionViewKind): ComponentType | null {
  if (activeId === "market") return MarketView;
  if (activeId === "panel") return PluginPanelView;
  return null;
}

export function ExtensionsPanel() {
  const [activeId, setActiveId] = useState<ExtensionViewKind>("market");
  const ActivePanel = resolveActivePanel(activeId);
  const activePlugin = extensionPlugins.find((plugin) => pluginViewId(plugin.id) === activeId);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
        <nav className="flex flex-col items-center gap-1">
          <NavButton
            id="market"
            name="插件市场"
            icon={PackageSearch}
            active={activeId === "market"}
            onSelect={setActiveId}
          />
          <NavButton
            id="panel"
            name="插件面板"
            icon={PanelsTopLeft}
            active={activeId === "panel"}
            onSelect={setActiveId}
          />

          <div className="my-1 h-px w-5 bg-border/50" />

          {extensionPlugins.map((plugin) => (
            <NavButton
              key={plugin.id}
              id={pluginViewId(plugin.id)}
              name={plugin.name}
              icon={plugin.icon}
              active={activeId === pluginViewId(plugin.id)}
              onSelect={setActiveId}
            />
          ))}
        </nav>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {ActivePanel ? <ActivePanel /> : activePlugin ? <PluginDetailView plugin={activePlugin} /> : null}
      </div>
    </div>
  );
}
