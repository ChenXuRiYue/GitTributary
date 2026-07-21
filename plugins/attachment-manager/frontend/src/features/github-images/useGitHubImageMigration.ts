import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AttachmentScanReport,
  GitHubImageConfig,
  GitHubImageLibrary,
  GitHubImageMigrationReport,
} from "../../types";
import { migrationError } from "./model";

export function useGitHubImageMigration(
  report: AttachmentScanReport | null,
  library: GitHubImageLibrary,
  onCompleted: () => Promise<void>,
) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GitHubImageMigrationReport | null>(null);
  const initializedRepo = useRef<string | null>(null);

  const config = useMemo<GitHubImageConfig | null>(() => library.remote ? ({
    remote: library.remote,
    branch: library.branch,
    directory: library.directory,
  }) : null, [library]);
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

  useEffect(() => {
    const repoPath = report?.repoPath ?? null;
    const available = new Set(candidates.map((item) => item.path));
    if (repoPath && initializedRepo.current !== repoPath) {
      initializedRepo.current = repoPath;
      setSelectedPaths(available);
      setResult(null);
      return;
    }
    setSelectedPaths((current) => new Set([...current].filter((path) => available.has(path))));
  }, [candidates, report?.repoPath]);

  const runMigration = async (paths: string[]) => {
    if (!report || paths.length === 0) {
      setError("请至少选择一张图片");
      return;
    }
    if (!config) {
      setError("图库绑定的 Git 远程不可用");
      return;
    }
    const items = candidates.filter((item) => paths.includes(item.path));
    const notes = new Set(
      items.flatMap((item) => item.references.map((reference) => reference.notePath)),
    ).size;
    if (!window.confirm(`将上传 ${items.length} 张图片，并修改 ${notes} 篇 Markdown。原图片会保留，是否继续？`)) {
      return;
    }
    setMigrating(true);
    setError(null);
    setResult(null);
    try {
      const next = await invoke<GitHubImageMigrationReport>("attachments_migrate_github_images", {
        repoPath: report.repoPath,
        imagePaths: paths,
        config,
      });
      setResult(next);
      await onCompleted();
    } catch (reason) {
      setError(migrationError(reason));
    } finally {
      setMigrating(false);
    }
  };

  const migrate = () => runMigration(selectedItems.map((item) => item.path));
  const retryFailures = () => {
    const failedPaths = result?.failed
      .map((failure) => failure.path)
      .filter((path) => candidates.some((item) => item.path === path)) ?? [];
    setSelectedPaths(new Set(failedPaths));
    return runMigration(failedPaths);
  };
  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const selectAll = (selected: boolean) => {
    setSelectedPaths(selected ? new Set(candidates.map((item) => item.path)) : new Set());
  };

  return {
    candidates,
    selectedPaths,
    selectedCount: selectedItems.length,
    selectedNotes,
    selectedBytes,
    migrating,
    error,
    result,
    migrate,
    retryFailures,
    togglePath,
    selectAll,
  };
}
