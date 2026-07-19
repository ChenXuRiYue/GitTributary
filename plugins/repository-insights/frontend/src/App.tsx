import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Users,
  Workflow,
} from "lucide-react";
import { invokeBackend, isConnectedToHost, markPluginReady } from "./bridge";
import type { RepositoryInsightSummary } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; summary: RepositoryInsightSummary }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const initialLoadStartedRef = useRef(false);

  const loadSummary = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const summary = await invokeBackend<RepositoryInsightSummary>(
        "repository_summary",
      );
      setState({ status: "ready", summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取仓库摘要";
      setState({ status: "error", message });
    }
  }, []);

  useEffect(() => {
    markPluginReady();
  }, []);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void loadSummary();
  }, [loadSummary]);

  return (
    <main className="page-shell">
      <header className="toolbar">
        <div>
          <h1>仓库洞察</h1>
          <p>笔记仓库的 Git 活动与 Flow 概览</p>
        </div>
        <button
          className="icon-button"
          type="button"
          title="刷新仓库摘要"
          aria-label="刷新仓库摘要"
          onClick={() => void loadSummary()}
          disabled={state.status === "loading"}
        >
          <RefreshCw size={17} className={state.status === "loading" ? "spin" : ""} />
        </button>
      </header>

      <div className="runtime-row">
        <span className={`runtime-dot ${isConnectedToHost() ? "connected" : "mock"}`} />
        {isConnectedToHost() ? "已连接 GitTributary sidecar" : "独立预览 · Mock 数据"}
      </div>

      {state.status === "loading" && <LoadingState />}
      {state.status === "error" && (
        <section className="error-state">
          <strong>插件后端暂不可用</strong>
          <span>{state.message}</span>
        </section>
      )}
      {state.status === "ready" && <Dashboard summary={state.summary} />}
    </main>
  );
}

function Dashboard({ summary }: { summary: RepositoryInsightSummary }) {
  return (
    <div className="dashboard">
      <section className="repository-heading">
        <div className="repository-icon"><Activity size={20} /></div>
        <div>
          <span>当前笔记仓库</span>
          <h2>{summary.repository.name}</h2>
        </div>
        <div className="branch-label"><GitBranch size={14} />{summary.branch}</div>
      </section>

      <section className="metric-grid">
        <Metric icon={<GitCommitHorizontal size={18} />} label="最近提交" value={summary.commitCount} />
        <Metric icon={<Users size={18} />} label="贡献者" value={summary.contributorCount} />
        <Metric icon={<Workflow size={18} />} label="可用 Flow" value={summary.flowCount} />
      </section>

      <section className="workspace-status">
        <div>
          <span>工作区状态</span>
          <strong>{summary.changedFiles === 0 ? "工作区干净" : `${summary.changedFiles} 个文件待提交`}</strong>
        </div>
        <span className={summary.changedFiles === 0 ? "status-clean" : "status-dirty"}>
          {summary.changedFiles === 0 ? "Clean" : "Changed"}
        </span>
      </section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <article className="metric"><span>{icon}</span><strong>{value}</strong><small>{label}</small></article>;
}

function LoadingState() {
  return <section className="loading-state"><div /><div /><div /></section>;
}
