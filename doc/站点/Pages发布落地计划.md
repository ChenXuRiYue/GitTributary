# 静态发布仓库配置实施计划

> 更新时间: 2026-06-30
> 范围: 优先改造 `site` 插件,让静态站点功能支持选择和保存 Pages 发布仓库配置。

## 一、实施原则

本计划聚焦 Site 部分先落地,避免一开始同时改 Git、Flow、发布执行器三条链路。

首阶段目标不是"真正发布到 GitHub Pages",而是先把静态发布的产品入口、发布仓库候选、目标配置和状态展示打通。后续再把构建产物同步、commit、push 接到这份配置上。

## 二、当前可复用能力

### 2.1 Site 插件已有能力

当前 `SitePanel` 已经具备:

- 读取当前工作区仓库。
- 通过插件 backend 的 `site.scan` 扫描文档。
- 通过插件 backend 的 `site.build` 生成静态 HTML。
- 通过宿主 Store Extension API 持久化站点构建配置。
- 构建成功后展示输出目录、`index.html`、warning、broken links。

### 2.2 Git 远程配置已有能力

当前后端已有:

- `get_remote_configs`:聚合展示本地 Git remote、绑定仓库 remote、数据中心远程。
- `clone_remote_repo`:clone 远程仓库到本地并绑定。
- `add_remote` / `set_remote_url` / `remove_remote`:普通 remote 管理能力。
- `git_push`:推送当前仓库当前分支。

首阶段 Site 插件只复用 `get_remote_configs` 作为发布仓库候选来源,不新增 Git 模块仓库登记表。

## 三、阶段拆分

### Phase 1: Site 内配置 Pages 发布目标

目标:用户能在静态站点插件里从已有仓库配置中选择一个 Pages 发布仓库,补充分支、发布目录、Pages URL,并持久化到 Store。

不做:

- 不执行文件同步。
- 不执行 commit/push。
- 不新增 Flow 节点。
- 不改 GitHub Pages 设置。

### Phase 2: Site 内发布前预检

目标:基于 Phase 1 的配置,检查构建产物和目标仓库是否满足发布条件。

不做:

- 默认不覆盖目标仓库文件。
- 不自动 commit/push。

### Phase 3: Site 内手动发布闭环

目标:在插件 backend 实现 `site.publish`,完成构建产物同步、提交和推送。

### Phase 4: Flow 节点化

目标:把 Phase 3 的能力拆成 Flow 节点,支持手动触发和 commit 后自动发布。

## 四、Phase 1 详细计划

### 4.1 新增前端类型

在 `plugins/site-publisher/frontend/src/site/SitePanel.tsx` 中新增类型:

```ts
interface RemoteConfigEntry {
  name: string;
  url: string;
  push_url: string | null;
  repo_path: string | null;
  source: string;
  purpose: string[];
  credential_mode: string;
  credential_ref: string | null;
  verify_status: string;
  capabilities: string;
}

interface SitePublishTargetState {
  version: 1;
  id: string;
  name: string;
  sourceRepoPath: string;
  targetRepoId: string;
  targetRepoName: string;
  targetRepoUrl: string;
  targetLocalPath: string;
  targetBranch: string;
  publishDir: string;
  remoteName: string;
  pagesUrl: string;
  autoCommitMessage: string;
  updatedAt: number;
}
```

说明:

- `RemoteConfigEntry` 先复用后端 `get_remote_configs` 返回结构。
- `SitePublishTargetState` 是 Site 插件自己的发布目标配置。
- `targetRepoId` 首版可用 `repo_path || url || name` 生成稳定 key,后续再切到 Git 仓库登记表 ID。

### 4.2 新增 Store key

继续使用 `sites` 命名空间,减少首阶段后端改动:

```text
namespace: sites
key: publish.<repo_hash>
```

也可以预留常量:

```ts
const SITE_PUBLISH_KEY_PREFIX = "publish.";
```

Phase 1 暂不新增新的 Store namespace。

