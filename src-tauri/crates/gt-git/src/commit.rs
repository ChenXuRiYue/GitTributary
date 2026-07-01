use std::path::Path;

use chrono::{DateTime, TimeZone, Utc};
use serde::Serialize;

use crate::error::{GitError, Result};
use crate::repo::GitRepo;

/// 提交结果
#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    /// 完整 SHA hex
    pub id: String,
    /// 前 7 位短 SHA
    pub short_id: String,
    /// 提交信息
    pub message: String,
    /// 作者名
    pub author: String,
    /// 提交时间(UTC)
    pub time: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CommitIdentity {
    pub name: String,
    pub email: String,
}

impl GitRepo {
    /// 暂存所有工作区变更(等价于 `git add -A`)。
    pub fn stage_all(&self) -> Result<()> {
        let mut index = self.repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        // 同时移除已删除的文件
        index.update_all(["*"].iter(), None)?;
        index.write()?;
        Ok(())
    }

    /// 暂存指定文件(路径相对于仓库根目录)。
    pub fn stage_files(&self, paths: &[impl AsRef<Path>]) -> Result<()> {
        let mut index = self.repo.index()?;
        for path in paths {
            let p = path.as_ref();
            // 如果文件已删除则从 index 移除,否则添加
            let workdir = self.repo.workdir().unwrap_or(Path::new("."));
            let full_path = workdir.join(p);
            if full_path.exists() {
                index.add_path(p)?;
            } else {
                index.remove_path(p)?;
            }
        }
        index.write()?;
        Ok(())
    }

    /// 取消暂存指定文件(从 index 恢复为 HEAD 状态)。
    pub fn unstage_files(&self, paths: &[impl AsRef<Path>]) -> Result<()> {
        let head = self.repo.head()?.peel_to_commit()?;
        let head_tree = head.tree()?;

        let mut index = self.repo.index()?;
        for path in paths {
            let p = path.as_ref();
            let path_str = p.to_str().unwrap_or("");
            // 尝试从 HEAD tree 获取该文件的 entry
            match head_tree.get_path(p) {
                Ok(entry) => {
                    // 文件在 HEAD 中存在:恢复 index entry 为 HEAD 版本
                    let idx_entry = git2::IndexEntry {
                        ctime: git2::IndexTime::new(0, 0),
                        mtime: git2::IndexTime::new(0, 0),
                        dev: 0,
                        ino: 0,
                        mode: entry.filemode() as u32,
                        uid: 0,
                        gid: 0,
                        file_size: 0,
                        id: entry.id(),
                        flags: 0,
                        flags_extended: 0,
                        path: path_str.as_bytes().to_vec(),
                    };
                    index.add(&idx_entry)?;
                }
                Err(_) => {
                    // 文件在 HEAD 中不存在(新文件):从 index 移除
                    index.remove_path(p)?;
                }
            }
        }
        index.write()?;
        Ok(())
    }

    /// 创建一个提交(使用当前 index 内容)。
    ///
    /// 如果 index 和 HEAD tree 完全相同则返回 NothingToCommit 错误。
    pub fn commit(&self, message: &str) -> Result<CommitInfo> {
        self.commit_with_identity(
            message,
            &CommitIdentity {
                name: "GitTributary".to_string(),
                email: "gittributary@local".to_string(),
            },
        )
    }

    /// 创建一个提交(使用显式提交身份,不读取仓库或系统 git config)。
    pub fn commit_with_identity(
        &self,
        message: &str,
        identity: &CommitIdentity,
    ) -> Result<CommitInfo> {
        let mut index = self.repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = self.repo.find_tree(tree_oid)?;

        // 检查是否与 HEAD tree 相同(无变更)
        if let Ok(head_ref) = self.repo.head() {
            if let Ok(head_commit) = head_ref.peel_to_commit() {
                let head_tree = head_commit.tree()?;
                if head_tree.id() == tree_oid {
                    return Err(GitError::NothingToCommit);
                }
            }
        }

        let sig = git2::Signature::now(&identity.name, &identity.email)
            .map_err(|e| GitError::Internal(format!("无法创建签名: {}", e)))?;

        // 获取父提交(首次提交时 parents 为空)
        let parents: Vec<git2::Commit> = if let Ok(head_ref) = self.repo.head() {
            if let Ok(commit) = head_ref.peel_to_commit() {
                vec![commit]
            } else {
                vec![]
            }
        } else {
            vec![]
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        let oid = self
            .repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?;

        let short_id = &oid.to_string()[..7];
        let time_secs = sig.when().seconds();
        let time = Utc.timestamp_opt(time_secs, 0).single().unwrap_or_default();

        Ok(CommitInfo {
            id: oid.to_string(),
            short_id: short_id.to_string(),
            message: message.to_string(),
            author: sig.name().unwrap_or("unknown").to_string(),
            time,
        })
    }
}
