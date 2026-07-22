import { SitePanelView } from "./components/SitePanelView";
import { useSiteActions } from "./hooks/useSiteActions";
import { useSiteCoreState } from "./hooks/useSiteCoreState";
import { useSiteWorkspace } from "./hooks/useSiteWorkspace";

export function SitePanel() {
  const core = useSiteCoreState();
  const workspace = useSiteWorkspace(core);
  const actions = useSiteActions(core, workspace);

  return <SitePanelView core={core} workspace={workspace} actions={actions} />;
}