### 4.3 加载发布仓库候选

在 `SitePanel` 初始化和刷新时调用:

```ts
const remotes = await invoke<RemoteConfigEntry[]>("get_remote_configs");
```

前端过滤候选:

- 包含 `repo_path` 的本地仓库优先。
- `source === "local_git_config"` 的本地 Git 配置可作为候选。
- `purpose` 包含 `data_center_sync` 的候选默认不作为 Pages 发布仓库,除非用户高级选择。
- 当前源仓库自身默认不推荐作为 Pages 仓库,避免产物污染源仓库。

候选排序:

1. `purpose` 包含 `publish_target` 或 `pages-target`。
2. 有 `repo_path` 的本地仓库。
3. 当前已保存发布目标匹配的仓库。
4. 其他 remote。

### 4.4 解析候选展示信息

前端增加 helper:

```ts
function publishCandidateId(remote: RemoteConfigEntry): string
function publishCandidateName(remote: RemoteConfigEntry): string
function publishCandidateStatus(remote: RemoteConfigEntry): "ready" | "needs-local" | "not-recommended"
function inferPagesUrl(remoteUrl: string, branch: string): string
```

首版 `inferPagesUrl` 只做 GitHub URL 的基础推导:

```text
git@github.com:user/repo.git -> https://user.github.io/repo/
https://github.com/user/repo.git -> https://user.github.io/repo/
user.github.io 仓库 -> https://user.github.io/
```

如果推导失败,留空让用户手动填。

### 4.5 UI 插入位置

在 `SitePanel` 右侧主区域中,建议放在"构建结果"之前新增一个 section:

```text
Pages 发布
  发布目标状态
  发布仓库候选
  分支 / 发布目录 / Pages URL
  保存配置
```

原因:

- 发布目标是构建之后的下一步,放在右侧主流程更自然。
- 左侧当前已经承载源仓库、输出和构建选项,继续塞发布仓库会过密。

### 4.6 UI 状态设计

#### 未选择发布仓库

```text
Pages 发布
  从已有仓库配置中选择发布仓库。

  [选择发布仓库 v]
```

#### 选择了可发布仓库

```text
Pages 发布
  发布仓库: notes-site
  本地副本: /Users/mi/publish/notes-site
  远程: git@github.com:user/notes-site.git

  分支: [gh-pages]
  发布目录: [/]
  Pages URL: [https://user.github.io/notes-site/]

  [保存发布目标]
```

#### 候选只有远程 URL,没有本地副本

```text
该仓库还没有本地工作副本,暂不能发布。
请先在远程配置中 Clone,或绑定本地仓库。

[去远程配置]
```

首阶段不在 Site 内实现 Clone 表单,避免重复 RemoteView 的复杂逻辑。

### 4.7 持久化行为

保存发布目标时写入:

```ts
await invoke("store_set", {
  namespace: "sites",
  key: sitePublishKey(repoPath),
  value: publishTarget,
});
```

加载仓库扫描配置时同时尝试恢复:

```ts
const raw = await invoke<unknown>("store_get", {
  namespace: "sites",
  key: sitePublishKey(report.repoPath),
});
```

恢复时如果候选列表中找不到已保存的 `targetRepoId`,仍保留配置,但 UI 标记为:

```text
发布仓库未在当前配置中找到
```

### 4.8 与现有构建配置的关系

不要把发布目标塞进现有 `SiteBuildUiState`,避免构建配置和发布配置生命周期耦合。

保留两个独立对象:

```text
build.<repo_hash>   -> 构建配置
publish.<repo_hash> -> 发布目标配置
```

## 五、Phase 1 验收标准

