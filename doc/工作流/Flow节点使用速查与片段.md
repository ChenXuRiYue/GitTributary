# Flow 节点使用速查与片段

> 本文按当前源码注册表输出所有可用 Flow 节点的使用方式、特性和简短 YAML 片段。
> 当前内置节点共 8 个。除此之外的 `uses` 尚未登记,运行时会失败。

---

## 一、快速结论

当前支持的 Flow 节点:

| uses | 名称 | 类型 | 一句话用途 |
| --- | --- | --- | --- |
| `gittributary/workspace/resolve-publish-context@v1` | 解析发布上下文 | context | 从工作区和输入解析源仓库、目标仓库、分支和输出目录 |
| `gittributary/notes/build-html@v1` | 构建笔记 HTML | build | 当前占位返回 HTML 输出目录 |
| `gittributary/files/assert-exists@v1` | 校验文件存在 | validate | 检查文件或目录存在,可选要求非空 |
| `gittributary/files/sync-dir@v1` | 同步目录 | sync | 将一个目录递归复制到另一个目录 |
| `gittributary/git/commit-all@v1` | 提交全部变更 | git | 对本地仓库执行 stage all 和 commit |
| `gittributary/git/push@v1` | 推送分支 | git | 将本地仓库分支推送到指定 remote |
| `gittributary/store/sync-now@v1` | 同步数据中心 | sync | 立即执行数据中心同步 |
| `gittributary/ui/notify@v1` | 发送通知 | notify | 当前把通知内容写入运行 message |

节点目录来自后端 `flow_node_catalog` 命令。新增节点需要先在 `gt-flow` 的节点注册表登记,并在应用执行器中实现对应动作。

---

## 二、通用写法

### 2.1 step 基本结构

```yaml
- id: step_id
  uses: gittributary/scope/action@v1
  with:
    key: value
```

约定:

| 字段 | 说明 |
| --- | --- |
| `id` | 推荐必填。后续引用 outputs 时必须稳定 |
| `uses` | 节点动作标识,必须是当前已登记节点 |
| `with` | 节点输入 |

### 2.2 输入与输出

输入写在 `with`:

```yaml
with:
  repo: /Users/mi/rust_code/gt-test
  message: "chore: auto sync ${{ gt.now }}"
```

输出由节点执行后返回,不手动写。下游通过 `steps.<id>.outputs.<field>` 引用:

```yaml
branch: ${{ steps.commit.outputs.branch }}
```

### 2.3 当前表达式

可以在 `with` 的字符串中使用:

| 表达式 | 说明 |
| --- | --- |
| `${{ gt.now }}` | 当前运行时间 |
| `${{ gt.workspace.active_repo }}` | 当前打开的本地仓库 |
| `${{ gt.workspace.active_branch }}` | 当前分支 |
| `${{ event.data.xxx }}` | 事件数据 |
| `${{ inputs.xxx }}` | 手动运行输入。当前 UI 尚未提供输入面板 |
| `${{ steps.<id>.outputs.<field> }}` | 前置节点输出 |

---

## 三、节点详解与片段

### 3.1 解析发布上下文

```text
gittributary/workspace/resolve-publish-context@v1
```

特性:

- 用于 Flow 前置步骤,统一产出仓库、分支和输出目录。
- 输入为空时会从工作区上下文补默认值。
- 输出可被构建、同步、提交、推送节点复用。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `source_repo` | string | 源仓库本地路径 |
| `target_repo` | string | 目标仓库本地路径 |
| `target_branch` | string | 目标分支 |

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `source_repo` | string | 源仓库 |
| `target_repo` | string | 目标仓库 |
| `target_branch` | string | 目标分支 |
| `output_dir` | string | 默认产物目录 |

片段:

```yaml
- id: context
  uses: gittributary/workspace/resolve-publish-context@v1
  with:
    source_repo: ${{ gt.workspace.active_repo }}
    target_repo: ${{ gt.workspace.active_repo }}
    target_branch: ${{ gt.workspace.active_branch }}
```

引用输出:

```yaml
repo: ${{ steps.context.outputs.source_repo }}
branch: ${{ steps.context.outputs.target_branch }}
output: ${{ steps.context.outputs.output_dir }}
```

边界:

- 不检查路径是否存在。
- 不创建目录。
- 不 clone 远程仓库。
- 不读取默认远程 URL。

---

### 3.2 构建笔记 HTML

```text
gittributary/notes/build-html@v1
```

特性:

- 当前是占位节点。
- 会返回 `html_dir = output`。
- 适合先把 Flow 链路串起来,后续再替换为真实笔记构建能力。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `repo` | string | 笔记仓库本地路径 |
| `output` | string | HTML 输出目录 |

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `html_dir` | string | HTML 目录 |

