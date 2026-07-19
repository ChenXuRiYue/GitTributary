export interface RepositoryInsightSummary {
  repository: {
    id: string;
    name: string;
  };
  branch: string;
  changedFiles: number;
  commitCount: number;
  contributorCount: number;
  flowCount: number;
}

export type PluginBackendMethod = "repository_summary";
