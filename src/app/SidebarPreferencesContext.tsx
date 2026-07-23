import { createContext, type ReactNode, useContext } from "react";

import type {
  SidebarItemInfo,
  SidebarMoveDirection,
} from "./sidebarPreferences";

export interface SidebarPreferencesController {
  items: SidebarItemInfo[];
  isVisible: (id: string) => boolean;
  setVisible: (id: string, visible: boolean) => void;
  move: (id: string, direction: SidebarMoveDirection) => void;
  reorder: (sourceId: string, targetId: string) => void;
  reset: () => void;
}

const SidebarPreferencesContext = createContext<SidebarPreferencesController | null>(null);

export function SidebarPreferencesProvider({
  value,
  children,
}: {
  value: SidebarPreferencesController;
  children: ReactNode;
}) {
  return (
    <SidebarPreferencesContext.Provider value={value}>
      {children}
    </SidebarPreferencesContext.Provider>
  );
}

export function useSidebarPreferences() {
  const value = useContext(SidebarPreferencesContext);
  if (!value) throw new Error("SidebarPreferencesProvider is missing");
  return value;
}
