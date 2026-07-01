# Pages 发布目标设计

> 更新时间: 2026-06-30
> 范围: Git Tributary 静态站点构建、Git 远程配置、Flow 发布自动化。

## 一、背景

Git Tributary 当前已经具备本地静态站点构建能力:用户可以选择一个本地 Git 仓库,捕捉 Markdown 文档目录,并输出离线 HTML 站点。当前构建结果默认位于:

```text
<repo>/.gittributary/site
```

这个能力解决了"从 Markdown 生成静态 HTML"的问题,但还没有解决"发布到 GitHub Pages"的问题。

用户希望配置一个专门的 Pages 静态仓库,并通过一个发布流完成:

```text
源文档仓库
  -> 构建静态站点
  -> 同步产物到 Pages 目标仓库
  -> 提交
  -> 推送到 GitHub Pages 绑定分支
  -> GitHub Pages 自动发布
```

## 二、目标

### 2.1 产品目标

- 支持把本地 Markdown 仓库构建成静态站点并发布到 GitHub Pages。
- 支持独立配置 Pages 发布目标仓库,不要求用户把构建产物放回源仓库。
- 支持像数据中心选择配置数据库一样,从已有仓库配置中选择 Pages 发布仓库。
- 支持手动发布闭环:构建、同步、提交、推送、结果提示。
- 为后续 Flow 自动发布提供稳定的底层动作。

### 2.2 用户体验目标

用户可以在 Git Tributary 中完成:

```text
选择源仓库
  -> 从已有仓库配置中选择 Pages 发布仓库
  -> 必要时新增 / Clone / 绑定发布仓库
  -> 设置目标分支和发布目录
  -> 一键构建并发布
  -> 打开 Pages URL 或查看发布结果
```

### 2.3 非目标

- 不在首版内创建 GitHub 远程仓库。
- 不在首版内调用 GitHub Pages API 修改仓库 Pages 设置。
- 不在首版内实现自定义域名、证书、部署状态轮询。
- 不把 Pages 发布目标简单等同于普通 Git remote;普通 remote 只能表达 URL,不能完整表达发布语义。
- 不要求用户每次手动输入 Pages 仓库 URL;已有仓库配置应优先复用。

## 三、当前能力与缺口

### 3.1 当前已有

- `site_scan` / `site_build`:扫描文档并构建静态 HTML。
- Git remote 基础能力:`add_remote`、`set_remote_url`、`remove_remote`、`git_push`。
- 远程配置聚合视图:可以展示当前仓库 remote、数据中心远程等配置。
- Flow 设计中已经预留构建与发布链路。
- 数据中心已经采用"从候选配置数据库中选择,没有候选再创建/导入"的交互模型。

### 3.2 当前缺口

- 没有 Pages 发布目标配置模型。
- 没有 Pages 发布仓库候选列表与选择器。
- 没有专门的"Pages 仓库"新增、验证、绑定 UI。
- 没有目标本地工作副本管理。
- 没有构建产物同步到目标仓库的能力。
- 没有发布前预检和差异预览。
- 没有完整的 `build -> sync -> commit -> push` 执行链路。
- Flow 节点定义有设计雏形,但缺真实执行实现。

## 四、核心概念

### 4.1 源仓库

源仓库是用户的 Markdown / 文档仓库,负责保存内容源文件。

常见分支:

```text
main
master
docs
```

### 4.2 Pages 目标仓库

Pages 目标仓库是 GitHub Pages 绑定的静态仓库,负责保存构建后的 HTML 产物。

推荐模式:

```text
源仓库:      user/notes
Pages 仓库: user/notes-site
目标分支:    gh-pages 或 main
发布目录:    /
```

### 4.3 发布目标配置

发布目标配置不是 Git remote 本身,而是一层 Git Tributary 的领域配置。它引用源仓库、目标仓库、目标分支、发布目录等信息。

