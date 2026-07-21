export type FlowRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface FlowNodeRun {
  run_id: string;
  flow_id: string;
  job_id: string;
  node_id: string;
  uses: string;
  status: FlowRunStatus;
  started_at?: string | null;
  finished_at?: string | null;
  inputs?: Record<string, string>;
  outputs?: unknown;
  message?: string | null;
  error?: string | null;
}

export interface FlowJobRun {
  run_id: string;
  flow_id: string;
  job_id: string;
  status: FlowRunStatus;
  started_at?: string | null;
  finished_at?: string | null;
  nodes: FlowNodeRun[];
  error?: string | null;
}

export interface FlowRunReport {
  run_id: string;
  flow_id: string;
  flow_name: string;
  status: FlowRunStatus;
  trigger: string;
  reason: string;
  started_at: string;
  finished_at: string;
  jobs: FlowJobRun[];
  event?: unknown;
  inputs?: unknown;
  error?: string | null;
}

export type RunJournalEventKind = "run_started" | "run_completed" | "run_abandoned";

export interface RunJournalRecord {
  schema_version: number;
  seq: number;
  run_id: string;
  flow_id: string;
  occurred_at: string;
  kind: RunJournalEventKind;
  status: FlowRunStatus;
}

export interface RunJournalSummary {
  run_id: string;
  flow_id: string;
  status: FlowRunStatus;
  started_at: string;
  finished_at?: string | null;
}
