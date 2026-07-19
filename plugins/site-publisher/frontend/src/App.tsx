import { useEffect } from "react";

import { markPluginReady } from "./bridge";
import { SitePanel } from "./site/SitePanel";

export function App() {
  useEffect(() => {
    markPluginReady();
  }, []);

  return <SitePanel />;
}
