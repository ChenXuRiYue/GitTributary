use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const HARD_MAX_DEPTH: usize = 128;
pub const HARD_MAX_ENTRIES: usize = 100_000;
pub const HARD_MAX_RESULTS: usize = 10_000;
pub const HARD_MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("root does not exist: {0}")]
    RootMissing(String),
    #[error("root is not a directory: {0}")]
    RootNotDirectory(String),
    #[error("invalid relative path: {0}")]
    InvalidRelativePath(String),
    #[error("symbolic links are not allowed in paths: {0}")]
    SymbolicLink(String),
    #[error("path is not a directory: {0}")]
    NotDirectory(String),
    #[error("path is not a regular file: {0}")]
    NotFile(String),
    #[error("file is not valid UTF-8: {0}")]
    NotUtf8(String),
    #[error("unsafe tree replacement: {0}")]
    UnsafeTreeReplacement(String),
    #[error("{name} must be between 1 and {maximum}, received {value}")]
    InvalidLimit {
        name: &'static str,
        value: usize,
        maximum: usize,
    },
    #[error("filesystem error: {0}")]
    Io(#[from] io::Error),
}

pub type Result<T> = std::result::Result<T, FileError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    File,
    Directory,
    SymbolicLink,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    pub max_entries: usize,
}

impl Default for ListOptions {
    fn default() -> Self {
        Self { max_entries: 1_000 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListReport {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub max_depth: usize,
    pub max_entries: usize,
    #[serde(default)]
    pub exclude: Vec<String>,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_depth: 32,
            max_entries: 10_000,
            exclude: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub max_depth: usize,
    pub max_results: usize,
    pub max_file_bytes: usize,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            max_depth: 32,
            max_results: 100,
            max_file_bytes: 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub entry: FileEntry,
    pub name_matches: bool,
    pub content_matches: bool,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReport {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTreeReport {
    pub target_root: String,
    pub relative_path: String,
    pub copied_file_count: usize,
}

pub fn replace_tree(
    source: impl AsRef<Path>,
    target_root: impl AsRef<Path>,
    relative_path: &str,
) -> Result<ReplaceTreeReport> {
    let source = canonical_directory(source.as_ref(), "source")?;
    let target_root = canonical_directory(target_root.as_ref(), "target root")?;
    let relative_path = normalize_tree_target(relative_path)?;
    ensure_no_symlink_components(&target_root, &relative_path)?;
    let target = target_root.join(path_from_slash(&relative_path));

    if source == target_root
        || source.starts_with(&target_root)
        || target_root.starts_with(&source)
        || source == target
        || source.starts_with(&target)
        || target.starts_with(&source)
    {
        return Err(FileError::UnsafeTreeReplacement(
            "source and target paths overlap".to_string(),
        ));
    }

    validate_source_tree(&source)?;
    clear_tree_target(&target, target == target_root)?;
    let mut copied_file_count = 0usize;
    copy_tree(&source, &source, &target, &mut copied_file_count)?;
    Ok(ReplaceTreeReport {
        target_root: target_root.to_string_lossy().to_string(),
        relative_path: if relative_path.is_empty() {
            ".".to_string()
        } else {
            relative_path
        },
        copied_file_count,
    })
}

#[derive(Debug, Clone)]
pub struct FileWorkspace {
    root: PathBuf,
}

impl FileWorkspace {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        if !root.exists() {
            return Err(FileError::RootMissing(root.to_string_lossy().into_owned()));
        }
        let metadata = fs::symlink_metadata(root)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(FileError::RootNotDirectory(
                root.to_string_lossy().into_owned(),
            ));
        }
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list(&self, relative_dir: &str, options: ListOptions) -> Result<ListReport> {
        validate_limit("max_entries", options.max_entries, HARD_MAX_ENTRIES)?;
        let dir = self.resolve_existing(relative_dir, true)?;
        if !fs::symlink_metadata(&dir)?.is_dir() {
            return Err(FileError::NotDirectory(relative_dir.to_owned()));
        }

        let mut entries = read_directory_entries(&self.root, &dir)?;
        let truncated = entries.len() > options.max_entries;
        entries.truncate(options.max_entries);
        Ok(ListReport { entries, truncated })
    }

    pub fn scan(&self, relative_dir: &str, options: ScanOptions) -> Result<ScanReport> {
        validate_limit("max_depth", options.max_depth, HARD_MAX_DEPTH)?;
        validate_limit("max_entries", options.max_entries, HARD_MAX_ENTRIES)?;
        let exclude = options
            .exclude
            .iter()
            .map(|path| normalize_relative_path(path, false))
            .collect::<Result<Vec<_>>>()?;
        let dir = self.resolve_existing(relative_dir, true)?;
        if !fs::symlink_metadata(&dir)?.is_dir() {
            return Err(FileError::NotDirectory(relative_dir.to_owned()));
        }

        let mut entries = Vec::new();
        let truncated = self.scan_directory(
            &dir,
            1,
            options.max_depth,
            options.max_entries,
            &exclude,
            &mut entries,
        )?;
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(ScanReport { entries, truncated })
    }

    pub fn search(
        &self,
        relative_dir: &str,
        query: &str,
        options: SearchOptions,
    ) -> Result<SearchReport> {
        validate_limit("max_depth", options.max_depth, HARD_MAX_DEPTH)?;
        validate_limit("max_results", options.max_results, HARD_MAX_RESULTS)?;
        validate_limit("max_file_bytes", options.max_file_bytes, HARD_MAX_BYTES)?;
        let query = query.trim();
        if query.is_empty() {
            return Err(FileError::InvalidRelativePath(
                "search query cannot be empty".to_string(),
            ));
        }

        let scan = self.scan(
            relative_dir,
            ScanOptions {
                max_depth: options.max_depth,
                max_entries: HARD_MAX_ENTRIES,
                exclude: Vec::new(),
            },
        )?;
        let needle = query.to_lowercase();
        let mut matches = Vec::new();
        let mut result_limit_reached = false;

        for entry in scan.entries {
            if entry.kind != FileKind::File {
                continue;
            }
            let name_matches = entry.name.to_lowercase().contains(&needle);
            let text = self.read_text_internal(&entry.path, options.max_file_bytes);
            let (content_matches, snippet) = match text {
                Ok(text) => find_content_match(&text.content, &needle),
                Err(FileError::NotUtf8(_)) => (false, None),
                Err(error) => return Err(error),
            };
            if !name_matches && !content_matches {
                continue;
            }
            if matches.len() == options.max_results {
                result_limit_reached = true;
                break;
            }
            matches.push(SearchMatch {
                entry,
                name_matches,
                content_matches,
                snippet,
            });
        }
        matches.sort_by(|left, right| left.entry.path.cmp(&right.entry.path));
        Ok(SearchReport {
            matches,
            truncated: scan.truncated || result_limit_reached,
        })
    }

    pub fn read_text(&self, relative_path: &str, max_bytes: usize) -> Result<TextFile> {
        validate_limit("max_bytes", max_bytes, HARD_MAX_BYTES)?;
        self.read_text_internal(relative_path, max_bytes)
    }

    fn scan_directory(
        &self,
        dir: &Path,
        depth: usize,
        max_depth: usize,
        max_entries: usize,
        exclude: &[String],
        output: &mut Vec<FileEntry>,
    ) -> Result<bool> {
        for entry in read_directory_entries(&self.root, dir)? {
            if exclude
                .iter()
                .any(|path| entry.path == *path || entry.path.starts_with(&format!("{path}/")))
            {
                continue;
            }
            if output.len() == max_entries {
                return Ok(true);
            }
            let descend = entry.kind == FileKind::Directory && depth < max_depth;
            let path = self.root.join(path_from_slash(&entry.path));
            output.push(entry);
            if descend
                && self.scan_directory(&path, depth + 1, max_depth, max_entries, exclude, output)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn read_text_internal(&self, relative_path: &str, max_bytes: usize) -> Result<TextFile> {
        let path = self.resolve_existing(relative_path, false)?;
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() {
            return Err(FileError::NotFile(relative_path.to_owned()));
        }

        let mut bytes = Vec::with_capacity(max_bytes.saturating_add(1));
        File::open(path)?
            .take(max_bytes as u64 + 1)
            .read_to_end(&mut bytes)?;
        let truncated = bytes.len() > max_bytes;
        bytes.truncate(max_bytes);
        let content = utf8_prefix(bytes, relative_path, truncated)?;
        Ok(TextFile {
            path: normalize_relative_path(relative_path, false)?,
            content,
            truncated,
        })
    }

    fn resolve_existing(&self, relative: &str, allow_empty: bool) -> Result<PathBuf> {
        let normalized = normalize_relative_path(relative, allow_empty)?;
        let mut current = self.root.clone();
        for part in Path::new(&normalized).components() {
            let Component::Normal(part) = part else {
                unreachable!("relative path was already validated")
            };
            current.push(part);
            let metadata = fs::symlink_metadata(&current)?;
            if metadata.file_type().is_symlink() {
                return Err(FileError::SymbolicLink(normalized));
            }
        }
        Ok(current)
    }
}

fn validate_limit(name: &'static str, value: usize, maximum: usize) -> Result<()> {
    if value == 0 || value > maximum {
        return Err(FileError::InvalidLimit {
            name,
            value,
            maximum,
        });
    }
    Ok(())
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf> {
    let metadata = fs::symlink_metadata(path).map_err(FileError::Io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(FileError::UnsafeTreeReplacement(format!(
            "{label} must be a real directory: {}",
            path.display()
        )));
    }
    path.canonicalize().map_err(FileError::Io)
}

fn normalize_tree_target(value: &str) -> Result<String> {
    if value == "." || value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().any(char::is_control) {
        return Err(FileError::InvalidRelativePath(value.to_string()));
    }
    normalize_relative_path(value, false)
}

fn ensure_no_symlink_components(root: &Path, relative: &str) -> Result<()> {
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(component) = component else {
            continue;
        };
        current.push(component);
        if !current.exists() {
            break;
        }
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() {
            return Err(FileError::UnsafeTreeReplacement(format!(
                "target path contains a symbolic link: {}",
                current.display()
            )));
        }
        if !metadata.is_dir() {
            return Err(FileError::UnsafeTreeReplacement(format!(
                "target path component is not a directory: {}",
                current.display()
            )));
        }
    }
    Ok(())
}

fn validate_source_tree(root: &Path) -> Result<()> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_name() == ".git" {
                return Err(FileError::UnsafeTreeReplacement(format!(
                    "source tree contains Git metadata: {}",
                    path.display()
                )));
            }
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                return Err(FileError::UnsafeTreeReplacement(format!(
                    "symbolic links are not allowed: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(())
}

fn clear_tree_target(target: &Path, preserve_git: bool) -> Result<()> {
    if !target.exists() {
        fs::create_dir_all(target)?;
        return Ok(());
    }
    let metadata = fs::symlink_metadata(target)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(FileError::UnsafeTreeReplacement(
            target.to_string_lossy().to_string(),
        ));
    }
    for entry in fs::read_dir(target)? {
        let entry = entry?;
        if preserve_git && entry.file_name() == ".git" {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || metadata.is_file() {
            fs::remove_file(path)?;
        } else if metadata.is_dir() {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

fn copy_tree(root: &Path, current: &Path, target: &Path, copied: &mut usize) -> Result<()> {
    fs::create_dir_all(target)?;
    let mut entries = fs::read_dir(current)?.collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let source_path = entry.path();
        let metadata = fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            return Err(FileError::UnsafeTreeReplacement(format!(
                "symbolic links are not allowed: {}",
                source_path.display()
            )));
        }
        let relative = source_path.strip_prefix(root).map_err(|_| {
            FileError::UnsafeTreeReplacement(source_path.to_string_lossy().to_string())
        })?;
        let target_path = target.join(relative);
        if metadata.is_dir() {
            fs::create_dir_all(&target_path)?;
            copy_tree(root, &source_path, target, copied)?;
        } else if metadata.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(source_path, target_path)?;
            *copied += 1;
        }
    }
    Ok(())
}

fn normalize_relative_path(value: &str, allow_empty: bool) -> Result<String> {
    if value.contains('\\') {
        return Err(FileError::InvalidRelativePath(value.to_owned()));
    }
    if value.is_empty() && allow_empty {
        return Ok(String::new());
    }
    let path = Path::new(value);
    if value.is_empty() || path.is_absolute() {
        return Err(FileError::InvalidRelativePath(value.to_owned()));
    }
    if value
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(FileError::InvalidRelativePath(value.to_owned()));
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => return Err(FileError::InvalidRelativePath(value.to_owned())),
        }
    }
    if parts.is_empty() {
        return Err(FileError::InvalidRelativePath(value.to_owned()));
    }
    Ok(parts.join("/"))
}

fn read_directory_entries(root: &Path, dir: &Path) -> Result<Vec<FileEntry>> {
    let mut entries = fs::read_dir(dir)?
        .map(|entry| {
            let entry = entry?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            let kind = if metadata.file_type().is_symlink() {
                FileKind::SymbolicLink
            } else if metadata.is_dir() {
                FileKind::Directory
            } else {
                FileKind::File
            };
            let relative = path
                .strip_prefix(root)
                .expect("directory entry stays below workspace root");
            Ok(FileEntry {
                path: path_to_slash(relative),
                name: entry.file_name().to_string_lossy().into_owned(),
                kind,
                size: if kind == FileKind::File {
                    metadata.len()
                } else {
                    0
                },
            })
        })
        .collect::<std::result::Result<Vec<_>, io::Error>>()?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn path_to_slash(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn path_from_slash(path: &str) -> PathBuf {
    path.split('/').collect()
}

fn utf8_prefix(bytes: Vec<u8>, path: &str, truncated: bool) -> Result<String> {
    match String::from_utf8(bytes) {
        Ok(content) => Ok(content),
        Err(error) if truncated && error.utf8_error().error_len().is_none() => {
            let valid = error.utf8_error().valid_up_to();
            Ok(String::from_utf8(error.into_bytes()[..valid].to_vec())
                .expect("valid_up_to is valid UTF-8"))
        }
        Err(_) => Err(FileError::NotUtf8(path.to_owned())),
    }
}

fn find_content_match(content: &str, needle: &str) -> (bool, Option<String>) {
    for line in content.lines() {
        if line.to_lowercase().contains(needle) {
            let snippet = line.chars().take(240).collect::<String>();
            return (true, Some(snippet));
        }
    }
    (false, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn workspace() -> (tempfile::TempDir, FileWorkspace) {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join("docs/nested")).unwrap();
        fs::write(temp.path().join("README.md"), "# Hello\nRust workspace").unwrap();
        fs::write(temp.path().join("docs/guide.md"), "Plugin architecture").unwrap();
        fs::write(temp.path().join("docs/nested/note.txt"), "hello from note").unwrap();
        fs::write(temp.path().join("image.bin"), [0xff, 0xfe]).unwrap();
        let files = FileWorkspace::open(temp.path()).unwrap();
        (temp, files)
    }

    #[test]
    fn list_is_single_level_and_stably_sorted() {
        let (_temp, files) = workspace();
        let report = files.list("", ListOptions::default()).unwrap();
        let paths = report
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["README.md", "docs", "image.bin"]);
        assert!(!report
            .entries
            .iter()
            .any(|entry| entry.path == "docs/guide.md"));
    }

    #[test]
    fn scan_is_flat_depth_limited_and_sorted() {
        let (_temp, files) = workspace();
        let shallow = files
            .scan(
                "",
                ScanOptions {
                    max_depth: 1,
                    max_entries: 100,
                    exclude: Vec::new(),
                },
            )
            .unwrap();
        assert!(!shallow
            .entries
            .iter()
            .any(|entry| entry.path == "docs/guide.md"));

        let deep = files.scan("", ScanOptions::default()).unwrap();
        let paths = deep
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            paths,
            vec![
                "README.md",
                "docs",
                "docs/guide.md",
                "docs/nested",
                "docs/nested/note.txt",
                "image.bin"
            ]
        );
    }

    #[test]
    fn scan_reports_entry_limit() {
        let (_temp, files) = workspace();
        let report = files
            .scan(
                "",
                ScanOptions {
                    max_depth: 32,
                    max_entries: 2,
                    exclude: Vec::new(),
                },
            )
            .unwrap();
        assert_eq!(report.entries.len(), 2);
        assert!(report.truncated);
    }

    #[test]
    fn search_matches_file_names_and_text_and_skips_binary_files() {
        let (_temp, files) = workspace();
        let by_name = files.search("", "guide", SearchOptions::default()).unwrap();
        assert_eq!(by_name.matches.len(), 1);
        assert!(by_name.matches[0].name_matches);

        let by_text = files.search("", "HELLO", SearchOptions::default()).unwrap();
        let paths = by_text
            .matches
            .iter()
            .map(|item| item.entry.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["README.md", "docs/nested/note.txt"]);
        assert!(by_text.matches.iter().all(|item| item.content_matches));
    }

    #[test]
    fn scan_excludes_root_relative_subtrees() {
        let (_temp, files) = workspace();
        let report = files
            .scan(
                "",
                ScanOptions {
                    exclude: vec!["docs/nested".to_string()],
                    ..ScanOptions::default()
                },
            )
            .unwrap();
        assert!(report
            .entries
            .iter()
            .any(|entry| entry.path == "docs/guide.md"));
        assert!(!report
            .entries
            .iter()
            .any(|entry| entry.path.starts_with("docs/nested")));
    }

    #[test]
    fn read_text_enforces_byte_limit_without_breaking_utf8() {
        let (temp, files) = workspace();
        fs::write(temp.path().join("unicode.txt"), "中英文").unwrap();
        let text = files.read_text("unicode.txt", 4).unwrap();
        assert_eq!(text.content, "中");
        assert!(text.truncated);
    }

    #[test]
    fn rejects_unsafe_relative_paths() {
        let (_temp, files) = workspace();
        for path in [
            "/tmp",
            "../README.md",
            "./README.md",
            "docs/./guide.md",
            "docs/../README.md",
            "docs\\guide.md",
        ] {
            assert!(matches!(
                files.read_text(path, 100),
                Err(FileError::InvalidRelativePath(_))
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn lists_but_never_follows_symbolic_links() {
        use std::os::unix::fs::symlink;

        let (temp, files) = workspace();
        symlink(temp.path().join("docs"), temp.path().join("linked-docs")).unwrap();
        let scan = files.scan("", ScanOptions::default()).unwrap();
        let link = scan
            .entries
            .iter()
            .find(|entry| entry.path == "linked-docs")
            .unwrap();
        assert_eq!(link.kind, FileKind::SymbolicLink);
        assert!(!scan
            .entries
            .iter()
            .any(|entry| entry.path.starts_with("linked-docs/")));
        assert!(matches!(
            files.list("linked-docs", ListOptions::default()),
            Err(FileError::SymbolicLink(_))
        ));
    }

    #[test]
    fn serializes_public_types_with_camel_case_fields() {
        let options = SearchOptions::default();
        let value = serde_json::to_value(options).unwrap();
        assert!(value.get("maxDepth").is_some());
        assert!(value.get("maxResults").is_some());
        assert!(value.get("maxFileBytes").is_some());
    }

    #[test]
    fn replaces_a_target_subtree_without_touching_siblings() {
        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("assets")).unwrap();
        fs::write(source.path().join("index.html"), "new").unwrap();
        fs::write(source.path().join("assets/app.css"), "body{}").unwrap();
        fs::create_dir_all(target.path().join("docs")).unwrap();
        fs::write(target.path().join("docs/stale.html"), "old").unwrap();
        fs::write(target.path().join("README.md"), "keep").unwrap();

        let report = replace_tree(source.path(), target.path(), "docs").unwrap();

        assert_eq!(report.copied_file_count, 2);
        assert!(target.path().join("docs/index.html").is_file());
        assert!(!target.path().join("docs/stale.html").exists());
        assert!(target.path().join("README.md").is_file());
    }

    #[test]
    fn replace_tree_rejects_unsafe_targets() {
        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        fs::write(source.path().join("index.html"), "new").unwrap();
        assert!(replace_tree(source.path(), target.path(), "../outside").is_err());
        assert!(replace_tree(source.path(), target.path(), "/tmp/outside").is_err());

        fs::create_dir_all(source.path().join(".git")).unwrap();
        fs::write(source.path().join(".git/config"), "danger").unwrap();
        assert!(replace_tree(source.path(), target.path(), ".").is_err());
        assert!(!target.path().join(".git").exists());
    }

    #[cfg(unix)]
    #[test]
    fn replace_tree_rejects_symlinks_in_source_and_target_paths() {
        use std::os::unix::fs::symlink;

        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(source.path().join("index.html"), "new").unwrap();
        symlink(outside.path(), target.path().join("docs")).unwrap();
        assert!(replace_tree(source.path(), target.path(), "docs/site").is_err());

        fs::remove_file(target.path().join("docs")).unwrap();
        symlink(outside.path(), source.path().join("linked")).unwrap();
        assert!(replace_tree(source.path(), target.path(), "docs").is_err());
        assert!(!target.path().join("docs").exists());
    }
}
