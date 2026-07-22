use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

mod tree;

pub use tree::{replace_tree, ReplaceTreeReport};

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
mod tests;