```json
{
  "version": 1,
  "id": "github-pages",
  "name": "个人文档站",
  "sourceRepoPath": "/Users/mi/notes",
  "sourceInclude": ["README.md", "doc"],
  "siteTitle": "个人文档站",
  "buildOutputDir": "/Users/mi/notes/.gittributary/site",
  "targetRepoId": "github:user/notes-site",
  "targetRepoUrl": "git@github.com:user/notes-site.git",
  "targetLocalPath": "/Users/mi/publish/notes-site",
  "targetBranch": "gh-pages",
  "publishDir": "/",
  "remoteName": "origin",
  "pagesUrl": "https://user.github.io/notes-site/",
  "autoCommitMessage": "deploy: 更新静态站点",
  "updatedAt": 1782748800000
}
```

### 4.4 发布仓库候选

发布仓库候选是 Git 模块或 GitTributary 配置中已经登记过、可被静态发布复用的仓库条目。它类似数据中心里的"配置数据库候选",但用途是承载静态站点发布产物。

候选来源:

| 来源 | 说明 | 是否可直接发布 |
| --- | --- | --- |
| 已绑定本地 Git 仓库 | 用户打开过、clone 过或被 GitTributary 绑定过的本地仓库 | 是 |
| Git 远程配置条目 | 已保存 URL 和凭据,但未必有本地 checkout | 否,需要先 clone 或绑定本地路径 |
| 发布目标历史配置 | 之前保存过的 Pages 发布目标 | 是,若本地路径仍存在 |
| 数据中心式仓库登记表 | 后续 Git 模块统一维护的仓库注册表 | 视 `localPath` 是否存在 |

候选最小结构:

```json
{
  "repoId": "github:user/notes-site",
  "name": "notes-site",
  "remoteUrl": "git@github.com:user/notes-site.git",
  "localPath": "/Users/mi/publish/notes-site",
  "defaultBranch": "gh-pages",
  "purposes": ["pages-target"],
  "credentialMode": "ssh_agent",
  "verifyStatus": "configured"
}
```

静态发布只对有本地工作副本的候选执行文件同步、提交和推送。只有远程 URL、没有本地路径的候选,必须先进入"拉取到本地"或"绑定已有本地目录"步骤。

## 五、推荐产品方案

### 5.1 像数据中心一样选择发布仓库

静态发布不应从空表单开始要求用户填写 Pages 仓库 URL,而应先展示已有发布仓库候选。

推荐流程:

```text
打开静态站点
  -> Pages 发布
  -> 选择发布仓库
  -> 展示已有候选列表
  -> 用户选择一个已有仓库
  -> 补充分支、发布目录、Pages URL
  -> 保存为当前源仓库的发布目标
```

如果没有可用候选:

```text
无候选
  -> 新增发布仓库
  -> 输入 GitHub 仓库 URL
  -> 验证凭据
  -> Clone 到本地工作副本
  -> 标记用途 pages-target
  -> 保存为发布目标
```

职责边界沿用数据中心方案:

| 模块 | 职责 |
| --- | --- |
| 静态站点插件 | 选择发布仓库、保存发布目标、发起构建发布 |
| Git 模块 | 提供仓库候选、远程验证、clone、commit、push |
| Store | 保存发布目标、活跃发布目标、发布历史 |
| Flow | 在后续阶段把发布动作自动化 |

### 5.2 推荐使用独立 Pages 仓库

首版推荐独立 Pages 仓库,而不是源仓库 `gh-pages` worktree。

优点:

- 源内容和发布产物边界清晰。
- 不污染源仓库分支与历史。
- 对用户心智更简单:一个仓库写内容,一个仓库托管站点。
- 后续支持多个发布目标更自然。
- 和"从已有仓库配置中选择发布仓库"的交互一致。

### 5.3 兼容同仓库 gh-pages 分支

后续可以补充同仓库模式:

```text
源仓库 main 分支: Markdown 内容
源仓库 gh-pages 分支: HTML 产物
```

该模式建议通过 Git worktree 实现,避免频繁 checkout 打断用户当前工作区。

## 六、用户流程

### 6.1 首次配置

