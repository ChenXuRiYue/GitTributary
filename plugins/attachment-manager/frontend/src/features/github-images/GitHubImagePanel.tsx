import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageLibraryHome } from "./ImageLibraryHome";
import { ImageLibraryRepositoryPage } from "./ImageLibraryRepositoryPage";
import {
  GALLERY_UI_STATE_KEY,
  galleryUiStore,
  parseGalleryUiState,
  type GalleryPage,
} from "./gallery-ui-state";
import { useImageLibraries } from "./useImageLibraries";

export function GitHubImagePanel() {
  const manager = useImageLibraries();
  const [page, setPage] = useState<GalleryPage>({ id: "home" });
  const [uiStateHydrated, setUiStateHydrated] = useState(false);

  useEffect(() => {
    if (manager.loading || uiStateHydrated) return;
    let cancelled = false;
    void galleryUiStore.get<unknown>(GALLERY_UI_STATE_KEY).then((raw) => {
      if (cancelled) return;
      const cached = parseGalleryUiState(raw);
      const cachedPage = cached?.page;
      if (!cachedPage || cachedPage.id === "home") return;
      if (cachedPage.existing && !manager.libraries.some((item) => item.id === cachedPage.library.id)) return;
      setPage(cachedPage);
    }).catch(() => {
      // Gallery settings remain usable without UI restoration.
    }).finally(() => {
      if (!cancelled) setUiStateHydrated(true);
    });
    return () => { cancelled = true; };
  }, [manager.libraries, manager.loading, uiStateHydrated]);

  useEffect(() => {
    if (!uiStateHydrated) return;
    const timeout = window.setTimeout(() => {
      void galleryUiStore.set(GALLERY_UI_STATE_KEY, {
        version: 1,
        page,
        updatedAt: Date.now(),
      }).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [page, uiStateHydrated]);

  if (manager.loading) {
    return (
      <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2">
        <LoaderCircle className="size-4 animate-spin" />
        <span className="gt-body">正在读取图库与 Git 远程</span>
      </div>
    );
  }

  return (
    <div className="min-h-0">
      {page.id === "home" && (
        <ImageLibraryHome
          libraries={manager.libraries}
          loading={manager.loading}
          isBindingAvailable={(library) => manager.isBindingAvailable(library.remote)}
          onAdd={() => setPage({ id: "repository", library: manager.createLibrary(), existing: false })}
          onManage={(library) => setPage({ id: "repository", library, existing: true })}
        />
      )}
      {page.id === "repository" && (
        <ImageLibraryRepositoryPage
          key={page.library.id}
          initialLibrary={page.library}
          existing={page.existing}
          onDraftChange={(library) => setPage((current) => (
            current.id === "repository" ? { ...current, library } : current
          ))}
          remotes={manager.eligibleRemotes}
          saving={manager.saving}
          onBack={() => setPage({ id: "home" })}
          onSave={async (library) => {
            await manager.saveLibrary(library);
            setPage({ id: "home" });
          }}
          onDelete={async (id) => {
            await manager.deleteLibrary(id);
            setPage({ id: "home" });
          }}
          onAddRemote={manager.addRemote}
          onRefresh={manager.refreshRemotes}
        />
      )}
      {manager.error && page.id === "home" && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive gt-body mx-auto mt-4 max-w-5xl border px-4 py-3">
          {manager.error}
        </div>
      )}
    </div>
  );
}
