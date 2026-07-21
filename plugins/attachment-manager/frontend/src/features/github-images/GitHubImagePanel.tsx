import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { AttachmentScanReport, GitHubImageLibrary } from "../../types";
import { ImageLibraryHome } from "./ImageLibraryHome";
import { ImageLibraryRepositoryPage } from "./ImageLibraryRepositoryPage";
import { ImageMigrationPage } from "./ImageMigrationPage";
import { useImageLibraries } from "./useImageLibraries";

type GalleryPage =
  | { id: "home" }
  | { id: "repository"; library: GitHubImageLibrary; existing: boolean }
  | { id: "migration"; libraryId: string };

export function GitHubImagePanel({
  report,
  onCompleted,
}: {
  report: AttachmentScanReport | null;
  onCompleted: () => Promise<void>;
}) {
  const manager = useImageLibraries();
  const [page, setPage] = useState<GalleryPage>({ id: "home" });
  const migrationLibrary = page.id === "migration"
    ? manager.libraries.find((library) => library.id === page.libraryId) ?? null
    : null;

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
          onMigrate={(library) => setPage({ id: "migration", libraryId: library.id })}
        />
      )}
      {page.id === "repository" && (
        <ImageLibraryRepositoryPage
          key={page.library.id}
          initialLibrary={page.library}
          existing={page.existing}
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
      {page.id === "migration" && migrationLibrary && (
        <ImageMigrationPage
          library={migrationLibrary}
          report={report}
          onBack={() => setPage({ id: "home" })}
          onCompleted={onCompleted}
        />
      )}
      {page.id === "migration" && !migrationLibrary && (
        <div className="text-destructive gt-body flex min-h-48 items-center justify-center gap-2">
          <AlertTriangle className="size-4" />
          图库不存在或已被删除
        </div>
      )}
      {manager.error && page.id === "home" && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive gt-body mx-auto mt-4 max-w-5xl border px-4 py-3">
          {manager.error}
        </div>
      )}
    </div>
  );
}