```text
进入静态站点插件
  -> 扫描源仓库文档
  -> 点击"配置 Pages 发布目标"
  -> 从已有发布仓库候选中选择
  -> 若无候选,新增远程 URL 并 Clone / 绑定本地仓库
  -> 验证远程仓库访问与本地工作副本状态
  -> 设置目标分支和发布目录
  -> 保存配置
```

### 6.2 手动发布

```text
点击"发布到 Pages"
  -> 构建静态站点
  -> 检查输出目录存在且非空
  -> 检查目标仓库分支
  -> 清理目标发布目录
  -> 同步构建产物
  -> 展示将要提交的变更摘要
  -> 提交
  -> 推送
  -> 展示 Pages URL
```

### 6.3 发布失败

失败时保留构建产物和目标仓库工作区,并展示:

- 失败阶段。
- 错误信息。
- 可重试按钮。
- 打开构建目录。
- 打开目标仓库目录。
- 查看目标仓库 Git 状态。

## 七、UI 设计

### 7.1 静态站点插件新增发布区

建议在 `SitePanel` 右侧构建结果附近新增:

```text
Pages 发布
  发布目标: 个人文档站
  发布仓库: notes-site
  目标仓库: git@github.com:user/notes-site.git
  本地副本: /Users/mi/publish/notes-site
  分支: gh-pages
  发布目录: /
  Pages URL: https://user.github.io/notes-site/

  [配置] [构建] [发布到 Pages]
```

### 7.2 Pages 发布目标配置弹窗

字段:

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `name` | 发布目标名称 | 仓库名 + Pages |
| `targetRepoCandidate` | 从已有仓库配置中选择发布仓库 | 首个 `pages-target` 候选 |
| `targetRepoUrl` | Pages 仓库 URL | 由候选带出,允许高级编辑 |
| `targetLocalPath` | Pages 仓库本地副本 | 由候选带出;无本地副本时提示 Clone / 绑定 |
| `targetBranch` | Pages 发布分支 | `gh-pages` |
| `publishDir` | 发布目录 | `/` |
| `remoteName` | 推送 remote | `origin` |
| `pagesUrl` | 站点 URL | 根据 GitHub URL 推导,允许编辑 |
| `authMode` | 认证方式 | 项目 Token / SSH |

主要操作:

- 选择已有发布仓库。
- 验证远程。
- Clone 到本地。
- 绑定已有本地仓库。
- 标记为 Pages 发布仓库。
- 保存配置。
- 解绑配置。

候选列表展示字段:

| 字段 | 说明 |
| --- | --- |
| 仓库名 | 由远程 URL 或本地路径推导 |
| 本地路径 | 有本地工作副本时展示 |
| 远程 URL | 脱敏展示 owner/repo |
| 用途标签 | `pages-target`、`bound-repo`、`current-repo` 等 |
| 凭据状态 | 项目 Token、SSH、全局 Token、未配置 |
| 可用状态 | 可发布、需绑定本地目录、需验证凭据 |

### 7.3 Git 远程配置页调整

Git 远程配置页继续展示普通 remote。

如果某个仓库被 Pages 发布目标引用,可以在列表中显示标签:

```text
发布目标
Pages
```

但不建议把 Pages 配置完整塞进普通 remote 表单。

### 7.4 发布仓库空状态

当没有可用发布仓库候选时,展示:

```text
暂无可用 Pages 发布仓库
  [从 GitHub 仓库 Clone]
  [绑定本地仓库]
```

当存在远程候选但没有本地工作副本时,展示:

```text
已找到远程仓库,需要先拉取到本地才能发布
  git@github.com:user/notes-site.git
  [Clone 到本地]
  [选择已有本地目录]
```

## 八、数据存储

### 8.1 Store 命名空间

建议新增命名空间:

```text
sites.publish_targets
```

发布仓库候选建议由 Git 模块提供,Store 只保存静态发布自己的选择结果。后续如果 Git 模块落地统一仓库登记表,发布目标应只引用稳定的 `repoId`,避免复制一份长期漂移的仓库元信息。

