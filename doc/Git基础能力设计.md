# Git 基础能力设计（发散稿）

> 本文档为 GitTributary **Rust 端 Git 模块**的能力发散与架构设想。
> 定位：作为项目的**基座服务层**，向上层所有插件（备份、复习、AI、数据库、部署…）提供统一的 Git 原语与加工数据。
> 设计哲学：**Git 不是某个插件的私有实现，而是平台级公共能力。**

---

## 一、模块定位与设计哲学

### 为什么 Git 要做成"强大的独立模块"

GitTributary 的核心价值命题就是「用 Git 管理笔记」。几乎所有上层功能都围绕 Git 数据展开：

| 上层功能 | 消费的 Git 能力 |
| --- | --- |
| 备份工作流 | status / stage / commit / push / branch |
| 复习曲线 | 文件最后修改时间（来自 log） |
| AI 助手 | commit message 语料、diff 上下文 |
| 数据库 | git log 索引、文件元数据、提交频率 |
| 文件监听 | 变更后自动 stage / commit |
| GitHub Pages 部署 | 创建 gh-pages 分支并 push |
| 成就系统 | 提交频率统计、连续打卡 |
| 累积文件打标 | 统计文件 commit 次数 → 判断是否达阈值 |
| 工作区快照 | stash / reflog 防误操作 |

如果各插件各自 `use git2` 直接操作仓库,会出现：
- 状态不一致（多处持有 Repository 句柄互相干扰）
- 错误处理碎片化
- 认证逻辑重复
- 无法统一加锁/事件通知

**正确做法**：Git 模块是唯一拥有仓库句柄的入口,对外暴露**领域级接口**（不是 git2 的裸 API 透传），插件通过它获取服务。

### 架构角色

```
┌─────────────────────────────────────────────────────┐
│                     插件层                           │
│  备份插件 │ 复习插件 │ AI 插件 │ 数据库 │ 部署 │ ...  │
└─────┬─────┴────┬─────┴────┬────┴────┬───┴──┬───┘
      │          │          │         │      │
      ▼          ▼          ▼         ▼      ▼
┌─────────────────────────────────────────────────────┐
│              gt-git（Git 基础能力 crate）             │
│  repo · status · commit · branch · remote · log     │
│  stash · diff · auth · event-bus · data-mining      │
└─────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                  git2（libgit2 绑定）                 │
└─────────────────────────────────────────────────────┘
```

---

## 二、能力全图

### A. 仓库生命周期

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `open(path)` | 打开已有仓库（支持 discover 向上查找 .git） | 所有 |
| `init(path)` | 初始化新仓库 | 备份（首次使用） |
| `repo_info()` | 返回路径、是否 bare、HEAD ref | UI 状态栏 |
| `is_repo(path)` | 静态探测某目录是否为 git 仓库 | 选目录时预判 |
| `close()` / RAII | 释放句柄 | 切换仓库时 |

### B. 状态查询（读操作）

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `current_branch()` | HEAD 指向的分支短名 | UI、备份、部署 |
| `branches()` | 所有本地/远程分支列表 | 分支管理面板 |
| `status()` | 工作区 + 暂存区变更文件列表（M/A/D/R/?） | 备份面板 |
| `status_file(path)` | 单文件状态 | 文件监听触发后增量查询 |
| `diff_workdir()` | 工作区 diff（文件级或行级） | 预览变更 |
| `diff_staged()` | 暂存区 diff | 提交前确认 |
| `diff_commits(a, b)` | 两次提交之间的 diff | 历史比对 |
| `remotes()` | 远程列表(name + url) | 设置面板 |

### C. 变更操作（写操作）

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `stage_all()` | 暂存所有变更（index add_all） | 备份一键提交 |
| `stage_files(paths)` | 选择性暂存 | 精细化备份 |
| `unstage_files(paths)` | 从暂存区移除 | 操作反悔 |
| `discard_files(paths)` | 丢弃工作区变更（checkout 文件） | 慎用，需确认 |
| `commit(message)` | 创建提交 | 备份、定时、监听触发 |
| `commit_amend(message)` | 追加到上一个提交 | 快速修正 |
| `auto_commit_message()` | 根据变更列表生成默认信息（纯格式化，不调 AI） | 机器人模式 |

