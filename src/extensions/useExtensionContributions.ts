import { useCallback, useEffect, useState } from "react";

import {
  extensionErrorMessage,
  listExtensionContributions,
} from "./api";
import type {
  ExtensionContributionsState,
  ExtensionViewContribution,
} from "./types";

const EXTENSIONS_CHANGED_EVENT = "gittributary:extensions-changed";

export function useExtensionContributions(): ExtensionContributionsState {
  const [contributions, setContributions] = useState<ExtensionViewContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContributions(await listExtensionContributions());
    } catch (nextError) {
      setContributions([]);
      setError(extensionErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handleExtensionsChanged = () => { void reload(); };
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, handleExtensionsChanged);
    return () => window.removeEventListener(EXTENSIONS_CHANGED_EVENT, handleExtensionsChanged);
  }, [reload]);

  return { contributions, loading, error, reload };
}
