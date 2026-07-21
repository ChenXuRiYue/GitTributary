import { useEffect, useMemo, useState } from "react";
import { Code2, Database, ListPlus, Package, Search, Split, Workflow } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";
import { Metric, SectionHeader } from "../components/shared";
import type { FlowNodeDefinition, FlowNodeSpec, FlowRecord } from "../types";
import { groupNodeDefinitionsByType, nodeMatchesQuery, nodeTypeMeta, nodeTypeText, nodeTypeTone, sortedNodeDefinitions } from "../utils";

function sourceText(definition: FlowNodeDefinition) {
  return definition.source.kind === "core" ? "Core" : definition.source.name;
}

function sourceTone(definition: FlowNodeDefinition) {
  return definition.source.kind === "core"
    ? "border-slate-200 bg-slate-50 text-slate-700"
    : "border-cyan-200 bg-cyan-50 text-cyan-700";
}

export function NodeCatalogView({
  definitions,
  nodes,
  selectedFlow,
  isLoading,
}: {
  definitions: FlowNodeDefinition[];
  nodes: FlowNodeSpec[];
  selectedFlow: FlowRecord | null;
  isLoading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [usageFilter, setUsageFilter] = useState("all");
  const [schemaFilter, setSchemaFilter] = useState("all");
  const [selectedUses, setSelectedUses] = useState<string | null>(null);
  const usedUses = useMemo(() => new Set(nodes.map((node) => node.uses)), [nodes]);
  const sortedDefinitions = useMemo(() => sortedNodeDefinitions(definitions), [definitions]);
  const definitionsByUses = useMemo(
    () => new Map(definitions.map((definition) => [definition.uses, definition])),
    [definitions],
  );
  const nodeTypes = useMemo(
    () => Array.from(new Set(sortedDefinitions.map((definition) => definition.node_type))).sort(),
    [sortedDefinitions],
  );
  const filteredDefinitions = useMemo(() => {
    return sortedDefinitions.filter((definition) => {
      if (!nodeMatchesQuery(definition, query)) return false;
      if (typeFilter !== "all" && definition.node_type !== typeFilter) return false;
      if (sourceFilter !== "all" && definition.source.kind !== sourceFilter) return false;
      if (usageFilter === "used" && !usedUses.has(definition.uses)) return false;
      if (usageFilter === "unused" && usedUses.has(definition.uses)) return false;
      const inputCount = Object.keys(definition.inputs_schema).length;
      const outputCount = Object.keys(definition.outputs_schema).length;
      if (schemaFilter === "input" && inputCount === 0) return false;
      if (schemaFilter === "output" && outputCount === 0) return false;
      if (schemaFilter === "plain" && (inputCount > 0 || outputCount > 0)) return false;
      return true;
    });
  }, [query, schemaFilter, sortedDefinitions, sourceFilter, typeFilter, usageFilter, usedUses]);
  const groupedDefinitions = useMemo(() => {
    return Object.entries(groupNodeDefinitionsByType(filteredDefinitions)).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredDefinitions]);
  const selectedDefinition = useMemo(() => {
    return filteredDefinitions.find((definition) => definition.uses === selectedUses) ?? filteredDefinitions[0] ?? null;
  }, [filteredDefinitions, selectedUses]);
  const selectedTypeMeta = selectedDefinition ? nodeTypeMeta(selectedDefinition.node_type) : null;
  const selectedDefinitionNodes = selectedDefinition ? nodes.filter((node) => node.uses === selectedDefinition.uses) : [];
  const schemaFieldCount = definitions.reduce(
    (count, definition) => count + Object.keys(definition.inputs_schema).length + Object.keys(definition.outputs_schema).length,
    0,
  );
  const usedActionCount = definitions.filter((definition) => usedUses.has(definition.uses)).length;
  const coreActionCount = definitions.filter((definition) => definition.source.kind === "core").length;
  const pluginActionCount = definitions.length - coreActionCount;
  const hasActiveFilters = Boolean(query.trim()) || typeFilter !== "all" || sourceFilter !== "all" || usageFilter !== "all" || schemaFilter !== "all";

  useEffect(() => {
    if (!selectedUses) return;
    if (!filteredDefinitions.some((definition) => definition.uses === selectedUses)) {
      setSelectedUses(filteredDefinitions[0]?.uses ?? null);
    }
  }, [filteredDefinitions, selectedUses]);

  const renderSchemaEntries = (schema: Record<string, string>) => {
    const entries = Object.entries(schema);
    if (entries.length === 0) {
      return <p className="gt-body px-4 py-3 text-muted-foreground">未声明字段。</p>;
    }
    return (
      <div className="divide-y">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[minmax(100px,0.45fr)_1fr] gap-2 px-3 py-2">
            <span className="gt-code truncate">{key}</span>
            <span className="gt-caption truncate text-muted-foreground">{value}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderNodeInputs = (node: FlowNodeSpec) => {
    const entries = Object.entries(node.inputs);
    if (entries.length === 0) {
      return <p className="gt-caption mt-2 text-muted-foreground">未传入 with 参数。</p>;
    }
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map(([key, value]) => (
          <Badge key={key} variant="outline" className="max-w-full font-mono text-[10px]">
            {key}: {value}
          </Badge>
        ))}
      </div>
    );
  };

  const renderNodeInstance = (node: FlowNodeSpec, index: number) => (
    <div key={`${node.job_id}-${node.id}-${index}`} className="grid grid-cols-[2rem_1fr] gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="gt-caption text-muted-foreground">{index + 1}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="gt-body-strong truncate">{node.name || node.id}</p>
          <Badge variant="outline" className={cn("h-5 border", nodeTypeTone(node.node_type))}>
            {nodeTypeText(node.node_type)}
          </Badge>
          {!node.known && (
            <Badge variant="outline" className="h-5 border-red-200 bg-red-50 text-red-700">
              未注册
            </Badge>
          )}
          {definitionsByUses.get(node.uses) && (
            <Badge variant="outline" className={cn("h-5 border", sourceTone(definitionsByUses.get(node.uses)!))}>
              {sourceText(definitionsByUses.get(node.uses)!)}
            </Badge>
          )}
        </div>
        <p className="gt-code mt-1 truncate text-muted-foreground">{node.uses}</p>
        <p className="gt-caption mt-1 text-muted-foreground">job: {node.job_id} · id: {node.id}</p>
        {renderNodeInputs(node)}
      </div>
    </div>
  );

  const renderCurrentFlowNodes = () => {
    if (!selectedFlow) {
      return <p className="gt-body px-4 py-3 text-muted-foreground">在“编排”视图中选择一个 Flow 后,这里会展示它编译出的节点实例。</p>;
    }
    if (nodes.length === 0) {
      return <p className="gt-body px-4 py-3 text-muted-foreground">当前 Flow 没有可展示的节点。</p>;
    }
    return (
      <div className="divide-y">
        {nodes.map((node, index) => renderNodeInstance(node, index))}
      </div>
    );
  };

  const renderSelectedFlowNodes = () => {
    if (!selectedFlow) {
      return <p className="gt-body px-4 py-3 text-muted-foreground">在“编排”视图中选择一个 Flow 后,这里会展示该动作的引用实例。</p>;
    }
    if (selectedDefinitionNodes.length === 0) {
      return <p className="gt-body px-4 py-3 text-muted-foreground">当前 Flow 没有引用这个节点动作。</p>;
    }
    return (
      <div className="divide-y">
        {selectedDefinitionNodes.map((node, index) => renderNodeInstance(node, index))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载节点列表...</div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden p-4">
      <section className="rounded-md border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="gt-title-panel truncate">节点列表</h3>
              <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                {definitions.length} 个动作
              </Badge>
            </div>
            <p className="gt-body mt-1 text-muted-foreground">
              节点动作是 Flow step 可引用的能力模板;某个 Flow 中的 step 会被编译成节点实例。
            </p>
          </div>
        </div>
        <div className="grid md:grid-cols-5">
          <Metric label="动作数量" value={`${definitions.length}`} icon={Split} />
          <Metric label="节点类型" value={`${nodeTypes.length}`} icon={ListPlus} />
          <Metric label="来源分布" value={`Core ${coreActionCount} / 插件 ${pluginActionCount}`} icon={Package} />
          <Metric label="Schema 字段" value={`${schemaFieldCount}`} icon={Code2} />
          <Metric label="当前 Flow 引用" value={`${usedActionCount}/${definitions.length}`} icon={Workflow} />
        </div>
      </section>

      {selectedDefinition && selectedTypeMeta && (
        <section className="rounded-md border">
          <SectionHeader
            icon={Database}
            title="当前类型说明"
            aside={`${selectedTypeMeta.label} · ${filteredDefinitions.filter((definition) => definition.node_type === selectedDefinition.node_type).length} actions`}
          />
          <div className="px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="gt-body-strong truncate">{selectedTypeMeta.label}</p>
              <Badge variant="outline" className={cn("h-5 border", nodeTypeTone(selectedDefinition.node_type))}>
                {nodeTypeText(selectedDefinition.node_type)}
              </Badge>
            </div>
            <p className="gt-caption mt-1 text-muted-foreground">{selectedTypeMeta.summary}</p>
            <p className="gt-body mt-2 text-muted-foreground">{selectedTypeMeta.description}</p>
          </div>
        </section>
      )}

      <section className="rounded-md border">
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(220px,1fr)_150px_150px_150px_150px_auto]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索节点动作、类型、描述、输入输出字段"
              className="h-8 pl-8"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
            aria-label="节点类型筛选"
          >
            <option value="all">全部类型</option>
            {nodeTypes.map((type) => (
              <option key={type} value={type}>{nodeTypeText(type)}</option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
            aria-label="节点来源筛选"
          >
            <option value="all">全部来源</option>
            <option value="core">Core</option>
            <option value="plugin">插件</option>
          </select>
          <select
            value={usageFilter}
            onChange={(event) => setUsageFilter(event.target.value)}
            className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
            aria-label="当前 Flow 使用筛选"
          >
            <option value="all">全部使用</option>
            <option value="used">当前 Flow 已用</option>
            <option value="unused">当前 Flow 未用</option>
          </select>
          <select
            value={schemaFilter}
            onChange={(event) => setSchemaFilter(event.target.value)}
            className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
            aria-label="Schema 筛选"
          >
            <option value="all">全部 Schema</option>
            <option value="input">有输入</option>
            <option value="output">有输出</option>
            <option value="plain">无输入输出</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasActiveFilters}
            onClick={() => {
              setQuery("");
              setTypeFilter("all");
              setSourceFilter("all");
              setUsageFilter("all");
              setSchemaFilter("all");
              setSelectedUses(null);
            }}
          >
            清除
          </Button>
        </div>
        <div className="border-t px-3 py-2">
          <p className="gt-caption text-muted-foreground">
            当前显示 {filteredDefinitions.length} / {definitions.length} 个节点动作
          </p>
        </div>
      </section>

      {definitions.length === 0 ? (
        <section className="rounded-md border">
          <p className="gt-body px-4 py-3 text-muted-foreground">暂无已注册节点动作。</p>
        </section>
      ) : filteredDefinitions.length === 0 ? (
        <section className="rounded-md border">
          <p className="gt-body px-4 py-3 text-muted-foreground">没有符合筛选条件的节点动作。</p>
        </section>
      ) : (
        <section className="grid min-h-0 flex-1 overflow-hidden rounded-md border xl:grid-cols-[minmax(300px,0.4fr)_minmax(0,0.6fr)]">
          <div className="min-h-0 border-b xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Split className="size-4 shrink-0 text-muted-foreground" />
                <h4 className="gt-title-section truncate">节点动作索引</h4>
              </div>
              <span className="gt-caption shrink-0 text-muted-foreground">{filteredDefinitions.length}</span>
            </div>
            <ScrollArea className="h-full" orientation="vertical">
              {groupedDefinitions.map(([type, typeDefinitions]) => (
                <div key={type} className="border-b last:border-b-0">
                  <div className="sticky top-0 z-10 border-b bg-muted/70 px-3 py-1.5 backdrop-blur">
                    <p className="gt-label text-muted-foreground">{nodeTypeText(type)} · {typeDefinitions.length}</p>
                  </div>
                  {typeDefinitions.map((definition) => {
                    const selected = selectedDefinition?.uses === definition.uses;
                    const inputCount = Object.keys(definition.inputs_schema).length;
                    const outputCount = Object.keys(definition.outputs_schema).length;
                    return (
                      <button
                        key={definition.uses}
                        type="button"
                        onClick={() => setSelectedUses(definition.uses)}
                        className={cn(
                          "grid w-full grid-cols-[1fr_auto] gap-2 px-3 py-2.5 text-left transition-colors",
                          selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/45",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="gt-body-strong block truncate">{definition.name}</span>
                          <span className="gt-code mt-0.5 block truncate text-muted-foreground">{definition.uses}</span>
                          <span className="gt-caption mt-0.5 block truncate text-muted-foreground">{definition.summary}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className={cn("h-5 border", nodeTypeTone(definition.node_type))}>
                            {nodeTypeText(definition.node_type)}
                          </Badge>
                          <Badge variant="outline" className={cn("h-5 border", sourceTone(definition))}>
                            {sourceText(definition)}
                          </Badge>
                          {usedUses.has(definition.uses) && (
                            <span className="gt-caption text-muted-foreground">当前已用</span>
                          )}
                          <span className="gt-caption text-muted-foreground">{inputCount} in · {outputCount} out</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </ScrollArea>
          </div>

          <div className="min-h-0">
            {selectedDefinition && (
              <div className="flex h-full min-w-0 flex-col">
                <div className="border-b px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h4 className="gt-title-panel truncate">{selectedDefinition.name}</h4>
                    <Badge variant="outline" className={cn("h-5 border", nodeTypeTone(selectedDefinition.node_type))}>
                      {nodeTypeText(selectedDefinition.node_type)}
                    </Badge>
                    <Badge variant="outline" className={cn("h-5 border", sourceTone(selectedDefinition))}>
                      {sourceText(selectedDefinition)}
                    </Badge>
                    {usedUses.has(selectedDefinition.uses) && (
                      <Badge variant="outline" className="h-5 border-green-200 bg-green-50 text-green-700">
                        当前 Flow 已引用
                      </Badge>
                    )}
                  </div>
                  <p className="gt-code mt-1 break-all text-muted-foreground">{selectedDefinition.uses}</p>
                  <p className="gt-caption mt-1 text-muted-foreground">
                    来源: {selectedDefinition.source.name}
                    {selectedDefinition.source.id ? ` · ${selectedDefinition.source.id}` : ""}
                    {selectedDefinition.source.version ? ` · v${selectedDefinition.source.version}` : ""}
                  </p>
                </div>

                <ScrollArea className="min-h-0 flex-1" orientation="both">
                  <div className="space-y-4 p-4">
                    {selectedTypeMeta && (
                      <div className="rounded-md border bg-muted/20 px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Database className="size-3.5 shrink-0 text-muted-foreground" />
                          <p className="gt-body-strong truncate">{selectedTypeMeta.label}</p>
                        </div>
                        <p className="gt-caption mt-1 text-muted-foreground">{selectedTypeMeta.summary}</p>
                        <p className="gt-body mt-2 text-muted-foreground">{selectedTypeMeta.description}</p>
                      </div>
                    )}

                    <div>
                      <p className="gt-label text-muted-foreground">简要描述</p>
                      <p className="gt-body mt-1">{selectedDefinition.summary}</p>
                    </div>
                    <div>
                      <p className="gt-label text-muted-foreground">详细描述</p>
                      <p className="gt-body mt-1 text-muted-foreground">{selectedDefinition.description}</p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-md border">
                        <SectionHeader icon={ListPlus} title="输入 Schema" aside={`${Object.keys(selectedDefinition.inputs_schema).length}`} />
                        {renderSchemaEntries(selectedDefinition.inputs_schema)}
                      </div>
                      <div className="rounded-md border">
                        <SectionHeader icon={Code2} title="输出 Schema" aside={`${Object.keys(selectedDefinition.outputs_schema).length}`} />
                        {renderSchemaEntries(selectedDefinition.outputs_schema)}
                      </div>
                    </div>

                    <div className="rounded-md border">
                      <SectionHeader
                        icon={Workflow}
                        title="该动作在当前 Flow 中的引用"
                        aside={selectedFlow ? `${selectedDefinitionNodes.length}` : "未选择 Flow"}
                      />
                      {renderSelectedFlowNodes()}
                    </div>

                    <div className="rounded-md border">
                      <SectionHeader
                        icon={Workflow}
                        title="当前 Flow 全部节点"
                        aside={selectedFlow ? selectedFlow.summary.name : "未选择 Flow"}
                      />
                      {renderCurrentFlowNodes()}
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