### D. 分支操作

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `create_branch(name)` | 创建分支 | 备份分支 `backup/2026-06-23` |
| `checkout_branch(name)` | 切换分支 | 工作流切换 |
| `delete_branch(name)` | 删除本地分支 | 清理旧备份 |
| `merge_branch(source)` | 合并（fast-forward 优先） | 备份合回主分支 |
| `create_backup_branch()` | 语义化封装：创建 `backup/<日期时间>` 分支并切过去 | 备份一键操作 |

### E. 远程操作

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `push(remote, branch)` | 推送 | 备份、部署 |
| `pull(remote, branch)` | 拉取并合并 | 跨端同步 |
| `fetch(remote)` | 仅拉取不合并 | 状态检测 |
| `set_remote_url(name, url)` | 修改远程地址 | 设置面板 |
| `add_remote(name, url)` | 添加远程 | 多远程 |

**认证子系统**（被上述远程操作消费）：

| 接口 | 说明 |
| --- | --- |
| `auth_config()` | 读取当前认证配置 |
| `set_auth(config)` | 设置认证方式（SSH key / PAT / credential helper） |
| `test_connection(remote)` | 验证认证是否可用 |

认证方式:
- SSH Key（`~/.ssh/id_ed25519`，可指定其他路径 + passphrase）
- Personal Access Token (PAT)
- Credential Helper（委托系统钥匙串 / git-credential-manager）

### F. 安全与恢复

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `stash_save(message?)` | 工作区快照 | 防误操作、切换分支前自动 stash |
| `stash_list()` | 列出所有 stash | 恢复面板 |
| `stash_pop(index?)` | 弹出 stash 恢复工作区 | 恢复 |
| `stash_drop(index)` | 删除 stash | 清理 |
| `reflog(limit)` | HEAD 引用日志 | 找回被 reset 掉的提交 |
| `snapshot_before_dangerous_op()` | 语义封装：在危险操作前自动 stash + 记录 reflog 位置 | 内部调用 |

### G. 历史与数据挖掘（为上层模块提供加工后的结构化数据）

| 接口 | 说明 | 消费者 |
| --- | --- | --- |
| `log(limit?, since?, path?)` | 通用提交历史查询（支持按路径过滤） | 数据库、UI |
| `file_last_modified_map()` | 全仓库每个文件最后一次被修改的时间 | 复习曲线核心依赖 |
| `file_commit_count_map()` | 每个文件被提交过的次数 | 累积文件打标、活跃排行 |
| `commit_frequency(range)` | 按日/周/月统计提交数 | 数据面板、成就系统 |
| `contributors()` | 贡献者列表（多人协作场景） | 数据面板 |
| `messages(limit?)` | 导出历史 commit message 列表 | AI 学习提交风格 |

> **关键设计点**：这些数据挖掘接口的计算开销可能较大（需遍历全量 log）。
> 应做缓存策略：首次打开仓库时全量构建 → 后续增量更新（监听新 commit 后 append）。
> 缓存可存为 `.gittributary/cache.json` 或 SQLite，放在仓库根目录（类似 Obsidian 的 `.obsidian/`）。

### H. 事件总线（让插件订阅 Git 状态变化）

设计一个内部事件机制，当 Git 操作执行后发出事件，插件可以监听。

```rust
pub enum GitEvent {
    /// 仓库打开/切换
    RepoOpened { path: PathBuf },
    /// 工作区状态变化（配合文件监听使用）
    StatusChanged,
    /// 新提交创建
    CommitCreated { id: String, message: String },
    /// 推送完成
    PushCompleted { remote: String, branch: String },
    /// 分支切换
    BranchSwitched { from: String, to: String },
    /// Stash 变动
    StashChanged,
}
```

插件注册监听器（callback 或 channel），Git 模块操作后广播事件。这样：
- 文件监听插件检测到文件变化 → 通知 Git 模块 refresh status → Git 广播 `StatusChanged` → 前端 UI 自动刷新
- 备份插件 commit 成功 → Git 广播 `CommitCreated` → 数据库插件增量更新索引 → 复习插件刷新时间表

---

## 三、跨模块协作示意

### 场景 1：一键备份
```
用户点击「提交并推送」
→ 备份插件调用 gt-git.stage_all()
→ 备份插件调用 gt-git.commit(message)
→ gt-git 广播 CommitCreated
→ 备份插件调用 gt-git.push("origin", "main")
→ gt-git 广播 PushCompleted
→ 前端收到事件，显示成功 toast
```

