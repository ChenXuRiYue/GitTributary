import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { attachExtensionBridge, notifyExtensionReady } from "./bridge";
import type { ExtensionViewContribution } from "./types";

const EXTENSION_STARTUP_TIMEOUT_MS = 5_000;

export interface ExtensionFrameProps {
  contribution: ExtensionViewContribution;
  className?: string;
}

export function ExtensionFrame({ contribution, className }: ExtensionFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<ReturnType<typeof attachExtensionBridge> | null>(null);
  const connectedRef = useRef(false);
  const startupTimerRef = useRef<number | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionKey = `${contribution.pluginId}:${contribution.generation}:${contribution.viewId}:${contribution.entryUrl}`;

  const clearStartupTimer = useCallback(() => {
    if (startupTimerRef.current !== null) {
      window.clearTimeout(startupTimerRef.current);
      startupTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    connectedRef.current = false;
    const bridge = attachExtensionBridge(contribution, {
      onReady: () => {
        if (bridgeRef.current !== bridge) return;
        clearStartupTimer();
        setLoading(false);
        setError(null);
      },
    });
    bridgeRef.current = bridge;
    return () => {
      clearStartupTimer();
      bridge.dispose();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [clearStartupTimer, frameKey, sessionKey]);

  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [frameKey, sessionKey]);

  const retry = useCallback(() => {
    setFrameKey((value) => value + 1);
  }, []);

  const loaded = useCallback(() => {
    if (connectedRef.current) {
      clearStartupTimer();
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
      setLoading(false);
        setError("插件页面发生了不允许的导航");
      return;
    }
    const frame = frameRef.current;
    const bridge = bridgeRef.current;
    if (frame && bridge) {
      connectedRef.current = true;
      notifyExtensionReady(frame, contribution, bridge.pluginPort, bridge.sessionId);
      startupTimerRef.current = window.setTimeout(() => {
        if (bridgeRef.current !== bridge) return;
        bridge.dispose();
        bridgeRef.current = null;
        startupTimerRef.current = null;
        setLoading(false);
        setError("插件前端启动超时");
      }, EXTENSION_STARTUP_TIMEOUT_MS);
    }
  }, [clearStartupTimer, contribution]);

  const loadFailed = useCallback(() => {
    clearStartupTimer();
    bridgeRef.current?.dispose();
    bridgeRef.current = null;
    setLoading(false);
    setError("插件页面加载失败");
  }, [clearStartupTimer]);

  return (
    <section className={cn("relative h-full min-h-0 overflow-hidden bg-background", className)}>
      <iframe
        key={`${sessionKey}:${frameKey}`}
        ref={frameRef}
        src={contribution.entryUrl}
        title={`${contribution.pluginName}: ${contribution.title}`}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="h-full w-full border-0 bg-background"
        onLoad={loaded}
        onError={loadFailed}
      />

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            <span>正在加载 {contribution.title}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background p-6">
          <div className="flex max-w-sm flex-col items-center text-center">
            <AlertTriangle className="text-destructive mb-3 size-6" />
            <h2 className="gt-title-panel">插件暂时无法运行</h2>
            <p className="text-muted-foreground gt-body mt-2 break-words">{error}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={retry}>
              <RefreshCw />
              重新加载
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
