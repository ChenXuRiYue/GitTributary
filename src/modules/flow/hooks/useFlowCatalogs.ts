import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { EXTENSIONS_CHANGED_EVENT } from "@/platform/extensions/events";

import { flowApi } from "../api";
import type { EventDefinition, FlowNodeDefinition, FlowNodeSpec } from "../types";

type SetLoadError = Dispatch<SetStateAction<string | null>>;

export function useFlowCatalogs(selectedId: string | null, setLoadError: SetLoadError) {
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [nodeDefinitions, setNodeDefinitions] = useState<FlowNodeDefinition[]>([]);
  const [flowNodes, setFlowNodes] = useState<FlowNodeSpec[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(true);
  const [isNodeDefinitionsLoading, setIsNodeDefinitionsLoading] = useState(true);
  const [isFlowNodesLoading, setIsFlowNodesLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    setIsEventsLoading(true);
    setLoadError(null);
    try {
      const list = await flowApi.eventCatalog();
      setEvents(list);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEventsLoading(false);
    }
  }, [setLoadError]);

  const loadNodeDefinitions = useCallback(async () => {
    setIsNodeDefinitionsLoading(true);
    setLoadError(null);
    try {
      const list = await flowApi.nodeCatalog();
      setNodeDefinitions(list);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsNodeDefinitionsLoading(false);
    }
  }, [setLoadError]);

  const loadFlowNodes = useCallback(async (id: string | null) => {
    if (!id) {
      setFlowNodes([]);
      setIsFlowNodesLoading(false);
      return;
    }
    setIsFlowNodesLoading(true);
    setLoadError(null);
    try {
      const list = await flowApi.nodes(id);
      setFlowNodes(list);
    } catch (error) {
      setFlowNodes([]);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsFlowNodesLoading(false);
    }
  }, [setLoadError]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadNodeDefinitions();
  }, [loadNodeDefinitions]);

  useEffect(() => {
    const handleExtensionsChanged = () => {
      void loadNodeDefinitions();
      void loadFlowNodes(selectedId);
    };
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, handleExtensionsChanged);
    return () => window.removeEventListener(EXTENSIONS_CHANGED_EVENT, handleExtensionsChanged);
  }, [loadFlowNodes, loadNodeDefinitions, selectedId]);

  useEffect(() => {
    void loadFlowNodes(selectedId);
  }, [loadFlowNodes, selectedId]);

  return {
    events,
    nodeDefinitions,
    flowNodes,
    isEventsLoading,
    isNodeDefinitionsLoading,
    isFlowNodesLoading,
    loadEvents,
    loadNodeDefinitions,
    loadFlowNodes,
  };
}
