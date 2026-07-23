import { useEffect, useMemo, useRef, useState } from "react";

import type { AttachmentScanReport } from "../../types";

export function useGitHubImageMigration(
  report: AttachmentScanReport | null,
  initialSelectedPaths: Set<string> | null = null,
  onSelectedPathsChange?: (paths: Set<string>) => void,
) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<string[] | null>(null);
  const initializedRepo = useRef<string | null>(null);
  const availableSignatureRef = useRef("");
  const initialSelectedPathsRef = useRef(initialSelectedPaths);
  initialSelectedPathsRef.current = initialSelectedPaths;

  const commitSelection = (next: Set<string>) => {
    setSelectedPaths(next);
    onSelectedPathsChange?.(next);
  };

  const candidates = useMemo(
    () => (report?.attachments ?? []).filter(
      (item) => item.kind === "image" && item.references.length > 0,
    ),
    [report],
  );
  const selectedItems = useMemo(
    () => candidates.filter((item) => selectedPaths.has(item.path)),
    [candidates, selectedPaths],
  );
  const selectedNotes = useMemo(() => new Set(
    selectedItems.flatMap((item) => item.references.map((reference) => reference.notePath)),
  ).size, [selectedItems]);
  const selectedBytes = useMemo(
    () => selectedItems.reduce((total, item) => total + item.size, 0),
    [selectedItems],
  );
  const pendingItems = useMemo(
    () => pendingPaths
      ? candidates.filter((item) => pendingPaths.includes(item.path))
      : [],
    [candidates, pendingPaths],
  );
  const confirmation = pendingPaths ? {
    imageCount: pendingItems.length,
    noteCount: new Set(
      pendingItems.flatMap((item) => item.references.map((reference) => reference.notePath)),
    ).size,
  } : null;

  useEffect(() => {
    const repoPath = report?.repoPath ?? null;
    const available = new Set(candidates.map((item) => item.path));
    const availableSignature = Array.from(available).sort().join("\n");
    if (repoPath && initializedRepo.current !== repoPath) {
      initializedRepo.current = repoPath;
      availableSignatureRef.current = availableSignature;
      const initial = initialSelectedPathsRef.current;
      commitSelection(initial === null
        ? available
        : new Set([...initial].filter((path) => available.has(path))));
      return;
    }
    if (availableSignatureRef.current === availableSignature) return;
    availableSignatureRef.current = availableSignature;
    setSelectedPaths((current) => {
      const next = new Set([...current].filter((path) => available.has(path)));
      onSelectedPathsChange?.(next);
      return next;
    });
  }, [candidates, report?.repoPath]);

  const requestMigration = (paths: string[]) => {
    if (!report || paths.length === 0) {
      setError("请至少选择一张图片");
      return;
    }
    const items = candidates.filter((item) => paths.includes(item.path));
    if (items.length === 0) {
      setError("请至少选择一张图片");
      return;
    }
    setError(null);
    setPendingPaths(items.map((item) => item.path));
  };

  const migrate = () => requestMigration(selectedItems.map((item) => item.path));
  const confirmMigration = () => {
    const paths = pendingPaths;
    setPendingPaths(null);
    return paths ? {
      paths,
      noteCount: confirmation?.noteCount ?? 0,
    } : null;
  };
  const cancelMigration = () => setPendingPaths(null);
  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      onSelectedPathsChange?.(next);
      return next;
    });
  };
  const selectAll = (selected: boolean) => {
    commitSelection(selected ? new Set(candidates.map((item) => item.path)) : new Set());
  };
  const selectPaths = (paths: string[], selected: boolean) => {
    const available = new Set(candidates.map((item) => item.path));
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (!available.has(path)) continue;
        if (selected) next.add(path);
        else next.delete(path);
      }
      onSelectedPathsChange?.(next);
      return next;
    });
  };
  const replaceSelection = (paths: string[]) => {
    const available = new Set(candidates.map((item) => item.path));
    commitSelection(new Set(paths.filter((path) => available.has(path))));
  };

  return {
    candidates,
    selectedPaths,
    selectedCount: selectedItems.length,
    selectedNotes,
    selectedBytes,
    error,
    confirmation,
    migrate,
    confirmMigration,
    cancelMigration,
    setError,
    togglePath,
    selectAll,
    selectPaths,
    replaceSelection,
  };
}
