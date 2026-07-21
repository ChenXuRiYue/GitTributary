import { useCallback, useEffect, useRef, useState } from "react";
import {
  GitBranch,
  Plus,
  Trash2,
  Check,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import type { GitViewProps } from "../types";

interface BranchInfo {
  name: string;
  is_head: boolean;
  is_remote: boolean;
}

export function BranchesView({ overview, sessionGeneration, refreshRepository }: GitViewProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedGenerationRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!overview) return;
    const requestedGeneration = sessionGeneration;
    try {
      const list = await invoke<BranchInfo[]>("get_branches");
      if (loadedGenerationRef.current !== requestedGeneration) return;
      setBranches(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [overview, sessionGeneration]);

  useEffect(() => {
    if (!overview || loadedGenerationRef.current === sessionGeneration) return;
    loadedGenerationRef.current = sessionGeneration;
    setBranches([]);
    void refresh();
  }, [overview, refresh, sessionGeneration]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true); setError(null);
    try {
      await invoke("create_branch", { name: newName.trim() });
      setNewName("");
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const handleCheckout = async (name: string) => {
    setLoading(true); setError(null);
    try {
      await invoke("checkout_branch", { name });
      await refreshRepository();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const handleDelete = async (name: string) => {
    setLoading(true); setError(null);
    try {
      await invoke("delete_branch", { name });
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部:创建分支 */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新分支名…"
          className="h-7 flex-1 text-xs"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button size="sm" className="h-7" onClick={handleCreate} disabled={loading || !newName.trim()}>
          <Plus className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={refresh}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {error && <p className="border-b border-border/30 px-3 py-1.5 text-[11px] text-destructive">{error}</p>}

      {/* 分支列表 */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col py-1">
          {branches.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">无分支数据</p>
          ) : (
            branches.map((b) => (
              <div
                key={b.name}
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5 text-xs",
                  b.is_head && "bg-primary/5",
                )}
              >
                <GitBranch className={cn("size-3.5 shrink-0", b.is_head ? "text-primary" : "text-muted-foreground")} />
                <span className={cn("flex-1 truncate", b.is_head && "font-medium")}>{b.name}</span>
                {b.is_head && (
                  <Badge variant="secondary" className="h-4 text-[9px]">HEAD</Badge>
                )}
                {!b.is_head && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleCheckout(b.name)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="切换到此分支"
                    >
                      <Check className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(b.name)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="删除分支"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