### 场景 2：定时机器人备份
```
定时器触发（每 30 分钟）
→ gt-git.status() → 判断有无变更
→ 有变更 → gt-git.stage_all() + gt-git.commit(auto_message)
→ gt-git.push(...)
→ 无变更 → skip
```

### 场景 3：复习曲线构建
```
复习插件初始化
→ 调用 gt-git.file_last_modified_map()
→ 拿到 HashMap<PathBuf, DateTime>
→ 与 FSRS 算法结合，计算每个文件的下次复习日期
→ 展示今日待复习列表
```

### 场景 4：文件监听 + 增量 Git 刷新
```
文件监听插件检测到 notes/xxx.md 被修改
→ 通知 gt-git.refresh_status()  (或直接 status_file)
→ gt-git 广播 StatusChanged
→ 备份面板 UI 自动刷新变更列表
→ 若「累积打标」插件在监听，检查该文件 commit 次数是否达阈值
```

### 场景 5：AI Push 检查
```
用户点击 push
→ 备份插件先调 gt-git.diff_staged()
→ 将 diff 传给 AI 插件做敏感信息检测
→ AI 返回"安全" → 执行 push
→ AI 返回"发现手机号" → 弹窗警告，用户确认后才 push
```

---

## 四、数据结构（核心类型）

```rust
use std::path::PathBuf;
use chrono::{DateTime, Utc};

/// 文件变更状态
#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: PathBuf,
    pub kind: ChangeKind,
    /// 文件大小（字节），方便 UI 展示
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed { from: PathBuf },
    Untracked,
    Conflicted,
}

/// 提交信息
#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub id: String,         // SHA hex
    pub short_id: String,   // 前 7 位
    pub message: String,
    pub author: String,
    pub email: String,
    pub time: DateTime<Utc>,
    /// 该提交涉及的文件路径（可选，按需加载）
    pub files: Option<Vec<PathBuf>>,
}

/// 分支信息
#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub last_commit: Option<CommitInfo>,
}

/// 远程信息
#[derive(Debug, Clone, Serialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
}

/// 认证配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthConfig {
    /// SSH 密钥认证
    SshKey {
        private_key_path: PathBuf,
        passphrase: Option<String>,  // 加密存储
    },
    /// Personal Access Token
    Token {
        token: String,  // 加密存储
    },
    /// 委托系统 credential helper
    CredentialHelper,
}

/// 仓库概况（打开仓库后的快照）
#[derive(Debug, Clone, Serialize)]
pub struct RepoOverview {
    pub path: PathBuf,
    pub current_branch: String,
    pub is_dirty: bool,
    pub changed_count: usize,
    pub remote_url: Option<String>,
    pub last_commit: Option<CommitInfo>,
}
```

---

## 五、Crate 架构

```
crates/gt-git/
├── Cargo.toml
│     dependencies: git2, thiserror, serde, chrono, tokio (optional)
├── src/
│   ├── lib.rs            # pub mod + GitRepo 主结构体
│   ├── error.rs          # GitError（统一错误类型，thiserror）
│   ├── repo.rs           # 仓库生命周期：open / init / info / is_repo
│   ├── status.rs         # 状态查询：branch / branches / status / diff
│   ├── commit.rs         # 变更操作：stage / unstage / commit / amend
│   ├── branch.rs         # 分支管理：create / checkout / delete / merge
│   ├── remote.rs         # 远程操作：push / pull / fetch / auth
│   ├── stash.rs          # 安全恢复：stash / reflog
│   ├── log.rs            # 历史遍历：log / file_log
│   ├── mining.rs         # 数据挖掘：last_modified_map / commit_count / frequency
│   ├── event.rs          # 事件总线：GitEvent + 订阅/广播
│   ├── cache.rs          # 缓存策略：挖掘数据的持久化与增量更新
│   └── message.rs        # commit message 自动生成（纯格式化，非 AI）
└── tests/
    ├── fixtures/         # 测试用的 git 仓库 fixtures
    ├── repo_test.rs
    ├── status_test.rs
    ├── commit_test.rs
    └── ...
```

---

## 六、设计约束与原则