片段:

```yaml
- id: build
  uses: gittributary/notes/build-html@v1
  with:
    repo: ${{ steps.context.outputs.source_repo }}
    output: ${{ steps.context.outputs.output_dir }}
```

下游引用:

```yaml
path: ${{ steps.build.outputs.html_dir }}
```

边界:

- 不真正构建 Markdown/笔记。
- 不校验 `repo`。
- 不保证 `html_dir` 存在。
- 需要配合 `files/assert-exists` 做产物检查。

---

### 3.3 校验文件存在

```text
gittributary/files/assert-exists@v1
```

特性:

- 用于在提交、同步或推送前做保护。
- 能检查文件或目录是否存在。
- 可以要求目录非空。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `path` | string | 要检查的路径 |
| `non_empty` | boolean | 是否要求非空 |

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `path` | string | 已校验路径 |

片段:

```yaml
- id: assert_build
  uses: gittributary/files/assert-exists@v1
  with:
    path: ${{ steps.build.outputs.html_dir }}
    non_empty: "true"
```

检查固定路径:

```yaml
- id: assert_readme
  uses: gittributary/files/assert-exists@v1
  with:
    path: /Users/mi/rust_code/gt-test/README.md
    non_empty: "true"
```

边界:

- 不创建路径。
- 不修复空目录。
- 不检查文件内容格式。
- `non_empty` 当前按字符串 `"true"` 判断。

---

### 3.4 同步目录

```text
gittributary/files/sync-dir@v1
```

特性:

- 将 `from` 目录递归复制到 `to` 目录。
- 目标目录不存在时会创建。
- 返回复制的文件数量。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `from` | string | 源目录 |
| `to` | string | 目标目录 |

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `changed_count` | number | 复制文件数量 |

片段:

```yaml
- id: sync
  uses: gittributary/files/sync-dir@v1
  with:
    from: ${{ steps.build.outputs.html_dir }}
    to: ${{ steps.context.outputs.target_repo }}/public
```

同步固定目录:

```yaml
- id: sync_public
  uses: gittributary/files/sync-dir@v1
  with:
    from: /Users/mi/rust_code/gt-test/dist
    to: /Users/mi/rust_code/gt-test/public
```

下游引用:

```yaml
message: "sync files: ${{ steps.sync.outputs.changed_count }}"
```

边界:

- 不删除目标目录里多余的旧文件。
- 不做冲突检测。
- 不做增量比较。
- 目标同名文件会被覆盖。

---

### 3.5 提交全部变更

```text
gittributary/git/commit-all@v1
```

特性:

- 打开指定本地 Git 仓库。
- 执行 stage all。
- 使用给定 message 创建提交。
- 无变更时返回 `skipped` 和 `nothing_to_commit`。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `repo` | string | 本地仓库路径 |
| `message` | string | 提交信息 |

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `commit` | string/null | 新提交 ID。无变更时为 `null` |
| `branch` | string | 当前分支 |

提交当前打开仓库:

```yaml
- id: commit
  uses: gittributary/git/commit-all@v1
  with:
    repo: ${{ gt.workspace.active_repo }}
    message: "chore: auto sync ${{ gt.now }}"
```

提交指定仓库:

```yaml
- id: commit
  uses: gittributary/git/commit-all@v1
  with:
    repo: /Users/mi/rust_code/gt-test
    message: "chore: update gt-test ${{ gt.now }}"
```

下游引用:

```yaml
branch: ${{ steps.commit.outputs.branch }}
message: "commit: ${{ steps.commit.outputs.commit }}"
```

无变更时输出:

```json
{"branch":"main","commit":null}
```

边界:

- `repo` 必须是本地路径,不是远程 URL。
- 会暂存全部变更,不能选择文件。
- 不支持 amend。
- 不支持提交前条件判断。
- 不自动 push。
- 当前 Runner 对 `skipped` 不做自动短路传播,后续 step 仍可能执行。

---

### 3.6 推送分支

```text
gittributary/git/push@v1
```

特性:

- 打开指定本地 Git 仓库。
- 将指定分支推送到指定 remote。
- 使用应用已有 Git 认证解析逻辑。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `repo` | string | 本地仓库路径 |
| `remote` | string | remote 名称,例如 `origin` |
| `branch` | string | 分支名 |

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `remote` | string | remote 名称 |
| `branch` | string | 分支名 |

推送 commit 节点所在分支:

```yaml
- id: push
  uses: gittributary/git/push@v1
  with:
    repo: /Users/mi/rust_code/gt-test
    remote: origin
    branch: ${{ steps.commit.outputs.branch }}
```

推送当前打开仓库当前分支:

