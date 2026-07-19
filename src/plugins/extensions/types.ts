export interface MarketPluginView {
  id: string;
  title: string;
}

export interface MarketPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  permissions: string[];
  views: MarketPluginView[];
  backendRuntime: string | null;
  installed: boolean;
  available: boolean;
  nativeCode: boolean;
  sourceLabel: string;
  installedVersion: string | null;
}

export type MarketFilter = "all" | "installed";
