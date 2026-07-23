import { useEffect, useMemo, useState } from "react";
import { Code2, Database, List, ListPlus, Radio, Search } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";
import { Metric, SectionHeader } from "../components/shared";
import type { EventDefinition } from "../types";
import {
  FLOW_EVENT_UI_STATE_KEY,
  flowUiStore,
  parseFlowEventUiState,
  type FlowEventUiState,
} from "../uiState";
import { eventDomainMeta, eventDomainText, eventMatchesQuery, eventStabilityTone, groupEventsByDomain, sortedEvents } from "../utils";

export function EventCatalogView({
  events,
  isLoading,
}: {
  events: EventDefinition[];
  isLoading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [stabilityFilter, setStabilityFilter] = useState("all");
  const [filterabilityFilter, setFilterabilityFilter] = useState<FlowEventUiState["filterabilityFilter"]>("all");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);

  const sorted = useMemo(() => sortedEvents(events), [events]);
  const domains = useMemo(() => Array.from(new Set(sorted.map((event) => event.domain))).sort(), [sorted]);
  const stabilities = useMemo(() => Array.from(new Set(sorted.map((event) => event.stability))).sort(), [sorted]);
  const filteredEvents = useMemo(() => {
    return sorted.filter((event) => {
      if (!eventMatchesQuery(event, query)) return false;
      if (domainFilter !== "all" && event.domain !== domainFilter) return false;
      if (stabilityFilter !== "all" && event.stability !== stabilityFilter) return false;
      if (filterabilityFilter === "filterable" && event.filters.length === 0) return false;
      if (filterabilityFilter === "plain" && event.filters.length > 0) return false;
      return true;
    });
  }, [domainFilter, filterabilityFilter, query, sorted, stabilityFilter]);
  const groupedFilteredEvents = groupEventsByDomain(filteredEvents);
  const groupedFilteredEntries = Object.entries(groupedFilteredEvents).sort(([a], [b]) => a.localeCompare(b));
  const selectedEvent = filteredEvents.find((event) => event.type === selectedType) ?? filteredEvents[0] ?? null;
  const selectedDomainMeta = selectedEvent ? eventDomainMeta(selectedEvent.domain) : null;
  const filterCount = events.reduce((count, event) => count + event.filters.length, 0);
  const schemaFieldCount = events.reduce((count, event) => count + Object.keys(event.data_schema).length, 0);
  const hasActiveFilters = Boolean(query.trim()) || domainFilter !== "all" || stabilityFilter !== "all" || filterabilityFilter !== "all";

  useEffect(() => {
    let cancelled = false;
    void flowUiStore.get<unknown>(FLOW_EVENT_UI_STATE_KEY).then((raw) => {
      if (cancelled) return;
      const cached = parseFlowEventUiState(raw);
      if (!cached) return;
      setQuery(cached.query);
      setDomainFilter(cached.domainFilter);
      setStabilityFilter(cached.stabilityFilter);
      setFilterabilityFilter(cached.filterabilityFilter);
      setSelectedType(cached.selectedType);
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setUiStateHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!uiStateHydrated || isLoading) return;
    if (domainFilter !== "all" && !domains.includes(domainFilter)) setDomainFilter("all");
    if (stabilityFilter !== "all" && !stabilities.includes(stabilityFilter)) setStabilityFilter("all");
    if (selectedType && !filteredEvents.some((event) => event.type === selectedType)) {
      setSelectedType(filteredEvents[0]?.type ?? null);
    }
  }, [domainFilter, domains, filteredEvents, isLoading, selectedType, stabilities, stabilityFilter, uiStateHydrated]);

  useEffect(() => {
    if (!uiStateHydrated) return;
    const timeout = window.setTimeout(() => {
      void flowUiStore.set(FLOW_EVENT_UI_STATE_KEY, {
        version: 1,
        query,
        domainFilter,
        stabilityFilter,
        filterabilityFilter,
        selectedType,
        updatedAt: Date.now(),
      } satisfies FlowEventUiState).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [domainFilter, filterabilityFilter, query, selectedType, stabilityFilter, uiStateHydrated]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载事件列表...</div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden p-4">
        <section className="rounded-md border">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="gt-title-panel truncate">事件列表</h3>
                <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                  {events.length} 个事件
                </Badge>
              </div>
              <p className="gt-body mt-1 text-muted-foreground">
                当前事件池已登记的可触发信号,这些事件会作为 Flow 的入口。
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-4">
            <Metric label="事件数量" value={`${events.length}`} icon={Radio} />
            <Metric label="来源域" value={`${domains.length}`} icon={Database} />
            <Metric label="过滤字段" value={`${filterCount}`} icon={ListPlus} />
            <Metric label="载荷字段" value={`${schemaFieldCount}`} icon={Code2} />
          </div>
        </section>

        {selectedEvent && selectedDomainMeta && (
          <section className="rounded-md border">
            <SectionHeader
              icon={Database}
              title="当前域说明"
              aside={`${eventDomainText(selectedEvent.domain)} · ${filteredEvents.filter((event) => event.domain === selectedEvent.domain).length} events`}
            />
            <div className="px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="gt-body-strong truncate">{selectedDomainMeta.label}</p>
                <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                  {selectedEvent.domain}
                </Badge>
              </div>
              <p className="gt-caption mt-1 text-muted-foreground">{selectedDomainMeta.summary}</p>
              <p className="gt-body mt-2 text-muted-foreground">{selectedDomainMeta.description}</p>
            </div>
          </section>
        )}

        <section className="rounded-md border">
          <div className="grid gap-3 p-3 xl:grid-cols-[minmax(220px,1fr)_160px_150px_150px_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索事件名、来源、描述、载荷字段"
                className="h-8 pl-8"
              />
            </div>
            <select
              value={domainFilter}
              onChange={(event) => setDomainFilter(event.target.value)}
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              aria-label="来源域筛选"
            >
              <option value="all">全部来源</option>
              {domains.map((domain) => (
                <option key={domain} value={domain}>{eventDomainText(domain)}</option>
              ))}
            </select>
            <select
              value={stabilityFilter}
              onChange={(event) => setStabilityFilter(event.target.value)}
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              aria-label="稳定性筛选"
            >
              <option value="all">全部状态</option>
              {stabilities.map((stability) => (
                <option key={stability} value={stability}>{stability}</option>
              ))}
            </select>
            <select
              value={filterabilityFilter}
              onChange={(event) => setFilterabilityFilter(event.target.value as FlowEventUiState["filterabilityFilter"])}
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              aria-label="过滤能力筛选"
            >
              <option value="all">全部过滤能力</option>
              <option value="filterable">可过滤</option>
              <option value="plain">无过滤字段</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasActiveFilters}
              onClick={() => {
                setQuery("");
                setDomainFilter("all");
                setStabilityFilter("all");
                setFilterabilityFilter("all");
                setSelectedType(null);
              }}
            >
              清除
            </Button>
          </div>
          <div className="border-t px-3 py-2">
            <p className="gt-caption text-muted-foreground">
              当前显示 {filteredEvents.length} / {events.length} 个事件
            </p>
          </div>
        </section>

        {events.length === 0 ? (
          <section className="rounded-md border">
            <p className="gt-body px-4 py-3 text-muted-foreground">暂无已注册事件。</p>
          </section>
        ) : filteredEvents.length === 0 ? (
          <section className="rounded-md border">
            <p className="gt-body px-4 py-3 text-muted-foreground">没有符合筛选条件的事件。</p>
          </section>
        ) : (
          <section className="grid min-h-0 flex-1 overflow-hidden rounded-md border xl:grid-cols-[minmax(280px,0.42fr)_minmax(0,0.58fr)]">
            <div className="min-h-0 border-b xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <List className="size-4 shrink-0 text-muted-foreground" />
                  <h4 className="gt-title-section truncate">事件索引</h4>
                </div>
                <span className="gt-caption shrink-0 text-muted-foreground">{filteredEvents.length}</span>
              </div>
              <ScrollArea className="h-full" orientation="vertical">
                {groupedFilteredEntries.map(([domain, domainEvents]) => (
                  <div key={domain} className="border-b last:border-b-0">
                    <div className="sticky top-0 z-10 border-b bg-muted/70 px-3 py-1.5 backdrop-blur">
                      <p className="gt-label text-muted-foreground">{eventDomainText(domain)} · {domainEvents.length}</p>
                    </div>
                    {domainEvents.map((event) => {
                      const selected = selectedEvent?.type === event.type;
                      return (
                        <button
                          key={event.type}
                          type="button"
                          onClick={() => setSelectedType(event.type)}
                          className={cn(
                            "grid w-full grid-cols-[1fr_auto] gap-2 px-3 py-2.5 text-left transition-colors",
                            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/45",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="gt-body-strong block truncate">{event.summary || event.description}</span>
                            <span className="gt-code mt-0.5 block truncate text-muted-foreground">{event.type}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <Badge variant="outline" className={cn("h-5 border", eventStabilityTone(event.stability))}>
                              {event.stability}
                            </Badge>
                            {event.filters.length > 0 && (
                              <span className="gt-caption text-muted-foreground">{event.filters.length} filters</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </ScrollArea>
            </div>

            <div className="min-h-0">
              {selectedEvent && (
                <div className="flex h-full min-w-0 flex-col">
                  <div className="border-b px-4 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h4 className="gt-title-panel truncate">{selectedEvent.summary || selectedEvent.description}</h4>
                      <Badge variant="outline" className={cn("h-5 border", eventStabilityTone(selectedEvent.stability))}>
                        {selectedEvent.stability}
                      </Badge>
                      <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                        {eventDomainText(selectedEvent.domain)}
                      </Badge>
                    </div>
                    <p className="gt-code mt-1 break-all text-muted-foreground">{selectedEvent.type}</p>
                    <p className="gt-caption mt-1 break-all text-muted-foreground">{selectedEvent.source}</p>
                  </div>

                  <ScrollArea className="min-h-0 flex-1" orientation="both">
                    <div className="space-y-4 p-4">
                      {selectedDomainMeta && (
                        <div className="rounded-md border bg-muted/20 px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Database className="size-3.5 shrink-0 text-muted-foreground" />
                            <p className="gt-body-strong truncate">{selectedDomainMeta.label}</p>
                          </div>
                          <p className="gt-caption mt-1 text-muted-foreground">{selectedDomainMeta.summary}</p>
                          <p className="gt-body mt-2 text-muted-foreground">{selectedDomainMeta.description}</p>
                        </div>
                      )}
                      <div>
                        <p className="gt-label text-muted-foreground">简要描述</p>
                        <p className="gt-body mt-1">{selectedEvent.description}</p>
                      </div>
                      <div>
                        <p className="gt-label text-muted-foreground">触发说明</p>
                        <p className="gt-body mt-1 text-muted-foreground">{selectedEvent.trigger_description}</p>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-md border">
                          <SectionHeader icon={ListPlus} title="过滤字段" aside={`${selectedEvent.filters.length}`} />
                          {selectedEvent.filters.length === 0 ? (
                            <p className="gt-body px-4 py-3 text-muted-foreground">该事件没有声明过滤字段。</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 p-3">
                              {selectedEvent.filters.map((filter) => (
                                <Badge key={filter} variant="outline" className="font-mono text-[10px]">
                                  {filter}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="rounded-md border">
                          <SectionHeader icon={Code2} title="事件载荷" aside={`${Object.keys(selectedEvent.data_schema).length}`} />
                          {Object.keys(selectedEvent.data_schema).length === 0 ? (
                            <p className="gt-body px-4 py-3 text-muted-foreground">该事件没有固定载荷字段。</p>
                          ) : (
                            <div className="divide-y">
                              {Object.entries(selectedEvent.data_schema).map(([key, value]) => (
                                <div key={key} className="grid grid-cols-[minmax(100px,0.45fr)_1fr] gap-2 px-3 py-2">
                                  <span className="gt-code truncate">{key}</span>
                                  <span className="gt-caption truncate text-muted-foreground">{value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </section>
        )}
    </div>
  );
}
