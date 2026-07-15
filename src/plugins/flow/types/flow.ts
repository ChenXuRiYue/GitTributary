export interface FlowTriggerSummary {
  kind: string;
  label: string;
  detail?: string | null;
  filters?: Record<string, string[]>;
}

export interface FlowStepSummary {
  id?: string | null;
  name?: string | null;
  uses: string;
  inputs?: Record<string, string>;
}

export interface FlowJobSummary {
  id: string;
  name?: string | null;
  steps: FlowStepSummary[];
}

export interface FlowSummary {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  triggers: FlowTriggerSummary[];
  jobs: FlowJobSummary[];
  step_count: number;
}

export interface FlowRecord {
  raw_yaml: string;
  summary: FlowSummary;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  folder?: string | null;
}

export interface FlowListItem {
  id: string;
  key: string;
  summary: FlowSummary;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  folder: string;
}
