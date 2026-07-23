import { useEffect, useRef, useState } from "react";

import { markPluginReady } from "./bridge";
import type { DomainSort } from "./features/domains/model";
import type { Filter, LinkFilter, SortMode, ViewMode } from "./features/inventory/model";
import {
  ATTACHMENT_UI_STATE_KEY, attachmentUiStore, parseAttachmentUiState,
  type AttachmentModule, type AttachmentUiState,
} from "./ui-state";

export function useAttachmentControls() {
  const [activeModule, setActiveModule] = useState<AttachmentModule>("inventory");
  const [inventorySelectedPath, setInventorySelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [inventoryPage, setInventoryPage] = useState(0);
  const [domainSelectedPath, setDomainSelectedPath] = useState<string | null>(null);
  const [domainQuery, setDomainQuery] = useState("");
  const [domainSort, setDomainSort] = useState<DomainSort>("resources");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [domainPage, setDomainPage] = useState(0);
  const [domainResourcePage, setDomainResourcePage] = useState(0);
  const [domainResourceKind, setDomainResourceKind] = useState<LinkFilter>("all");
  const [inventoryWidth, setInventoryWidth] = useState(208);
  const [detailWidth, setDetailWidth] = useState(320);
  const [migrationSelectedTaskId, setMigrationSelectedTaskId] = useState<string | null>(null);
  const [migrationSelectedPaths, setMigrationSelectedPaths] = useState<Set<string> | null>(null);
  const [migrationQuery, setMigrationQuery] = useState("");
  const [migrationExpandedFiles, setMigrationExpandedFiles] = useState<Set<string>>(new Set());
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  return {
    activeModule, setActiveModule, inventorySelectedPath, setInventorySelectedPath, query, setQuery,
    filter, setFilter, linkFilter, setLinkFilter, viewMode, setViewMode, sortMode, setSortMode,
    inventoryPage, setInventoryPage, domainSelectedPath, setDomainSelectedPath, domainQuery, setDomainQuery,
    domainSort, setDomainSort, selectedDomain, setSelectedDomain, domainPage, setDomainPage,
    domainResourcePage, setDomainResourcePage, domainResourceKind, setDomainResourceKind,
    inventoryWidth, setInventoryWidth, detailWidth, setDetailWidth, migrationSelectedTaskId,
    setMigrationSelectedTaskId, migrationSelectedPaths, setMigrationSelectedPaths, migrationQuery,
    setMigrationQuery, migrationExpandedFiles, setMigrationExpandedFiles, uiStateHydrated, setUiStateHydrated,
  };
}

export type AttachmentControls = ReturnType<typeof useAttachmentControls>;

export function useAttachmentUiPersistence(ui: AttachmentControls, scan: () => Promise<void>) {
  const generationRef = useRef(0);
  useEffect(() => {
    markPluginReady();
    const generation = ++generationRef.current;
    void attachmentUiStore.get<unknown>(ATTACHMENT_UI_STATE_KEY).then((raw) => {
      if (generationRef.current !== generation) return;
      const cached = parseAttachmentUiState(raw);
      if (!cached) return;
      ui.setActiveModule(cached.activeModule); ui.setInventorySelectedPath(cached.inventory.selectedPath);
      ui.setQuery(cached.inventory.query); ui.setFilter(cached.inventory.filter);
      ui.setLinkFilter(cached.inventory.linkFilter); ui.setViewMode(cached.inventory.viewMode);
      ui.setSortMode(cached.inventory.sortMode); ui.setInventoryPage(cached.inventory.page);
      ui.setSelectedDomain(cached.domains.selectedDomain); ui.setDomainSelectedPath(cached.domains.selectedPath);
      ui.setDomainQuery(cached.domains.query); ui.setDomainSort(cached.domains.sort);
      ui.setDomainPage(cached.domains.domainPage); ui.setDomainResourcePage(cached.domains.resourcePage);
      ui.setDomainResourceKind(cached.domains.resourceKind);
      ui.setMigrationSelectedTaskId(cached.migration.selectedTaskId);
      ui.setMigrationSelectedPaths(cached.migration.selectedPaths === null ? null : new Set(cached.migration.selectedPaths));
      ui.setMigrationQuery(cached.migration.query); ui.setMigrationExpandedFiles(new Set(cached.migration.expandedFiles));
      ui.setInventoryWidth(Math.min(320, Math.max(160, cached.layout.inventoryWidth)));
      ui.setDetailWidth(Math.min(480, Math.max(240, cached.layout.detailWidth)));
    }).catch(() => undefined).finally(() => {
      if (generationRef.current !== generation) return;
      ui.setUiStateHydrated(true); void scan();
    });
    return () => { if (generationRef.current === generation) generationRef.current += 1; };
  }, [scan]);

  useEffect(() => {
    if (!ui.uiStateHydrated) return;
    const timeout = window.setTimeout(() => {
      const state: AttachmentUiState = {
        version: 1, activeModule: ui.activeModule,
        inventory: {
          selectedPath: ui.inventorySelectedPath, query: ui.query, filter: ui.filter,
          linkFilter: ui.linkFilter, viewMode: ui.viewMode, sortMode: ui.sortMode, page: ui.inventoryPage,
        },
        domains: {
          selectedDomain: ui.selectedDomain, selectedPath: ui.domainSelectedPath, query: ui.domainQuery,
          sort: ui.domainSort, domainPage: ui.domainPage, resourcePage: ui.domainResourcePage,
          resourceKind: ui.domainResourceKind,
        },
        migration: {
          selectedTaskId: ui.migrationSelectedTaskId,
          selectedPaths: ui.migrationSelectedPaths === null ? null : Array.from(ui.migrationSelectedPaths).sort(),
          query: ui.migrationQuery, expandedFiles: Array.from(ui.migrationExpandedFiles).sort(),
        },
        layout: { inventoryWidth: ui.inventoryWidth, detailWidth: ui.detailWidth }, updatedAt: Date.now(),
      };
      void attachmentUiStore.set(ATTACHMENT_UI_STATE_KEY, state).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [ui.activeModule, ui.detailWidth, ui.domainPage, ui.domainQuery, ui.domainResourceKind,
    ui.domainResourcePage, ui.domainSelectedPath, ui.domainSort, ui.filter, ui.inventoryPage,
    ui.inventorySelectedPath, ui.inventoryWidth, ui.linkFilter, ui.migrationExpandedFiles,
    ui.migrationQuery, ui.migrationSelectedPaths, ui.migrationSelectedTaskId, ui.query,
    ui.selectedDomain, ui.sortMode, ui.uiStateHydrated, ui.viewMode]);
}
