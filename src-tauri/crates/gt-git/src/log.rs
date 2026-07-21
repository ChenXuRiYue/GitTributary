use chrono::{DateTime, TimeZone, Utc};
use git2::Sort;
use serde::Serialize;

use crate::error::Result;
use crate::repo::GitRepo;

/// 提交历史记录
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub time: DateTime<Utc>,
}

impl GitRepo {
    /// 获取提交历史(从 HEAD 开始,按时间倒序)
    /// `limit` 为 0 表示不限制(慎用)
    pub fn log(&self, limit: usize) -> Result<Vec<LogEntry>> {
        let mut revwalk = self.repo.revwalk()?;
        revwalk.push_head()?;
        revwalk.set_sorting(Sort::TIME)?;

        let mut entries = Vec::new();
        for (i, oid_result) in revwalk.enumerate() {
            if limit > 0 && i >= limit {
                break;
            }
            let oid = oid_result?;
            let commit = self.repo.find_commit(oid)?;
            let time_secs = commit.time().seconds();
            let time = Utc.timestamp_opt(time_secs, 0).single().unwrap_or_default();

            entries.push(LogEntry {
                id: oid.to_string(),
                short_id: oid.to_string()[..7].to_string(),
                message: commit.message().unwrap_or("").trim().to_string(),
                author: commit.author().name().unwrap_or("unknown").to_string(),
                email: commit.author().email().unwrap_or("").to_string(),
                time,
            });
        }

        Ok(entries)
    }

    /// 获取指定分支的提交历史
    pub fn log_branch(&self, branch_name: &str, limit: usize) -> Result<Vec<LogEntry>> {
        let refname = format!("refs/heads/{}", branch_name);
        let reference = self.repo.find_reference(&refname)?;
        let oid = reference.target().ok_or_else(|| {
            crate::error::GitError::Internal(format!("分支 '{}' 无有效引用", branch_name))
        })?;

        let mut revwalk = self.repo.revwalk()?;
        revwalk.push(oid)?;
        revwalk.set_sorting(Sort::TIME)?;

        let mut entries = Vec::new();
        for (i, oid_result) in revwalk.enumerate() {
            if limit > 0 && i >= limit {
                break;
            }
            let oid = oid_result?;
            let commit = self.repo.find_commit(oid)?;
            let time_secs = commit.time().seconds();
            let time = Utc.timestamp_opt(time_secs, 0).single().unwrap_or_default();

            entries.push(LogEntry {
                id: oid.to_string(),
                short_id: oid.to_string()[..7].to_string(),
                message: commit.message().unwrap_or("").trim().to_string(),
                author: commit.author().name().unwrap_or("unknown").to_string(),
                email: commit.author().email().unwrap_or("").to_string(),
                time,
            });
        }

        Ok(entries)
    }

    /// 获取某次提交涉及的变更文件列表(对比 parent)
    pub fn commit_files(&self, commit_id: &str) -> Result<Vec<crate::status::FileStatus>> {
        use crate::status::{ChangeKind, FileStatus};
        use std::path::PathBuf;

        let oid = git2::Oid::from_str(commit_id)
            .map_err(|_| crate::error::GitError::Internal(format!("无效的提交 ID: {}", commit_id)))?;
        let commit = self.repo.find_commit(oid)?;
        let tree = commit.tree()?;

        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let diff = self.repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;

        let mut files = Vec::new();
        for delta in diff.deltas() {
            let path = delta.new_file().path().unwrap_or(std::path::Path::new(""));
            let kind = match delta.status() {
                git2::Delta::Added => ChangeKind::Added,
                git2::Delta::Deleted => ChangeKind::Deleted,
                git2::Delta::Modified => ChangeKind::Modified,
                git2::Delta::Renamed => ChangeKind::Renamed,
                _ => ChangeKind::Modified,
            };
            files.push(FileStatus {
                path: PathBuf::from(path),
                kind,
                staged: false,
            });
        }
        Ok(files)
    }

    /// 获取某次提交中指定文件的 diff(对比 parent)
    pub fn commit_file_diff(&self, commit_id: &str, file_path: &str) -> Result<crate::diff::FileDiff> {
        use git2::DiffFormat;

        let oid = git2::Oid::from_str(commit_id)
            .map_err(|_| crate::error::GitError::Internal(format!("无效的提交 ID: {}", commit_id)))?;
        let commit = self.repo.find_commit(oid)?;
        let tree = commit.tree()?;

        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let mut opts = git2::DiffOptions::new();
        opts.pathspec(file_path);

        let diff = self.repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
        let stats = diff.stats()?;

        let mut patch_text = String::new();
        diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
            let origin = line.origin();
            match origin {
                '+' | '-' | ' ' => {
                    patch_text.push(origin);
                    patch_text.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
                }
                _ => {
                    patch_text.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
                }
            }
            true
        })?;

        Ok(crate::diff::FileDiff {
            path: file_path.to_string(),
            patch: patch_text,
            additions: stats.insertions(),
            deletions: stats.deletions(),
        })
    }
}
