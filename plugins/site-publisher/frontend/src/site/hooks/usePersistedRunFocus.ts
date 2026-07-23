import { useEffect, useMemo, useState } from "react";

import { siteUiStore } from "../../store";
import { isRunRecordInProgress } from "../state";
import type { SiteWorkspaceGroup } from "../types";

export function usePersistedRunFocus(task: SiteWorkspaceGroup | null) {
  const history = useMemo(() => task?.runHistory ?? [], [task?.runHistory]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(history[0]?.id ?? null);
  const [restoredTaskId, setRestoredTaskId] = useState<string | null>(null);
  const hasRunningRecord = history.some(isRunRecordInProgress);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const taskId = task?.id ?? null;
    if (!taskId) { setRestoredTaskId(null); return; }
    if (restoredTaskId === taskId) return;
    let cancelled = false;
    void siteUiStore.get<unknown>(`result.focus.${taskId}`).then((raw) => {
      if (cancelled || !raw || typeof raw !== "object") return;
      const state = raw as { version?: unknown; selectedRecordId?: unknown };
      if (state.version === 1 && typeof state.selectedRecordId === "string"
        && history.some((record) => record.id === state.selectedRecordId)) setSelectedRecordId(state.selectedRecordId);
    }).catch(() => undefined).finally(() => { if (!cancelled) setRestoredTaskId(taskId); });
    return () => { cancelled = true; };
  }, [history, restoredTaskId, task?.id]);

  useEffect(() => {
    if (!task || restoredTaskId !== task.id || !selectedRecordId) return;
    const timeout = window.setTimeout(() => {
      void siteUiStore.set(`result.focus.${task.id}`, {
        version: 1, selectedRecordId, updatedAt: Date.now(),
      }).catch(() => undefined);
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [restoredTaskId, selectedRecordId, task]);

  useEffect(() => {
    if (history.length === 0) { setSelectedRecordId(null); return; }
    if (isRunRecordInProgress(history[0]) && selectedRecordId !== history[0].id) {
      setSelectedRecordId(history[0].id); return;
    }
    if (!selectedRecordId || !history.some((record) => record.id === selectedRecordId)) setSelectedRecordId(history[0].id);
  }, [history, selectedRecordId]);

  useEffect(() => {
    if (!hasRunningRecord) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [hasRunningRecord]);

  return { history, selectedRecordId, setSelectedRecordId, hasRunningRecord, now };
}
