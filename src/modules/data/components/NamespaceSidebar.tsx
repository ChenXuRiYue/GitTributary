import { Database, RefreshCw } from "lucide-react";

import { ResizeHandle } from "@/shared/components/ResizeHandle";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";
import { STORE_DOMAIN_DEFAULT_WIDTH, STORE_DOMAIN_MIN_WIDTH } from "../constants";
import type { NamespaceInfo } from "../types";
import { domainLabel } from "../utils";

interface NamespaceSidebarProps {
  namespaces: NamespaceInfo[];
  selectedNamespace: string | null;
  width: number;
  error: string | null;
  onSelect: (namespace: string) => void;
  onRefresh: () => void;
  onResize: (width: number) => void;
}

export function NamespaceSidebar(props: NamespaceSidebarProps) {
  return (
    <>
      <div className="flex shrink-0 flex-col border-r border-border/50" style={{ width: `${props.width}px` }}>
        <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
          <Database className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground">命名空间</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={props.onRefresh}><RefreshCw className="size-3" /></Button>
        </div>
        {props.error && <p className="px-3 py-1 text-[11px] text-destructive">{props.error}</p>}
        <ScrollArea className="flex-1">
          <div className="flex flex-col py-1">
            {props.namespaces.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">无数据</p>
            ) : props.namespaces.map((namespace) => (
              <div
                key={namespace.name}
                onClick={() => props.onSelect(namespace.name)}
                className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors", props.selectedNamespace === namespace.name ? "bg-accent" : "hover:bg-accent/40")}
              >
                <Database className="size-3.5 text-muted-foreground" />
                <span className="flex-1 truncate" title={namespace.name}>{domainLabel(namespace.name)}</span>
                {namespace.visibility === "private" && <Badge variant="outline" className="h-4 px-1 text-[8px] text-destructive/70">本地</Badge>}
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">{namespace.count}</Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
      <ResizeHandle direction="horizontal" size={props.width} onResize={props.onResize} minSize={STORE_DOMAIN_MIN_WIDTH} snapTo={STORE_DOMAIN_DEFAULT_WIDTH} />
    </>
  );
}
