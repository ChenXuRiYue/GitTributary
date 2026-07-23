import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Database, RefreshCw } from "lucide-react";

import { DomainTrail, type DomainTrailItem } from "@/shared/components/DomainTrail";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { NamespaceInfo } from "../types";
import { domainLabel } from "../utils";

interface StoreHeaderProps {
  trailItems: DomainTrailItem[];
  namespaces: NamespaceInfo[];
  selectedNamespace: string | null;
  stats: string[];
  onSelectNamespace: (namespace: string) => void;
  onRefresh: () => void;
}

export function StoreHeader(props: StoreHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectedInfo = props.selectedNamespace
    ? props.namespaces.find((namespace) => namespace.name === props.selectedNamespace) ?? null
    : null;
  const label = props.selectedNamespace ? domainLabel(props.selectedNamespace) : "选择命名空间";

  return (
    <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <DomainTrail items={props.trailItems} />
        <span className="shrink-0 text-muted-foreground/60 na-body">/</span>
        <div ref={menuRef} className="relative min-w-0 shrink">
          <button
            type="button"
            className="flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`切换命名空间: ${label}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            title={props.selectedNamespace ?? label}
          >
            <span className="min-w-0 truncate na-body">{label}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div role="menu" className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg sm:w-80">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="na-body-strong truncate">{label}</div>
                  <div className="na-caption truncate text-muted-foreground">{selectedInfo ? `${selectedInfo.count} keys / ${selectedInfo.visibility}` : "未选择命名空间"}</div>
                </div>
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setMenuOpen(false); props.onRefresh(); }}>
                  <RefreshCw className="size-3.5" />刷新
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto p-1">
                {props.namespaces.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <Database className="mx-auto size-6 text-muted-foreground" />
                    <div className="na-body-strong mt-2">暂无命名空间</div>
                    <p className="na-caption mt-1 text-muted-foreground">写入配置后会出现在这里。</p>
                  </div>
                ) : props.namespaces.map((namespace) => {
                  const current = props.selectedNamespace === namespace.name;
                  return (
                    <button
                      key={namespace.name}
                      type="button"
                      role="menuitem"
                      className={cn("flex min-h-12 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors", current ? "bg-primary/8 text-foreground" : "hover:bg-accent hover:text-accent-foreground")}
                      onClick={() => { setMenuOpen(false); props.onSelectNamespace(namespace.name); }}
                    >
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border", current ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-muted-foreground")}>
                        {current ? <Check className="size-3.5" /> : <Database className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="na-body-strong block truncate">{domainLabel(namespace.name)}</span>
                        <span className="na-caption block truncate text-muted-foreground" title={namespace.name}>{namespace.count} keys / {namespace.visibility}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
        {props.stats.map((stat, index) => (
          <div key={`${index}.${stat}`} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted-foreground/40 na-caption">/</span>}
            <span className="text-foreground na-caption font-medium">{stat}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
