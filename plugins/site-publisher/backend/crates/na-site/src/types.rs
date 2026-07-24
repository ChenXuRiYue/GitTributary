use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum SiteError {
    #[error("仓库路径不存在: {0}")]
    RepoMissing(String),
    #[error("仓库路径不是目录: {0}")]
    RepoNotDir(String),
    #[error("路径越过仓库根目录: {0}")]
    PathOutsideRepo(String),
    #[error("输出目录非空且不是 Note Aura 站点构建目录: {0}")]
    UnsafeOutputDir(String),
    #[error("发布源仓库不能与目标仓库相同: {0}")]
    PublishRepoSameAsSource(String),
    #[error("发布目录不安全: {0}")]
    UnsafePublishDir(String),
    #[error("构建产物缺少 index.html: {0}")]
    MissingIndexHtml(String),
    #[error("没有找到可构建的 Markdown 文件")]
    NoMarkdownFiles,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("目录扫描错误: {0}")]
    WalkDir(#[from] walkdir::Error),
}

pub type Result<T> = std::result::Result<T, SiteError>;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteScanReport {
    pub repo_path: String,
    pub repo_name: String,
    pub candidates: Vec<SitePathCandidate>,
    pub ignored: Vec<SiteIgnoredPath>,
    pub markdown_count: usize,
    pub asset_count: usize,
    pub default_output_dir: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePathCandidate {
    pub path: String,
    pub kind: SitePathKind,
    pub score: u32,
    pub reason: Vec<String>,
    pub markdown_count: usize,
    pub selected_by_default: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteIgnoredPath {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePathKind {
    File,
    Dir,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBuildConfig {
    pub repo_path: String,
    pub output_dir: String,
    pub site_title: String,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub with_search: bool,
    #[serde(default = "default_true")]
    pub copy_assets: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBuildReport {
    pub output_dir: String,
    pub index_html: String,
    pub page_count: usize,
    pub asset_count: usize,
    pub broken_links: Vec<BrokenLink>,
    pub warnings: Vec<SiteBuildWarning>,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePublishArtifact {
    pub build: SiteBuildReport,
    pub artifact_path: String,
    pub source_repo_path: String,
    pub target_repo_path: String,
    pub publish_dir: String,
    pub publish_path: String,
    pub publish_pathspec: String,
    pub pages_url: String,
    pub commit_message: String,
    pub artifact_file_count: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePublishTargetPlan {
    pub source_repo_path: String,
    pub target_repo_path: String,
    pub publish_dir: String,
    pub publish_path: String,
    pub publish_pathspec: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLink {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBuildWarning {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub(crate) struct MarkdownFile {
    pub(crate) rel_path: String,
    pub(crate) abs_path: PathBuf,
    pub(crate) output_rel: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRecord {
    pub(crate) title: String,
    pub(crate) path: String,
    pub(crate) headings: Vec<String>,
    pub(crate) text: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RenderedPage {
    pub(crate) rel_path: String,
    pub(crate) output_rel: String,
    pub(crate) title: String,
    pub(crate) html: String,
    pub(crate) headings: Vec<Heading>,
    pub(crate) plain_text: String,
}

#[derive(Debug, Clone)]
pub(crate) struct Heading {
    pub(crate) level: usize,
    pub(crate) title: String,
    pub(crate) slug: String,
}

#[derive(Debug, Default)]
pub(crate) struct NavTreeNode {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) children: BTreeMap<String, NavTreeNode>,
    pub(crate) pages: Vec<usize>,
}

#[derive(Default)]
pub(crate) struct AssetContext {
    pub(crate) copied: HashMap<String, String>,
    pub(crate) broken_links: Vec<BrokenLink>,
    pub(crate) warnings: Vec<SiteBuildWarning>,
}

pub(crate) fn default_theme() -> String {
    "typora-light".to_string()
}

pub(crate) fn default_true() -> bool {
    true
}