- 打开 Site 插件后能加载已有远程仓库候选。
- 候选列表能显示仓库名、本地路径、远程 URL、凭据状态、用途标签。
- 用户能选择一个有本地工作副本的候选作为 Pages 发布仓库。
- 用户能编辑目标分支、发布目录、Pages URL 和提交信息。
- 点击保存后配置写入 Store。
- 切换到其他插件再回来,配置能恢复。
- 重启应用后配置仍能恢复。
- 如果候选缺少本地路径,UI 明确提示暂不能发布。
- 当前源仓库自身不作为首推候选。

## 六、Phase 1 文件改动范围

### 必改

```text
plugins/site-publisher/frontend/src/site/SitePanel.tsx
```

新增内容:

- `RemoteConfigEntry` 类型。
- `SitePublishTargetState` 类型。
- 发布目标解析/校验 helper。
- 发布仓库候选状态。
- 发布目标持久化。
- `Pages 发布` UI section。

### 可选

```text
doc/站点/Pages发布目标设计.md
```

如果实现中发现模型需要调整,同步更新该设计文档。

### 暂不改

```text
plugins/site-publisher/backend/crates/gt-site/src/lib.rs
src-tauri/crates/gt-git/src/*
src-tauri/crates/gt-flow/src/*
```

Phase 1 不需要后端新能力。

## 七、Phase 2 详细计划

Phase 2 在 Site 插件中新增"发布前检查"按钮。

### 7.1 新增插件后端方法

```text
site.checkPublishTarget
```

检查内容:

- `targetLocalPath` 是否存在。
- `targetLocalPath` 是否为 Git 仓库。
- `publishDir` 是否在目标仓库内。
- 目标仓库是否有未提交变更。
- `remoteName` 是否存在。
- `targetBranch` 是否存在或可创建。
- 构建输出目录是否存在 `index.html`。

### 7.2 UI 展示

```text
发布前检查
  构建产物: 通过
  目标仓库: 通过
  工作区状态: 有未提交变更
  远程配置: origin 已配置
```

Phase 2 仍不执行同步和推送。

## 八、Phase 3 详细计划

Phase 3 实现手动发布。

### 8.1 新增插件后端方法

```text
site.publish
```

### 8.2 执行顺序

```text
1. 调用 gt_site::build_site 重新构建。
2. 校验 outputDir/index.html。
3. 打开 targetLocalPath。
4. 切换或确认 targetBranch。
5. 清理 publishDir,保留 .git。
6. 复制 outputDir 内容到 publishDir。
7. 写入 .nojekyll。
8. stage。
9. 若无变更,返回 no_change。
10. commit。
11. push remoteName targetBranch。
12. 返回报告。
```

### 8.3 风险控制

- 目标仓库存在未提交变更时默认阻止。
- `publishDir=/` 时清理逻辑必须显式跳过 `.git`。
- `targetLocalPath === sourceRepoPath` 时默认阻止。
- 同步前展示将要覆盖的目录。

## 九、建议任务切分

### Task 1: 发布目标状态模型

- 在 `SitePanel` 新增类型、key、parse helper。
- 增加发布目标读取/保存逻辑。
- 不改 UI 或只输出调试状态。

### Task 2: 候选仓库读取与过滤

- 调用 `get_remote_configs`。
- 转换为 `PublishRepoCandidate`。
- 处理 loading/error/empty 状态。

### Task 3: Pages 发布 UI

- 新增右侧 section。
- 展示候选列表。
- 支持选择候选并编辑分支、目录、URL。
- 支持保存配置。

### Task 4: 恢复与边界状态

- 处理候选消失。
- 处理无本地路径。
- 处理当前源仓库被选为目标仓库。
- 完成 UI 文案和禁用规则。

### Task 5: Phase 1 验证

- `npm run build`。
- `npm run tauri dev` 手测:
  - 有当前仓库 remote。
  - 无候选。
  - 保存后切换页面恢复。
  - 重启后恢复。

## 十、推荐先做顺序

建议先做:

```text
Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
```

这条路径可以在不新增后端接口的情况下先完成产品骨架。等用户能在 Site 插件中选择并保存 Pages 发布仓库后,再进入 Phase 2/3 接真正发布动作。
