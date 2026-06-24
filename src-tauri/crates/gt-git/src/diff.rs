use git2::{DiffFormat, DiffOptions, StatusOptions};
use serde::Serialize;
use std::fs;

use crate::error::{GitError, Result};
use crate::repo::GitRepo;

/// 单个文件的 unified diff 输出
#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    /// 文件路径
    pub path: String,
    /// unified diff 文本（可直接被前端 diff 组件解析）
    pub patch: String,
    /// 新增行数
    pub additions: usize,
    /// 删除行数
    pub deletions: usize,
}

impl GitRepo {
    /// 获取工作区某个文件相对于 HEAD 的 diff。
    /// 如果文件已暂存则对比 index vs HEAD,否则对比 workdir vs index。
    pub fn diff_file(&self, path: &str) -> Result<FileDiff> {
        if self.is_untracked_file(path)? {
            return self.diff_untracked_file(path);
        }

        let mut opts = DiffOptions::new();
        opts.pathspec(path);

        let head_tree = self
            .repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok());

        // 先看 index vs HEAD(staged 变更)
        let diff_staged = self.repo.diff_tree_to_index(
            head_tree.as_ref(),
            None,
            Some(&mut opts),
        )?;

        // 再看 workdir vs index(unstaged 变更)
        let mut opts2 = DiffOptions::new();
        opts2.pathspec(path);
        let diff_workdir = self.repo.diff_index_to_workdir(None, Some(&mut opts2))?;

        // 优先展示 workdir 变更,如果没有则展示 staged 变更
        let diff = if diff_workdir.deltas().len() > 0 {
            diff_workdir
        } else {
            diff_staged
        };

        let stats = diff.stats()?;
        let additions = stats.insertions();
        let deletions = stats.deletions();

        // 生成 unified diff 文本
        let mut patch_text = String::new();
        diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
            let origin = line.origin();
            match origin {
                '+' | '-' | ' ' => {
                    patch_text.push(origin);
                    patch_text.push_str(
                        std::str::from_utf8(line.content()).unwrap_or(""),
                    );
                }
                'H' => {
                    // Hunk header
                    patch_text.push_str(
                        std::str::from_utf8(line.content()).unwrap_or(""),
                    );
                }
                'F' => {
                    // File header
                    patch_text.push_str(
                        std::str::from_utf8(line.content()).unwrap_or(""),
                    );
                }
                _ => {
                    patch_text.push_str(
                        std::str::from_utf8(line.content()).unwrap_or(""),
                    );
                }
            }
            true
        })?;

        Ok(FileDiff {
            path: path.to_string(),
            patch: patch_text,
            additions,
            deletions,
        })
    }

    fn is_untracked_file(&self, path: &str) -> Result<bool> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_unmodified(false);
        let statuses = self.repo.statuses(Some(&mut opts))?;
        Ok(statuses.iter().any(|entry| {
            entry.path() == Some(path) && entry.status().contains(git2::Status::WT_NEW)
        }))
    }

    fn diff_untracked_file(&self, path: &str) -> Result<FileDiff> {
        let workdir = self
            .repo
            .workdir()
            .ok_or_else(|| GitError::Internal("无法读取裸仓库中的未跟踪文件".to_string()))?;
        let full_path = workdir.join(path);
        let content = fs::read_to_string(&full_path)
            .map_err(|e| GitError::Internal(format!("无法读取新增文件 '{}': {}", path, e)))?;
        let additions = content.lines().count();
        let mode = fs::metadata(&full_path)
            .map(|m| if m.permissions().readonly() { "100444" } else { "100644" })
            .unwrap_or("100644");

        let mut patch = String::new();
        patch.push_str(&format!("diff --git a/{0} b/{0}\n", path));
        patch.push_str(&format!("new file mode {}\n", mode));
        patch.push_str("index 0000000..0000000\n");
        patch.push_str("--- /dev/null\n");
        patch.push_str(&format!("+++ b/{}\n", path));
        patch.push_str(&format!("@@ -0,0 +1,{} @@\n", additions));
        for line in content.lines() {
            patch.push('+');
            patch.push_str(line);
            patch.push('\n');
        }
        if !content.ends_with('\n') {
            patch.push_str("\\ No newline at end of file\n");
        }

        Ok(FileDiff {
            path: path.to_string(),
            patch,
            additions,
            deletions: 0,
        })
    }

    /// 获取所有变更文件的 diff 概要（用于完整预览）
    pub fn diff_all(&self) -> Result<Vec<FileDiff>> {
        let statuses = self.status()?;
        let mut diffs = Vec::new();
        for file_status in &statuses {
            if let Ok(d) = self.diff_file(file_status.path.to_str().unwrap_or("")) {
                if !d.patch.is_empty() {
                    diffs.push(d);
                }
            }
        }
        Ok(diffs)
    }
}
