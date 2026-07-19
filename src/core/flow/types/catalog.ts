export interface EventDefinition {
  type: string;
  source: string;
  domain: string;
  summary: string;
  description: string;
  trigger_description: string;
  stability: string;
  filters: string[];
  data_schema: Record<string, string>;
}

export interface FlowNodeDefinition {
  uses: string;
  name: string;
  node_type: string;
  summary: string;
  description: string;
  inputs_schema: Record<string, string>;
  outputs_schema: Record<string, string>;
}

export interface FlowNodeSpec {
  id: string;
  name?: string | null;
  job_id: string;
  uses: string;
  node_type: string;
  summary: string;
  inputs: Record<string, string>;
  known: boolean;
}