```yaml
- id: push
  uses: gittributary/git/push@v1
  with:
    repo: ${{ gt.workspace.active_repo }}
    remote: origin
    branch: ${{ gt.workspace.active_branch }}
```

边界:

- `remote` 是远程名,不是远程 URL。
- 不自动创建 remote。
- 不自动设置 upstream。
- 不自动 pull 或 rebase。
- 远端拒绝时节点失败。

---

### 3.7 同步数据中心

```text
gittributary/store/sync-now@v1
```

特性:

- 触发 GitTributary 数据中心同步。
- 无输入。
- 输出同步结果 message。

输入: 无。

输出:

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `message` | string | 同步结果 |

片段:

```yaml
- id: sync_store
  uses: gittributary/store/sync-now@v1
```

通知同步结果:

```yaml
- id: notify_store
  uses: gittributary/ui/notify@v1
  with:
    title: 数据中心同步
    message: ${{ steps.sync_store.outputs.message }}
```

边界:

- 不同步任意业务仓库。
- 不接收 repo/remote 输入。
- 依赖数据中心绑定配置、token 和远程连通性。

---

### 3.8 发送通知

```text
gittributary/ui/notify@v1
```

特性:

- 用于在运行报告中留下可读 message。
- 当前不是系统通知。
- 不产生 outputs。

输入:

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 标题 |
| `message` | string | 内容 |

输出: 无。

片段:

```yaml
- id: notify
  uses: gittributary/ui/notify@v1
  with:
    title: Flow 完成
    message: "commit: ${{ steps.commit.outputs.commit }}"
```

带同步数量:

```yaml
- id: notify_sync
  uses: gittributary/ui/notify@v1
  with:
    title: 同步完成
    message: "changed files: ${{ steps.sync.outputs.changed_count }}"
```

边界:

- 不弹系统通知。
- 不持久化通知中心消息。
- 不支持按钮或交互动作。
- 输出为空,后续节点不能引用 `steps.notify.outputs.*`。

---

## 四、组合片段

### 4.1 提交并推送 gt-test

```yaml
jobs:
  commit_and_push:
    runs-on: gittributary-local
    steps:
      - id: commit
        uses: gittributary/git/commit-all@v1
        with:
          repo: /Users/mi/rust_code/gt-test
          message: "chore: auto sync ${{ gt.now }}"

      - id: push
        uses: gittributary/git/push@v1
        with:
          repo: /Users/mi/rust_code/gt-test
          remote: origin
          branch: ${{ steps.commit.outputs.branch }}
```

### 4.2 校验产物后提交

```yaml
jobs:
  validate_and_commit:
    runs-on: gittributary-local
    steps:
      - id: assert_dist
        uses: gittributary/files/assert-exists@v1
        with:
          path: /Users/mi/rust_code/gt-test/dist
          non_empty: "true"

      - id: commit
        uses: gittributary/git/commit-all@v1
        with:
          repo: /Users/mi/rust_code/gt-test
          message: "build: update dist ${{ gt.now }}"
```

### 4.3 构建占位链路

```yaml
jobs:
  publish:
    runs-on: gittributary-local
    steps:
      - id: context
        uses: gittributary/workspace/resolve-publish-context@v1
        with:
          source_repo: ${{ gt.workspace.active_repo }}
          target_repo: ${{ gt.workspace.active_repo }}
          target_branch: ${{ gt.workspace.active_branch }}

      - id: build
        uses: gittributary/notes/build-html@v1
        with:
          repo: ${{ steps.context.outputs.source_repo }}
          output: ${{ steps.context.outputs.output_dir }}

      - id: assert_build
        uses: gittributary/files/assert-exists@v1
        with:
          path: ${{ steps.build.outputs.html_dir }}
          non_empty: "true"
```

### 4.4 数据中心同步后记录结果

```yaml
jobs:
  store_sync:
    runs-on: gittributary-local
    steps:
      - id: sync_store
        uses: gittributary/store/sync-now@v1

      - id: notify
        uses: gittributary/ui/notify@v1
        with:
          title: 数据中心同步
          message: ${{ steps.sync_store.outputs.message }}
```

---

## 五、当前不支持的节点类型

这些写法现在还不能执行:

```yaml
- uses: actions/checkout@v4
- uses: gittributary/git/pull@v1
- uses: gittributary/git/fetch@v1
- uses: gittributary/shell/run@v1
- run: npm test
```

原因:

- `gt-flow` 当前只执行已登记的本地 action。
- 没有任意 shell runner。
- Git pull/fetch 虽然 Git 模块有命令,但尚未登记为 Flow 节点。
- GitHub Actions 官方 action 不会被解析成可执行本地节点。