1. **唯一入口**：整个应用只有 `gt-git` 持有 `git2::Repository`，其他模块禁止直接 `use git2`。
2. **领域接口 > 裸 API**：不直接暴露 git2 的 OID / TreeBuilder / Index 等低级概念,封装为业务语义（`stage_all`, `create_backup_branch`）。
3. **错误信息友好**：`GitError` 要能直接展示给用户（"当前目录不是 Git 仓库"，而非 "Repository not found; class=Repository (6); code=NotFound (-3)"）。
4. **线程安全**：`GitRepo` 需要考虑并发（定时器线程 / 文件监听线程 / 前端请求）。推荐 `Arc<Mutex<Repository>>` 或按操作分离读写锁。
5. **事件驱动**：每个写操作完成后必须广播事件,让订阅者（UI / 其他插件）响应。
6. **缓存与性能**：数据挖掘（file_last_modified_map 等）在大仓库可能很慢。首次全量、后续增量,缓存落盘。
7. **可测试**：核心逻辑用 temp_dir + `git2` 创建测试仓库做集成测试,不依赖真实笔记仓库。
8. **不侵入笔记仓库**：gt-git 产生的缓存/配置文件统一放 `.gittributary/` 目录（可全局 gitignore 或写入仓库 `.gitignore`）,不污染 git history。

---

## 七、与 Tauri / 前端的接口契约

gt-git 本身是纯 Rust crate。Tauri 层做薄胶水:

```rust
// src-tauri/src/commands/git.rs

#[tauri::command]
async fn open_repo(path: String, state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let repo = GitRepo::open(&path).map_err(|e| e.to_user_string())?;
    let overview = repo.overview()?;
    state.set_repo(repo);
    Ok(overview)
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, String> {
    state.repo()?.status().map_err(...)
}

#[tauri::command]
async fn commit_all(message: String, state: State<'_, AppState>) -> Result<CommitInfo, String> {
    let repo = state.repo()?;
    repo.stage_all()?;
    repo.commit(&message).map_err(...)
}
```

前端通过 `invoke("open_repo", { path })` 调用,拿到 `RepoOverview` 渲染 UI。

事件推送用 Tauri 的 `app.emit("git:status-changed", payload)`,前端 `listen("git:status-changed", ...)` 订阅。

---

## 八、实现路线（渐进式）

| 阶段 | 接口 | 说明 |
| --- | --- | --- |
| **P0 · 最小可用** | open / is_repo / current_branch / status / stage_all / commit | 备份面板接入真实数据 |
| **P1 · 远程** | push / pull / auth (SSH + PAT) / test_connection | 一键推送闭环 |
| **P2 · 分支** | create_branch / checkout / merge / delete / create_backup_branch | 备份分支工作流 |
| **P3 · 安全** | stash_save / stash_list / stash_pop / snapshot_before_dangerous_op | 防误操作 |
| **P4 · 历史与挖掘** | log / file_last_modified_map / file_commit_count_map / frequency | 复习曲线、数据库、打标 |
| **P5 · 事件总线** | GitEvent / subscribe / broadcast | 插件间响应式联动 |
| **P6 · 缓存** | cache 持久化 + 增量更新 | 大仓库性能 |
| **P7 · 高级** | diff (行级) / commit_amend / reflog / messages export / auto_message | AI 集成、精细操作 |

---

## 九、开放问题（待后续讨论）

1. **并发模型**：`Arc<Mutex<Repository>>` 够用还是需要读写锁(`RwLock`)？定时器线程和前端请求是否存在锁竞争？
2. **多仓库**：是否需要同时打开多个笔记仓库？如果需要,`AppState` 要管理 `HashMap<PathBuf, GitRepo>` 而非单例。
3. **大仓库性能**：10 万级 commit 的仓库,`file_last_modified_map` 全量遍历耗时？是否需要后台线程 + progress 事件？
4. **子模块（submodule）**：图片伴生库如果作为 submodule 引入,gt-git 是否需要支持 submodule 操作？
5. **Partial clone / Shallow**：移动端或带宽受限时是否需要 shallow clone 支持？
6. **冲突解决**：pull 时遇到冲突,是自动 abort 还是提供 UI 让用户解决？
7. **加密存储**：`AuthConfig` 中的 token / passphrase 如何安全存储？系统钥匙串 vs 自建加密？

---

## 十、一句话总结

> gt-git 是 GitTributary 的心脏：唯一持有仓库句柄,暴露领域级接口,广播状态事件。
> 所有插件都是它的消费者,不直接碰 git2。先做 P0 打通备份闭环,再沿路线渐进扩展。
