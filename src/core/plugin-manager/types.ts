export interface MarketPluginView {
  id: string;
  title: string;
}

export interface MarketPluginFlowNode {
  uses: string;
  name: string;
  nodeType: string;
}

export interface MarketPlugin {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  version: string;
  publisher: string;
  permissions: string[];
  views: MarketPluginView[];
  flowNodes: MarketPluginFlowNode[];
  backendRuntime: string | null;
  installed: boolean;
  available: boolean;
  nativeCode: boolean;
  sourceLabel: string;
  installedVersion: string | null;
}

export type MarketFilter = "all" | "installed";
