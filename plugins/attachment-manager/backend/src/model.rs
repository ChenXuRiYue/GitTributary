use serde::{Deserialize, Serialize};

pub(super) const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum AttachmentKind {
    Image,
    Audio,
    Link,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum LinkKind {
    Image,
    Audio,
    Video,
    Website,
    Download,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum ReferenceRole {
    Embed,
    Navigation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentReference {
    pub(super) note_path: String,
    pub(super) line: usize,
    pub(super) role: ReferenceRole,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentItem {
    pub(super) path: String,
    pub(super) url: Option<String>,
    pub(super) name: String,
    pub(super) extension: String,
    pub(super) kind: AttachmentKind,
    pub(super) link_kind: Option<LinkKind>,
    pub(super) domain: Option<String>,
    pub(super) mime_type: String,
    pub(super) size: u64,
    pub(super) modified_at: Option<u64>,
    pub(super) references: Vec<AttachmentReference>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentScanReport {
    pub(super) repo_path: String,
    pub(super) scanned_at: u64,
    pub(super) duration_ms: u128,
    pub(super) notes_scanned: usize,
    pub(super) skipped_entries: usize,
    pub(super) total_size: u64,
    pub(super) attachments: Vec<AttachmentItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentPreview {
    pub(super) path: String,
    pub(super) mime_type: String,
    pub(super) size: u64,
    pub(super) chunk_size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentPreviewChunk {
    pub(super) path: String,
    pub(super) offset: u64,
    pub(super) next_offset: u64,
    pub(super) data: String,
    pub(super) done: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScanRequest {
    pub(super) repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewRequest {
    pub(super) repo_path: String,
    pub(super) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewChunkRequest {
    pub(super) repo_path: String,
    pub(super) path: String,
    pub(super) offset: u64,
    pub(super) expected_size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubImageConfig {
    pub(super) owner: String,
    pub(super) repository: String,
    pub(super) branch: String,
    pub(super) directory: String,
    pub(super) token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubMigrationRequest {
    pub(super) repo_path: String,
    pub(super) image_paths: Vec<String>,
    pub(super) config: GitHubImageConfig,
    #[serde(default)]
    pub(super) local_file_policy: LocalFilePolicy,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum LocalFilePolicy {
    #[default]
    Keep,
    DeleteAfterSuccess,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubConfigCheckRequest {
    pub(super) config: GitHubImageConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubConfigCheck {
    pub(super) repository: String,
    pub(super) default_branch: String,
    #[serde(rename = "private")]
    pub(super) is_private: bool,
    pub(super) can_push: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubMigrationItem {
    pub(super) local_path: String,
    pub(super) remote_path: String,
    pub(super) url: String,
    pub(super) uploaded: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct GitHubMigrationFailure {
    pub(super) path: String,
    pub(super) error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubMigrationReport {
    pub(super) migrated: Vec<GitHubMigrationItem>,
    pub(super) failed: Vec<GitHubMigrationFailure>,
    pub(super) failed_notes: Vec<GitHubMigrationFailure>,
    pub(super) failed_deletes: Vec<GitHubMigrationFailure>,
    pub(super) changed_note_paths: Vec<String>,
    pub(super) deleted_local_paths: Vec<String>,
    pub(super) changed_notes: usize,
    pub(super) replaced_references: usize,
    pub(super) duration_ms: u128,
}

pub(super) struct PreparedImage {
    pub(super) local_path: String,
    pub(super) remote_path: String,
    pub(super) url: String,
    pub(super) bytes: Vec<u8>,
    pub(super) name: String,
}