Key 设计:

```text
target.<source_repo_hash>.<target_id>
active.<source_repo_hash>
```

### 8.2 发布记录

建议保存最近发布记录,便于 UI 展示和排错:

```json
{
  "version": 1,
  "targetId": "github-pages",
  "sourceRepoPath": "/Users/mi/notes",
  "targetLocalPath": "/Users/mi/publish/notes-site",
  "targetBranch": "gh-pages",
  "commit": "abc123",
  "pageCount": 42,
  "assetCount": 12,
  "status": "succeeded",
  "startedAt": 1782748800000,
  "finishedAt": 1782748812000,
  "durationMs": 12000,
  "message": "发布成功"
}
```

## 九、发布执行设计

### 9.1 手动发布命令

建议新增 Tauri command:

```rust
#[tauri::command]
fn site_publish_pages(
    target: PagesPublishTarget,
    build_config: SiteBuildConfig,
    options: PagesPublishOptions,
) -> Result<PagesPublishReport, String>
```

### 9.2 执行步骤

```text
1. 读取发布目标配置。
2. 运行 site_build。
3. 校验 outputDir 存在且包含 index.html。
4. 打开 targetLocalPath 仓库。
5. 确认当前分支或切换到 targetBranch。
6. 清空 publishDir 中旧产物。
7. 复制 outputDir 内容到 publishDir。
8. 写入 .nojekyll。
9. 读取目标仓库 status。
10. 如果无变更,返回 no_change。
11. stage publishDir。
12. commit。
13. push remoteName targetBranch。
14. 返回发布报告。
```

### 9.3 安全规则

- `publishDir` 必须位于 `targetLocalPath` 内。
- 清理目录前必须确认目标仓库是 Git 仓库。
- 不允许清理目标仓库根目录之外的路径。
- 如果目标仓库存在未提交变更,默认阻止发布。
- 允许用户开启"覆盖目标发布目录",但必须在 UI 中明确提示。
- `targetLocalPath` 不能等于 `sourceRepoPath`。
- 如果 `publishDir=/`,清理时必须保留 `.git/`。

### 9.4 `.nojekyll`

发布到 GitHub Pages 时建议默认写入:

```text
.nojekyll
```

这样可以避免 GitHub Pages 的 Jekyll 处理影响以下路径:

```text
_assets
_static
```

## 十、Flow 节点设计

### 10.1 节点列表

首批节点:

| 节点 | 职责 |
| --- | --- |
| `gittributary/site/build@v1` | 构建静态站点 |
| `gittributary/files/assert-exists@v1` | 校验产物存在 |
| `gittributary/files/sync-dir@v1` | 同步构建产物到目标仓库 |
| `gittributary/git/commit@v1` | 提交发布产物 |
| `gittributary/git/push@v1` | 推送目标分支 |
| `gittributary/ui/notify@v1` | 通知发布结果 |

### 10.2 示例 Flow

```yaml
name: 发布静态站点到 GitHub Pages

gt:
  id: flow.publish_site_to_pages
  enabled: false

on:
  workflow_dispatch:

permissions:
  git: [status, add, commit, push]
  files: [read, write, delete]
  store: [read]
  ui: [notify]
  network: true

jobs:
  publish:
    runs-on: gittributary-local
    timeout-minutes: 30
    steps:
      - id: build
        uses: gittributary/site/build@v1
        with:
          target: github-pages

      - id: assert
        uses: gittributary/files/assert-exists@v1
        with:
          path: ${{ steps.build.outputs.output_dir }}/index.html
          non_empty: true

      - id: sync
        uses: gittributary/files/sync-dir@v1
        with:
          from: ${{ steps.build.outputs.output_dir }}
          to: ${{ steps.build.outputs.target_publish_dir }}
          delete: true

      - id: commit
        uses: gittributary/git/commit@v1
        with:
          repo: ${{ steps.build.outputs.target_repo }}
          message: deploy: 更新静态站点

      - id: push
        uses: gittributary/git/push@v1
        with:
          repo: ${{ steps.build.outputs.target_repo }}
          remote: origin
          branch: gh-pages

      - id: notify
        uses: gittributary/ui/notify@v1
        with:
          title: Pages 发布完成
          message: ${{ steps.build.outputs.pages_url }}
```

