import type { EventDefinition } from "../types";

export function eventDomainMeta(domain: string) {
  switch (domain) {
    case "app":
      return {
        label: "应用",
        summary: "NoteAura 应用生命周期事件域。",
        description: "用于描述应用启动、关闭、恢复、初始化完成等全局生命周期信号。这个域适合承载启动后检查、会话恢复、全局状态初始化和应用级通知触发。",
      };
    case "ui":
      return {
        label: "界面",
        summary: "用户界面与人工操作事件域。",
        description: "用于描述用户主动发起的操作,例如手动运行 Flow、命令面板触发、后续按钮或交互入口触发。这个域强调人为意图,通常会携带 inputs。",
      };
    case "git":
      return {
        label: "Git",
        summary: "Git 仓库操作与状态变化事件域。",
        description: "用于描述仓库打开、提交创建、推送完成、拉取完成、分支变化等 Git 相关信号。这个域是笔记仓库自动化的主要入口,适合触发备份、同步、检查和发布类 Flow。",
      };
    case "store":
      return {
        label: "数据中心",
        summary: "NoteAura 数据中心配置变化事件域。",
        description: "用于描述公共配置、工作区状态、模块配置等数据中心 key 的变化。private 和 secrets 类命名空间默认不进入该域事件,避免敏感信息外泄。",
      };
    case "flow":
      return {
        label: "Flow",
        summary: "Flow 运行生命周期事件域。",
        description: "用于描述 Flow 自身的 queued、started、succeeded、failed、skipped 等运行结果。这个域用于串联 Flow、构建失败恢复链路和展示自动化运行状态。",
      };
    default:
      return {
        label: domain,
        summary: "自定义事件域。",
        description: "当前事件域未登记内置说明。后续如果该域成为稳定能力,应补充域定位、事件来源、权限边界和典型触发场景。",
      };
  }
}

export function eventDomainText(domain: string) {
  return eventDomainMeta(domain).label;
}

export function eventStabilityTone(stability: string) {
  switch (stability) {
    case "stable":
      return "border-green-200 bg-green-50 text-green-700";
    case "deprecated":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function groupEventsByDomain(events: EventDefinition[]) {
  return events.reduce<Record<string, EventDefinition[]>>((groups, event) => {
    const key = event.domain || "unknown";
    groups[key] = groups[key] ?? [];
    groups[key].push(event);
    return groups;
  }, {});
}

export function sortedEvents(events: EventDefinition[]) {
  return events
    .slice()
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.type.localeCompare(b.type));
}

export function eventSearchText(event: EventDefinition) {
  return [
    event.type,
    event.source,
    event.domain,
    event.summary,
    event.description,
    event.trigger_description,
    event.stability,
    ...event.filters,
    ...Object.keys(event.data_schema),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function eventMatchesQuery(event: EventDefinition, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return eventSearchText(event).includes(normalized);
}
