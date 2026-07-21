import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";
import type { KeyTreeNode, KvEntry, ViewMode } from "../types";
import {
  buildJsonGroups,
  buildKeyTree,
  formatPrimitive,
  isExpandable,
  isL0Key,
  primitiveClassName,
  sortedChildren,
  sortedObjectEntries,
  stringifyValue,
  valueKind,
} from "../utils";

function ValueBadge({ value }: { value: unknown }) {
  return (
    <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] text-muted-foreground">
      {valueKind(value)}
    </Badge>
  );
}

function YamlValue({ value, depth }: { value: unknown; depth: number }) {
  if (!isExpandable(value)) {
    return <span className={cn("font-mono text-xs", primitiveClassName(value))}>{formatPrimitive(value, "yaml")}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-0.5 pt-1">
        {value.map((item, index) => (
          <div key={index} className="font-mono text-xs" style={{ paddingLeft: depth * 16 }}>
            {!isExpandable(item) ? (
              <span><span className="text-muted-foreground">- </span><span className={primitiveClassName(item)}>{formatPrimitive(item, "yaml")}</span></span>
            ) : (
              <><span className="text-muted-foreground">-</span><YamlValue value={item} depth={depth + 1} /></>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {sortedObjectEntries(value as Record<string, unknown>).map(([key, childValue]) => (
        <div key={key} className="font-mono text-xs" style={{ paddingLeft: depth * 16 }}>
          <span className="text-muted-foreground">{key}:</span>{" "}
          {!isExpandable(childValue) ? (
            <span className={primitiveClassName(childValue)}>{formatPrimitive(childValue, "yaml")}</span>
          ) : <YamlValue value={childValue} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function KeyTreeItem({ node, depth = 0 }: { node: KeyTreeNode; depth?: number }) {
  const hasEntry = Boolean(node.entry);
  const value = node.entry?.value;
  const masked = node.entry ? isL0Key(node.entry.key) : false;
  const expandableValue = hasEntry && !masked && isExpandable(value);
  const expandable = node.children.size > 0 || expandableValue;
  const [expanded, setExpanded] = useState(depth < 2);
  const ToggleIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => expandable && setExpanded((open) => !open)}
        className={cn(
          "flex w-full min-w-0 items-start gap-1 rounded px-2 py-1 text-left text-xs hover:bg-accent/50",
          !expandable && "cursor-default hover:bg-transparent",
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {expandable ? <ToggleIcon className="size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 break-words font-mono">
          <span className="text-foreground">{node.name}</span>
          {hasEntry && <span className="text-muted-foreground">:</span>}
          {hasEntry && !expandableValue && !masked && <> {" "}<span className={primitiveClassName(value)}>{formatPrimitive(value, "yaml")}</span></>}
          {masked && <span className="text-muted-foreground"> ••••••••</span>}
        </span>
        {hasEntry && value !== undefined && <ValueBadge value={masked ? "masked" : value} />}
      </button>
      {expanded && (
        <div className="min-w-0">
          {expandableValue && <YamlValue value={value} depth={depth + 2} />}
          {sortedChildren(node).map((child) => <KeyTreeItem key={child.path} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

interface EntryViewerProps {
  entries: KvEntry[];
  searchQuery: string;
  viewMode: ViewMode;
}

export function EntryViewer({ entries, searchQuery, viewMode }: EntryViewerProps) {
  const keyTree = useMemo(() => buildKeyTree(entries), [entries]);
  const jsonGroups = useMemo(() => buildJsonGroups(entries), [entries]);

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col">
        {entries.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">{searchQuery ? "无匹配结果" : "命名空间为空"}</p>
        ) : viewMode === "compact" ? (
          entries.map((entry) => (
            <div key={entry.key} className="flex items-start gap-3 border-b border-border/20 px-3 py-2 text-xs">
              <span className="w-40 shrink-0 truncate font-mono text-muted-foreground" title={entry.key}>{entry.key}</span>
              <span className="min-w-0 flex-1 break-words font-mono">{isL0Key(entry.key) ? "••••••••" : stringifyValue(entry.value)}</span>
            </div>
          ))
        ) : viewMode === "tree" ? (
          <div className="flex flex-col px-1 py-2">
            {sortedChildren(keyTree).map((node) => <KeyTreeItem key={node.path} node={node} />)}
          </div>
        ) : (
          <div className="flex flex-col">
            {jsonGroups.map((group) => (
              <div key={group.name} className="border-b border-border/20 px-3 py-2">
                <div className="mb-2 flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={group.name}>{group.name}</span>
                  <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] text-muted-foreground">{group.count} keys</Badge>
                  <ValueBadge value={group.value} />
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 px-2 py-1.5 font-mono text-xs leading-5">{stringifyValue(group.value, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
