import { useEffect, useState } from "react";
import { FolderGit2, Images, Save, Settings2, Trash2, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import { compactSelectClass } from "../../components/styles";
import type { GitHubImageLibrary, ImageMigrationSettings, LocalFilePolicy } from "../../types";

export function MigrationSettingsPanel({
  settings,
  libraries,
  onChange,
  onEditingChange,
  onOpenGallerySettings,
}: {
  settings: ImageMigrationSettings;
  libraries: GitHubImageLibrary[];
  onChange: (settings: ImageMigrationSettings) => void;
  onEditingChange: (editing: boolean) => void;
  onOpenGallerySettings: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings);
  const selectedLibrary = libraries.find((library) => library.id === settings.targetLibraryId) ?? null;

  useEffect(() => {
    if (!editing) setDraft(settings);
  }, [editing, settings]);

  const setEditorOpen = (open: boolean) => {
    setEditing(open);
    onEditingChange(open);
  };
  const save = () => {
    onChange(draft);
    setEditorOpen(false);
  };

  if (!editing) {
    return (
      <section className="border-border/50 flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <Settings2 className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-muted-foreground gt-label shrink-0">迁移设置</span>
        <span className="text-muted-foreground/50 gt-caption">/</span>
        <span className="gt-body-strong min-w-0 truncate">
          {selectedLibrary?.name ?? "未选择目标图库"}
          {selectedLibrary && (
            <span className="text-muted-foreground gt-caption ml-1.5 font-normal">
              {selectedLibrary.branch}/{selectedLibrary.directory || "root"}
            </span>
          )}
        </span>
        <span className="text-muted-foreground/50 gt-caption">/</span>
        <span className="text-muted-foreground gt-caption shrink-0">
          {settings.localFilePolicy === "keep" ? "保留本地图片" : "成功后删除本地图片"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => setEditorOpen(true)}
          aria-label="编辑"
          title="编辑迁移设置"
        >
          <Settings2 />
        </Button>
      </section>
    );
  }

  return (
    <section className="border-border/50 shrink-0 border-b">
      <div className="border-border/50 flex min-h-9 items-center gap-2 border-b px-3 py-1">
        <Settings2 className="size-3.5" />
        <h3 className="gt-title-section">迁移设置</h3>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          aria-label="取消"
          title="取消编辑"
          onClick={() => {
            setDraft(settings);
            setEditorOpen(false);
          }}
        >
          <X />
        </Button>
        <Button size="sm" className="h-7 px-2.5" onClick={save} disabled={!draft.targetLibraryId}>
          <Save />
          完成
        </Button>
      </div>
      <div className="grid min-w-0 gap-x-5 px-3 py-1 xl:grid-cols-2">
        <SettingRow icon={Images} label="目标图库">
          <label className="flex min-w-0 flex-1 items-center gap-1.5">
            <select
              value={draft.targetLibraryId}
              onChange={(event) => setDraft((current) => ({ ...current, targetLibraryId: event.target.value }))}
              className={cn(compactSelectClass, "min-w-0 w-full max-w-xs")}
              aria-label="目标图库"
            >
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} · {library.branch}/{library.directory || "root"}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="icon" className="size-7" onClick={onOpenGallerySettings} title="配置图库" aria-label="配置图库">
              <Settings2 />
            </Button>
          </label>
        </SettingRow>
        <SettingRow icon={FolderGit2} label="本地图片">
          <div className="border-input inline-grid max-w-full grid-cols-2 rounded-md border p-0.5" role="radiogroup" aria-label="本地图片处理">
            <PolicyOption
              value="keep"
              selected={draft.localFilePolicy === "keep"}
              label="保留本地图片"
              onSelect={(localFilePolicy) => setDraft((current) => ({ ...current, localFilePolicy }))}
            />
            <PolicyOption
              value="delete_after_success"
              selected={draft.localFilePolicy === "delete_after_success"}
              label="成功后删除"
              icon={Trash2}
              onSelect={(localFilePolicy) => setDraft((current) => ({ ...current, localFilePolicy }))}
            />
          </div>
        </SettingRow>
      </div>
    </section>
  );
}

function SettingRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Images;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-1.5">
      <div className="text-muted-foreground gt-label flex w-20 shrink-0 items-center gap-1.5">
        <Icon className="size-3.5" />
        {label}
      </div>
      {children}
    </div>
  );
}

function PolicyOption({
  value,
  selected,
  label,
  icon: Icon,
  onSelect,
}: {
  value: LocalFilePolicy;
  selected: boolean;
  label: string;
  icon?: typeof Trash2;
  onSelect: (value: LocalFilePolicy) => void;
}) {
  return (
    <label className={cn(
      "gt-caption flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2.5 transition-colors",
      selected ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    )}>
      <input
        type="radio"
        name="local-file-policy"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      {Icon && <Icon className="size-3.5" />}
      <span>{label}</span>
    </label>
  );
}
