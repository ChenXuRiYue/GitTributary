import createIgnore from "ignore";

import type {
  AttachmentItem,
  ImageMigrationFileScope,
} from "../../types";

export type MigrationContentFile = {
  path: string;
  name: string;
  folder: string;
  images: AttachmentItem[];
};

export type MigrationFolderNode = {
  path: string;
  name: string;
  directFileCount: number;
  totalFileCount: number;
  children: MigrationFolderNode[];
};

type MutableFolderNode = {
  path: string;
  name: string;
  directFileCount: number;
  children: Map<string, MutableFolderNode>;
};

const PATH_COLLATOR = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function defaultMigrationFileScope(): ImageMigrationFileScope {
  return { mode: "manual", manualFolders: null, rules: "" };
}

export function buildMigrationContentFiles(items: AttachmentItem[]): MigrationContentFile[] {
  const files = new Map<string, Map<string, AttachmentItem>>();
  for (const item of items) {
    const notePaths = new Set(item.references.map((reference) => reference.notePath).filter(Boolean));
    for (const notePath of notePaths) {
      const images = files.get(notePath) ?? new Map<string, AttachmentItem>();
      images.set(item.path, item);
      files.set(notePath, images);
    }
  }
  return [...files.entries()]
    .map(([path, images]) => ({
      path,
      name: path.split("/").filter(Boolean).pop() ?? path,
      folder: parentFolder(path),
      images: [...images.values()].sort((left, right) => PATH_COLLATOR.compare(left.path, right.path)),
    }))
    .sort((left, right) => PATH_COLLATOR.compare(left.path, right.path));
}

export function buildMigrationFolderTree(files: MigrationContentFile[]): MigrationFolderNode {
  const root: MutableFolderNode = {
    path: "",
    name: "仓库根目录",
    directFileCount: 0,
    children: new Map(),
  };
  for (const file of files) {
    if (!file.folder) {
      root.directFileCount += 1;
      continue;
    }
    let current = root;
    for (const segment of file.folder.split("/").filter(Boolean)) {
      const path = current.path ? `${current.path}/${segment}` : segment;
      let child = current.children.get(segment);
      if (!child) {
        child = { path, name: segment, directFileCount: 0, children: new Map() };
        current.children.set(segment, child);
      }
      current = child;
    }
    current.directFileCount += 1;
  }
  return finalizeFolder(root);
}

export function selectableFolders(node: MigrationFolderNode): string[] {
  const paths = node.directFileCount > 0 ? [node.path] : [];
  return [...paths, ...node.children.flatMap(selectableFolders)];
}

export function allMigrationFolders(files: MigrationContentFile[]): string[] {
  return selectableFolders(buildMigrationFolderTree(files));
}

export function resolveMigrationFileScope(
  files: MigrationContentFile[],
  scope: ImageMigrationFileScope,
): { files: MigrationContentFile[]; error: string | null } {
  if (scope.mode === "manual") {
    if (scope.manualFolders === null) return { files, error: null };
    const selected = new Set(scope.manualFolders);
    return { files: files.filter((file) => selected.has(file.folder)), error: null };
  }
  try {
    const manager = createIgnore().add(scope.rules);
    const included = new Set(manager.filter(files.map((file) => normalizeRulePath(file.path))));
    return {
      files: files.filter((file) => included.has(normalizeRulePath(file.path))),
      error: null,
    };
  } catch (reason) {
    return {
      files: [],
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

export function uniqueMigrationImages(files: MigrationContentFile[]): AttachmentItem[] {
  const images = new Map<string, AttachmentItem>();
  for (const file of files) {
    for (const item of file.images) images.set(item.path, item);
  }
  return [...images.values()].sort((left, right) => PATH_COLLATOR.compare(left.path, right.path));
}

export function isMigrationFileScopeActive(
  scope: ImageMigrationFileScope,
  files: MigrationContentFile[],
) {
  if (scope.mode === "rules") return scope.rules.trim().length > 0;
  if (scope.manualFolders === null) return false;
  const all = allMigrationFolders(files);
  return scope.manualFolders.length !== all.length
    || all.some((path) => !scope.manualFolders?.includes(path));
}

function parentFolder(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function normalizeRulePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function finalizeFolder(node: MutableFolderNode): MigrationFolderNode {
  const children = [...node.children.values()]
    .sort((left, right) => PATH_COLLATOR.compare(left.name, right.name))
    .map(finalizeFolder);
  return {
    path: node.path,
    name: node.name,
    directFileCount: node.directFileCount,
    totalFileCount: node.directFileCount
      + children.reduce((total, child) => total + child.totalFileCount, 0),
    children,
  };
}
