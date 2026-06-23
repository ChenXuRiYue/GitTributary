use std::fs;
use std::path::Path;

use gt_git::{ChangeKind, GitRepo};
use tempfile::TempDir;

/// 辅助:在临时目录创建一个新仓库并做一次初始提交
fn setup_repo() -> (TempDir, GitRepo) {
    let dir = TempDir::new().unwrap();
    let repo = GitRepo::init(dir.path()).unwrap();

    // 写一个文件并做初始提交
    let file = dir.path().join("hello.md");
    fs::write(&file, "# Hello\n").unwrap();
    repo.stage_all().unwrap();
    repo.commit("init: first commit").unwrap();

    (dir, repo)
}

#[test]
fn test_open_and_is_repo() {
    let (dir, _repo) = setup_repo();

    // 可以从子目录 discover
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    assert!(GitRepo::is_repo(&sub));
    assert!(GitRepo::open(&sub).is_ok());

    // 非 git 目录
    let other = TempDir::new().unwrap();
    assert!(!GitRepo::is_repo(other.path()));
    assert!(GitRepo::open(other.path()).is_err());
}

#[test]
fn test_init_and_overview() {
    let dir = TempDir::new().unwrap();
    let repo = GitRepo::init(dir.path()).unwrap();

    // 新仓库 HEAD 还没有,overview 应能处理
    // 写文件让 status 有内容
    fs::write(dir.path().join("note.md"), "hello").unwrap();
    let overview = repo.overview().unwrap();
    assert!(overview.is_dirty);
    assert_eq!(overview.changed_count, 1);
}

#[test]
fn test_current_branch() {
    let (_dir, repo) = setup_repo();
    let branch = repo.current_branch().unwrap();
    // git init 默认分支可能是 main 或 master
    assert!(branch == "main" || branch == "master", "got: {branch}");
}

#[test]
fn test_status_after_modification() {
    let (dir, repo) = setup_repo();

    // 修改已有文件
    fs::write(dir.path().join("hello.md"), "# Hello World\n").unwrap();
    // 新增文件
    fs::write(dir.path().join("new.md"), "new file").unwrap();

    let statuses = repo.status().unwrap();
    assert_eq!(statuses.len(), 2);

    let modified = statuses.iter().find(|s| s.path == Path::new("hello.md")).unwrap();
    assert_eq!(modified.kind, ChangeKind::Modified);
    assert!(!modified.staged);

    let untracked = statuses.iter().find(|s| s.path == Path::new("new.md")).unwrap();
    assert_eq!(untracked.kind, ChangeKind::Untracked);
    assert!(!untracked.staged);
}

#[test]
fn test_stage_all_and_commit() {
    let (dir, repo) = setup_repo();

    // 做一些变更
    fs::write(dir.path().join("hello.md"), "updated").unwrap();
    fs::write(dir.path().join("note.md"), "new note").unwrap();

    repo.stage_all().unwrap();

    // stage 后 status 应显示 staged
    let statuses = repo.status().unwrap();
    let staged: Vec<_> = statuses.iter().filter(|s| s.staged).collect();
    assert_eq!(staged.len(), 2);

    // commit
    let info = repo.commit("feat: update notes").unwrap();
    assert_eq!(info.message, "feat: update notes");
    assert_eq!(info.short_id.len(), 7);

    // commit 后应无变更
    let statuses_after = repo.status().unwrap();
    assert!(statuses_after.is_empty());
}

#[test]
fn test_stage_files_selective() {
    let (dir, repo) = setup_repo();

    fs::write(dir.path().join("a.md"), "aaa").unwrap();
    fs::write(dir.path().join("b.md"), "bbb").unwrap();

    // 只暂存 a.md
    repo.stage_files(&[Path::new("a.md")]).unwrap();

    let statuses = repo.status().unwrap();
    let a = statuses.iter().find(|s| s.path == Path::new("a.md")).unwrap();
    assert!(a.staged);

    let b = statuses.iter().find(|s| s.path == Path::new("b.md")).unwrap();
    assert!(!b.staged);
}

#[test]
fn test_nothing_to_commit() {
    let (_dir, repo) = setup_repo();

    // 没有任何变更直接 commit 应该报错
    repo.stage_all().unwrap();
    let result = repo.commit("empty");
    assert!(result.is_err());
}

#[test]
fn test_unstage_files() {
    let (dir, repo) = setup_repo();

    fs::write(dir.path().join("hello.md"), "changed").unwrap();
    repo.stage_all().unwrap();

    // 取消暂存
    repo.unstage_files(&[Path::new("hello.md")]).unwrap();

    let statuses = repo.status().unwrap();
    let hello = statuses.iter().find(|s| s.path == Path::new("hello.md")).unwrap();
    assert!(!hello.staged); // 应回到 unstaged
}
