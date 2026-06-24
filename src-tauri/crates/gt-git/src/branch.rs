use crate::error::{GitError, Result};
use crate::repo::GitRepo;
use crate::status::BranchInfo;

impl GitRepo {
    /// 创建新分支(基于当前 HEAD)
    pub fn create_branch(&self, name: &str) -> Result<()> {
        let head = self.repo.head()?.peel_to_commit()?;
        self.repo.branch(name, &head, false)?;
        Ok(())
    }

    /// 切换到指定分支
    pub fn checkout_branch(&self, name: &str) -> Result<()> {
        let refname = format!("refs/heads/{}", name);
        let obj = self
            .repo
            .revparse_single(&refname)
            .map_err(|_| GitError::Internal(format!("分支 '{}' 不存在", name)))?;

        self.repo.checkout_tree(&obj, None)?;
        self.repo.set_head(&refname)?;
        Ok(())
    }

    /// 删除本地分支(不能删除当前所在分支)
    pub fn delete_branch(&self, name: &str) -> Result<()> {
        let mut branch = self
            .repo
            .find_branch(name, git2::BranchType::Local)
            .map_err(|_| GitError::Internal(format!("分支 '{}' 不存在", name)))?;

        if branch.is_head() {
            return Err(GitError::Internal("不能删除当前所在分支".to_string()));
        }

        branch.delete()?;
        Ok(())
    }

    /// 重命名分支
    pub fn rename_branch(&self, old_name: &str, new_name: &str) -> Result<()> {
        let mut branch = self
            .repo
            .find_branch(old_name, git2::BranchType::Local)
            .map_err(|_| GitError::Internal(format!("分支 '{}' 不存在", old_name)))?;

        branch.rename(new_name, false)?;
        Ok(())
    }

    /// 获取所有本地分支(带当前分支标记),按名称排序
    pub fn local_branches(&self) -> Result<Vec<BranchInfo>> {
        let mut result = Vec::new();
        let branches = self.repo.branches(Some(git2::BranchType::Local))?;

        for item in branches {
            let (branch, _) = item?;
            let name = branch.name()?.unwrap_or("<invalid>").to_string();
            let is_head = branch.is_head();
            result.push(BranchInfo {
                name,
                is_head,
                is_remote: false,
            });
        }

        result.sort_by(|a, b| {
            // 当前分支排最前
            if a.is_head && !b.is_head { return std::cmp::Ordering::Less; }
            if !a.is_head && b.is_head { return std::cmp::Ordering::Greater; }
            a.name.cmp(&b.name)
        });

        Ok(result)
    }
}