## 十一、GitHub Pages 绑定说明

首版不自动修改 GitHub Pages 设置,需要用户在 GitHub 仓库中手动配置:

```text
Settings
  -> Pages
  -> Build and deployment
  -> Source: Deploy from a branch
  -> Branch: gh-pages 或 main
  -> Folder: / 或 /docs
```

Git Tributary 只负责把静态产物推送到该分支和目录。

## 十二、里程碑

### M1: Pages 发布目标配置

- 新增发布目标数据结构。
- 新增发布仓库候选列表。
- 新增配置 UI,优先从已有仓库配置中选择。
- 支持验证远程仓库。
- 支持 clone / 绑定目标本地仓库。
- 支持将候选标记为 `pages-target`。
- 支持保存目标分支、发布目录、Pages URL。

### M2: 手动发布闭环

- 新增 `site_publish_pages`。
- 支持构建、同步、提交、推送。
- 支持 `.nojekyll`。
- 支持发布报告。
- 支持失败阶段提示。

### M3: 发布前预检与差异预览

- 检查目标仓库脏状态。
- 展示将要删除/新增/修改的文件数。
- 支持无变更时跳过提交。
- 支持打开目标仓库目录。

### M4: Flow 自动发布

- 将手动发布能力拆成 Flow 节点。
- 支持手动触发 Flow。
- 支持 `git.commit.created` 触发自动发布。
- 支持并发控制。

### M5: Pages 状态增强

- 展示 Pages URL。
- 支持发布后打开站点。
- 可选:通过 GitHub API 检查 Pages 是否启用。
- 可选:展示最近一次 GitHub Pages 构建状态。

## 十三、验收标准

### M1 验收

- 用户可以创建一个 Pages 发布目标。
- 用户可以从已有仓库配置中选择 Pages 发布仓库。
- 当候选仓库没有本地工作副本时,用户可以 clone 或绑定本地目录。
- 用户可以验证远程仓库访问。
- 用户可以 clone 或绑定本地 Pages 仓库。
- 配置能持久化并在重启后恢复。

### M2 验收

- 用户点击一次按钮即可把当前静态站点发布到目标仓库。
- 目标仓库出现 `index.html`、`pages/`、`assets/`。
- GitHub Pages 绑定目标分支后可以访问站点。
- 目标仓库存在未提交变更时,默认阻止覆盖。
- 发布失败时能看到失败阶段和错误信息。

### M4 验收

- 用户可以通过 Flow 手动触发发布。
- 用户可以配置 commit 后自动发布。
- Flow 日志能展示每个步骤的结果。
- 构建失败、同步失败、提交失败、推送失败能分别定位。

## 十四、待讨论问题

- 发布目标配置入口放在"静态站点"插件还是"Git 远程配置"页?
- 发布仓库候选列表由现有 `get_remote_configs` 扩展,还是新增 Git 仓库登记表接口?
- `pages-target` 标签是用户手动标记,还是保存发布目标后自动写入?
- Access Token 是否沿用项目级 token,还是为 Pages 目标单独保存 token?
- 独立 Pages 仓库的默认本地目录放在哪里?
- 首版是否支持同仓库 `gh-pages` worktree?
- 发布目录是否允许 `/docs`,还是首版只支持 `/`?
- 提交信息是否允许模板变量,例如日期、源仓库提交 hash?

## 十五、推荐结论

首版建议采用:

```text
独立 Pages 仓库
  + 从已有仓库配置中选择发布仓库
  + 站点插件内配置发布目标
  + 手动一键发布
  + 默认 gh-pages/root
  + 默认写入 .nojekyll
  + Flow 后置
```

这条路径实现成本可控,用户心智清晰,也能和当前本地静态构建器自然衔接。
