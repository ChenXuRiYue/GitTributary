import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { orderedCandidates } from "../capture";
import {
  buildPublishCandidates,
  defaultPublishDraft,
  isPublishCandidateUsable,
  makePublishTarget,
} from "../publish";
import {
  defaultTitleFromRepo,
  pathCollator,
  upsertRunRecord,
} from "../state";
import { makeWorkspaceGroup } from "../sitePanelModel";
import type {
  SitePublishRequest,
  SiteBuildReport,
  SitePublishReport,
  SiteRunRecord,
  SiteWorkspaceGroup,
} from "../types";
import { useSiteCoreState } from "./useSiteCoreState";
import { useSiteWorkspace } from "./useSiteWorkspace";

export function useSiteActions(
  core: ReturnType<typeof useSiteCoreState>,
  workspace: ReturnType<typeof useSiteWorkspace>,
) {
  const {
    setPhase, repoPath, setRepoPath, outputDir, setSiteTitle, scanReport,
    setScanReport, selectedPaths, setSelectedPaths, captureViewMode, captureFilters,
    openCapturePaths, setOpenCapturePaths, buildReport, setBuildReport, remoteConfigs,
    setPublishReport, workspaceGroups, activeWorkspaceGroupId,
    setActiveWorkspaceGroupId, setWorkspaceMenuOpen, setMessage, setError,
    activeWorkspaceGroupIdRef, runningWorkspaceGroupIdsRef,
    defaultWorkspaceCreatedRef, selectSiteView,
    persistWorkspaceConfig, applyWorkspaceGroups, updateWorkspaceGroup,
  } = core;
  const {
    buildConfig, captureList, knownOpenPaths, allCapturedSelected, savedTarget,
    canBuild, canPublish, persistActiveRepo, persistConfig, scanRepo,
    documentScopeDirty,
  } = workspace;
  const toggleCandidate = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (!scanReport) return;
    const visiblePaths = captureList.map((item) => item.path);
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (allCapturedSelected) {
        visiblePaths.forEach((path) => next.delete(path));
      } else {
        visiblePaths.forEach((path) => next.add(path));
      }
      return next;
    });
  };

  const selectDefaults = () => {
    if (!scanReport) return;
    setSelectedPaths(new Set(orderedCandidates(scanReport.candidates).filter((item) => item.selectedByDefault).map((item) => item.path)));
  };

  const toggleCapturePathOpen = useCallback((path: string) => {
    setOpenCapturePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const currentCaptureUiState = useCallback(() => ({
    captureViewMode,
    captureFilters,
    openPaths: Array.from(openCapturePaths)
      .filter((path) => knownOpenPaths.has(path))
      .sort((a, b) => pathCollator.compare(a, b)),
  }), [captureFilters, captureViewMode, knownOpenPaths, openCapturePaths]);

  const upsertWorkspaceRunRecord = useCallback((groupId: string, record: SiteRunRecord) => {
    updateWorkspaceGroup(groupId, (group) => ({
      ...group,
      runHistory: upsertRunRecord(group.runHistory, record),
    }));
  }, [updateWorkspaceGroup]);

  const makeRunRecord = (
    kind: SiteRunRecord["kind"],
    message: string,
  ): SiteRunRecord => {
    const startedAt = Date.now();
    return {
      id: `run.${startedAt.toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
      kind,
      status: "running",
      message,
      startedAt,
      durationMs: 0,
    };
  };

  const runBuild = () => {
    if (!canBuild || !activeWorkspaceGroupId) return;
    const groupId = activeWorkspaceGroupId;
    if (runningWorkspaceGroupIdsRef.current.has(groupId)) return;
    runningWorkspaceGroupIdsRef.current.add(groupId);
    const configSnapshot = buildConfig;
    const uiStateSnapshot = currentCaptureUiState();
    const runningRecord = makeRunRecord("build", "构建已进入执行历史，后台运行中");
    setPhase("building");
    setError(null);
    setMessage("构建已进入执行历史，后台运行中");
    setBuildReport(null);
    setPublishReport(null);
    selectSiteView("result");
    upsertWorkspaceRunRecord(groupId, runningRecord);
    void persistConfig(configSnapshot, uiStateSnapshot);

    void (async () => {
      try {
        const report = await invoke<SiteBuildReport>("site_build", { config: configSnapshot });
        const summary = `生成 ${report.pageCount} 个页面,复制 ${report.assetCount} 个资源`;
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "succeeded",
          message: summary,
          finishedAt: Date.now(),
          durationMs: report.durationMs,
          pageCount: report.pageCount,
          assetCount: report.assetCount,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setBuildReport(report);
          setPublishReport(null);
          setPhase("succeeded");
          setMessage(summary);
        } else {
          setPhase((current) => current === "building" ? "ready" : current);
        }
      } catch (err) {
        const errorMessage = String(err);
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "failed",
          message: errorMessage,
          finishedAt: Date.now(),
          durationMs: Date.now() - runningRecord.startedAt,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setPhase("failed");
          setError(errorMessage);
        } else {
          setPhase((current) => current === "building" ? "ready" : current);
        }
      } finally {
        runningWorkspaceGroupIdsRef.current.delete(groupId);
      }
    })();
  };

  const runPublish = () => {
    if (!canPublish || !savedTarget || !activeWorkspaceGroupId) return;
    const groupId = activeWorkspaceGroupId;
    if (runningWorkspaceGroupIdsRef.current.has(groupId)) return;
    runningWorkspaceGroupIdsRef.current.add(groupId);
    const configSnapshot = buildConfig;
    const targetSnapshot = savedTarget;
    const uiStateSnapshot = currentCaptureUiState();
    const request: SitePublishRequest = {
      buildConfig: configSnapshot,
      target: {
        targetLocalPath: targetSnapshot.targetLocalPath,
        targetBranch: targetSnapshot.targetBranch,
        publishDir: targetSnapshot.publishDir,
        remoteName: targetSnapshot.remoteName || "origin",
        credentialRef: targetSnapshot.credentialRef ?? null,
        pagesUrl: targetSnapshot.pagesUrl,
        autoCommitMessage: targetSnapshot.autoCommitMessage,
      },
    };
    const runningRecord = makeRunRecord("publish", "发布已进入执行历史，后台执行构建、同步、提交和推送");
    setPhase("publishing");
    setError(null);
    setMessage("发布已进入执行历史，后台运行中");
    setBuildReport(null);
    setPublishReport(null);
    selectSiteView("result");
    upsertWorkspaceRunRecord(groupId, runningRecord);
    void persistConfig(configSnapshot, uiStateSnapshot);

    void (async () => {
      try {
        const report = await invoke<SitePublishReport>("site_publish_pages", { request });
        const summary = report.commit
          ? `已发布 ${report.build.pageCount} 个页面到 ${report.remoteName}/${report.branch}`
          : `站点无变更,已确认 ${report.remoteName}/${report.branch}`;
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "succeeded",
          message: summary,
          finishedAt: Date.now(),
          durationMs: report.durationMs,
          pageCount: report.build.pageCount,
          assetCount: report.build.assetCount,
          commit: report.commit,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setBuildReport(report.build);
          setPublishReport(report);
          setPhase("succeeded");
          setMessage(summary);
        } else {
          setPhase((current) => current === "publishing" ? "ready" : current);
        }
      } catch (err) {
        const errorMessage = String(err);
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "failed",
          message: errorMessage,
          finishedAt: Date.now(),
          durationMs: Date.now() - runningRecord.startedAt,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setPhase("failed");
          setError(errorMessage);
        } else {
          setPhase((current) => current === "publishing" ? "ready" : current);
        }
      } finally {
        runningWorkspaceGroupIdsRef.current.delete(groupId);
      }
    })();
  };

  const selectWorkspaceGroup = (id: string) => {
    if (id !== activeWorkspaceGroupId && documentScopeDirty) {
      const confirmed = window.confirm("当前任务的文档范围还有未保存的改动，切换任务会丢弃这些改动。确定要切换吗？");
      if (!confirmed) return;
    }
    setActiveWorkspaceGroupId(id);
    persistWorkspaceConfig(workspaceGroups, id);
    const group = workspaceGroups.find((item) => item.id === id);
    const sourcePath = group?.sourceRepoPath.trim();
    if (sourcePath && sourcePath !== repoPath.trim()) {
      setRepoPath(sourcePath);
      setSiteTitle(defaultTitleFromRepo(sourcePath));
      void persistActiveRepo(sourcePath);
      void scanRepo(sourcePath, group?.documentScope);
    }
  };

  const createWorkspaceGroup = (activate = false) => {
    const firstConfiguredRepo = remoteConfigs.find((remote) => remote.repo_path?.trim())?.repo_path?.trim() ?? "";
    const sourcePath = repoPath.trim() && (
      remoteConfigs.some((remote) => remote.repo_path === repoPath)
        || remoteConfigs.length === 0
        || !firstConfiguredRepo
    )
      ? repoPath
      : firstConfiguredRepo;
    const firstReadyCandidate = buildPublishCandidates(remoteConfigs, sourcePath, null)
      .find((candidate) => isPublishCandidateUsable(candidate));
    const target = firstReadyCandidate
      ? makePublishTarget(firstReadyCandidate, defaultPublishDraft(firstReadyCandidate))
      : null;
    // 新任务复用当前已扫描的仓库时,把当前的文档范围一并带过去,避免用户
    // 明明已经勾选好范围、新建任务后却要重新勾选一遍。
    const cleanSourcePath = sourcePath.trim();
    const initialScope = cleanSourcePath && cleanSourcePath === repoPath.trim()
      ? Array.from(selectedPaths)
      : [];
    const nextGroup = makeWorkspaceGroup(sourcePath, target, undefined, initialScope);
    const nextActiveId = activate || !activeWorkspaceGroupId ? nextGroup.id : activeWorkspaceGroupId;
    applyWorkspaceGroups([...workspaceGroups, nextGroup], nextActiveId);
    if (nextActiveId === nextGroup.id && cleanSourcePath && cleanSourcePath !== repoPath.trim()) {
      setRepoPath(cleanSourcePath);
      setSiteTitle(defaultTitleFromRepo(cleanSourcePath));
      void persistActiveRepo(cleanSourcePath);
      void scanRepo(cleanSourcePath, nextGroup.documentScope);
    }
    setMessage(`已新建发布任务: ${nextGroup.name}`);
    setError(null);
    return nextGroup.id;
  };

  const deleteWorkspaceGroup = (id: string) => {
    const group = workspaceGroups.find((item) => item.id === id);
    const nextGroups = workspaceGroups.filter((item) => item.id !== id);
    const nextActiveId = activeWorkspaceGroupId === id
      ? nextGroups[0]?.id ?? null
      : activeWorkspaceGroupId;
    if (nextGroups.length === 0) {
      defaultWorkspaceCreatedRef.current = false;
    }
    applyWorkspaceGroups(nextGroups, nextActiveId);
    if (activeWorkspaceGroupId === id) {
      const nextActiveGroup = nextGroups.find((item) => item.id === nextActiveId) ?? null;
      const sourcePath = nextActiveGroup?.sourceRepoPath.trim();
      if (sourcePath && sourcePath !== repoPath.trim()) {
        setRepoPath(sourcePath);
        setSiteTitle(defaultTitleFromRepo(sourcePath));
        void persistActiveRepo(sourcePath);
        void scanRepo(sourcePath, nextActiveGroup?.documentScope);
      } else if (!nextActiveGroup) {
        setRepoPath("");
        setScanReport(null);
        setSelectedPaths(new Set());
      }
    }
    if (group) {
      setMessage(`已删除发布任务: ${group.name || "未命名任务"}`);
      setError(null);
    }
  };

  const applyWorkspaceGroup = async (group: SiteWorkspaceGroup) => {
    const sourcePath = group.sourceRepoPath.trim();
    if (!sourcePath) {
      setError("请先为发布任务选择源仓库。");
      return;
    }
    if (group.id !== activeWorkspaceGroupId && documentScopeDirty) {
      const confirmed = window.confirm("当前任务的文档范围还有未保存的改动，切换任务会丢弃这些改动。确定要切换吗？");
      if (!confirmed) return;
    }
    setActiveWorkspaceGroupId(group.id);
    persistWorkspaceConfig(workspaceGroups, group.id);
    setRepoPath(sourcePath);
    setSiteTitle(defaultTitleFromRepo(sourcePath));
    void persistActiveRepo(sourcePath);
    void scanRepo(sourcePath, group.documentScope);
    setMessage(`已应用发布任务: ${group.name || defaultTitleFromRepo(sourcePath)}`);
    setError(null);
  };

  const selectWorkspaceFromMenu = (group: SiteWorkspaceGroup) => {
    setWorkspaceMenuOpen(false);
    const sourcePath = group.sourceRepoPath.trim();
    if (!sourcePath) {
      selectWorkspaceGroup(group.id);
      selectSiteView("workspace");
      setError("请先为发布任务选择源仓库。");
      return;
    }
    void applyWorkspaceGroup(group);
  };

  const openIndex = async () => {
    if (!buildReport?.indexHtml) return;
    try {
      await openPath(buildReport.indexHtml);
    } catch {
      await invoke("site_open_output", { path: buildReport.indexHtml });
    }
  };

  const revealOutput = async () => {
    const path = buildReport?.indexHtml || outputDir;
    if (!path) return;
    try {
      await revealItemInDir(path);
    } catch {
      await openPath(buildReport?.outputDir || outputDir);
    }
  };

  return {
    toggleCandidate, toggleAllSelection, selectDefaults, toggleCapturePathOpen,
    currentCaptureUiState, upsertWorkspaceRunRecord, makeRunRecord, runBuild,
    runPublish, selectWorkspaceGroup, createWorkspaceGroup, deleteWorkspaceGroup,
    applyWorkspaceGroup, selectWorkspaceFromMenu, openIndex, revealOutput,
  };
}
