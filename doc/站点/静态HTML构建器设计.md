# 静态 HTML 构建器设计

> 更新时间: 2026-06-29
> 范围: Git Tributary MVP 插件,从本地 Git 仓库捕捉 Markdown 文档目录并构建离线静态 HTML 站点。
> **实现状态**: 已实现为 `gt-site` crate + `src/plugins/site/` 前端插件。实际代码结构已超越本设计稿,详见 `doc/架构/项目模块现状.md` 站点模块章节。Pages 发布部分另见同目录 `Pages发布目标设计.md` 与 `Pages发布落地计划.md`。

## 一、目标

静态 HTML 构建器用于把一个本地 Git 仓库中的文档内容转换成可离线浏览的静态站点。

目标体验:

```text
选择仓库
  → 自动识别文档目录
  → 勾选要纳入的文件夹/文件
  → 配置输出目录与主题
  → 构建静态 HTML
  → 本地打开 index.html 浏览
```

这个功能不依赖云服务,也不要求用户安装 Node.js、Python 或额外命令行工具。MVP 作为当前静态注册表中的一级插件实现:前端插件负责配置、预览、触发和展示构建结果;构建过程由 Git Tributary 的 Tauri/Rust 端完成。

## 二、产品定位

静态 HTML 构建器不是博客发布系统,也不是外部插件市场能力。它是一个面向本地仓库的文档阅读与导出插件。

核心定位:

- 本地优先:所有输入、输出和索引都在用户机器上完成。
- 仓库感知:以 Git 仓库为入口,自动识别 README、docs、doc、notes 等文档区域。
- Typora-like 阅读:输出页面侧重稳定、舒适、低干扰的文档阅读体验。
- 可归档:生成结果是普通静态文件,可以复制、压缩、提交到仓库或放到任意本地目录。

非目标:

- 不做在线托管、账号、评论、协作。
- 不做插件化主题市场。
- 不依赖外部动态插件系统。
- 不直接依赖第三方云端 Markdown 渲染。
- 第一版不追求完整复刻 Typora 编辑能力,只做阅读站点。

## 三、用户场景

### 3.1 仓库文档浏览

用户打开一个代码仓库后,希望把 `README.md`、`doc/`、`docs/` 等文档汇总成一个可点击浏览的文档站点。

### 3.2 笔记仓库导出

用户将个人笔记放在 Git 仓库中,希望生成一个类似本地知识库的 HTML 目录,用于阅读、归档或离线备份。

### 3.3 项目交付包

用户需要将仓库中的设计文档、操作说明和变更记录打包成静态交付物,交给不使用 Git Tributary 的人浏览。

## 四、MVP 范围

第一版只做静态构建闭环。

MVP 插件形态:

```text
src/plugins/site/
  SitePanel.tsx
  types.ts
  components/
    SiteConfigPanel.tsx
    SiteCandidateTree.tsx
    SiteBuildLog.tsx
```

注册方式沿用当前 `src/plugins/registry.ts` 静态注册表:

```ts
{
  id: "site",
  name: "站点",
  description: "从本地仓库文档构建离线静态 HTML。",
  icon: FileCode2,
  panel: SitePanel,
}
```

这仍是“插件式模块”,但不是外部动态加载插件。它随应用一起编译发布,用于先验证产品闭环和构建能力。

### 4.1 输入

支持:

- 本地 Git 仓库路径。
- 仓库内 Markdown 文件: `.md`, `.markdown`。
- Markdown 中引用的本地图片和普通资源。
- 相对 Markdown 链接。

暂不支持:

- 远程仓库直接构建。
- Word、PDF、PPT 等二进制文档转换。
- 动态站点能力。
- 外部网络资源离线化。

### 4.2 输出

输出一个静态目录:

```text
site/
  index.html
  assets/
    app.css
    app.js
    search-index.json
    media/
  pages/
    README.html
    doc/
      Git/
        Git基础能力设计.html
```

输出页面应支持:

- 左侧文档树。
- 中间正文。
- 右侧当前文章大纲。
- 本地搜索索引。
- 亮色/暗色主题。
- 代码块高亮。
- 表格、引用、任务列表、图片。

### 4.3 构建配置

第一版配置项:

| 配置 | 说明 | 默认值 |
| --- | --- | --- |
| `repoPath` | 仓库根目录 | 当前打开仓库 |
| `include` | 纳入构建的路径列表 | 自动识别结果 |
| `exclude` | 排除路径列表 | 内置忽略规则 |
| `outputDir` | 输出目录 | `<repo>/.gittributary/site` |
| `siteTitle` | 站点标题 | 仓库名 |
| `theme` | 输出主题 | `typora-light` |
| `withSearch` | 是否生成搜索索引 | true |
| `copyAssets` | 是否复制本地资源 | true |

## 五、自动识别规则

构建器先扫描仓库,给候选路径打分,再让用户确认。

### 5.1 高优先级路径

直接进入候选:

```text
README.md
README.*.md
doc/
docs/
documentation/
wiki/
notes/
handbook/
architecture/
design/
```

### 5.2 中优先级路径

满足以下条件之一时进入候选:

- 目录内 Markdown 文件数量大于等于 3。
- 目录包含 `index.md`、`SUMMARY.md`、`sidebar.md`。
- 目录名包含 `guide`、`manual`、`spec`、`runbook`、`sop`。
- 最近 90 天内 Markdown 文件有更新。

### 5.3 默认忽略路径

默认不扫描:

```text
.git/
node_modules/
target/
dist/
build/
out/
.next/
.nuxt/
vendor/
coverage/
src-tauri/target/
```

### 5.4 文件排序

排序规则:

1. `README.md`、`index.md` 优先。
2. 含数字前缀的文件按数字排序,如 `01-概览.md`。
3. 目录排在文件前。
4. 其他按自然语言文件名排序。

## 六、插件前端交互设计

MVP 新增一级插件「站点」。该插件出现在左侧一级导航中,和 Git、流、数据、拓展等模块并列。

### 6.1 主视图结构

```text
┌────────────────────────────────────────────────────┐
│ Header: 静态站点 / 当前仓库 / 构建按钮              │
├───────────────┬────────────────────────────────────┤
│ 左侧配置       │ 右侧预览与构建结果                 │
│ - 仓库路径     │ - 捕捉到的文档目录                 │
│ - 输出目录     │ - 文件树预览                       │
│ - 主题         │ - 构建日志                         │
│ - 搜索开关     │ - 完成后打开 index.html / 输出目录 │
└───────────────┴────────────────────────────────────┘
```

### 6.2 主要状态

| 状态 | UI 表现 |
| --- | --- |
| 未选择仓库 | 显示选择仓库按钮 |
| 已选择仓库,未扫描 | 显示扫描按钮 |
| 扫描中 | 显示进度和当前目录 |
| 扫描完成 | 显示候选文件树和默认勾选 |
| 构建中 | 禁用配置,展示构建日志 |
| 构建成功 | 展示输出路径、打开按钮、统计信息 |
| 构建失败 | 展示错误、可重试、可复制日志 |

### 6.3 首版不做实时预览

第一版不在应用内完整渲染生成后的站点。构建成功后提供:

- 打开 `index.html`。
- 打开输出目录。
- 重新构建。

这样可以减少前端 WebView 中双重路由、资源路径和 CSP 的复杂度。

### 6.4 插件状态管理

`SitePanel` 内部维护以下状态:

| 状态 | 说明 |
| --- | --- |
| `repoPath` | 当前选择的仓库路径,默认读取当前 Git 模块打开的仓库 |
| `scanReport` | `site_scan` 返回的候选目录和文件统计 |
| `selectedPaths` | 用户勾选的 include 路径 |
| `buildConfig` | 输出目录、主题、搜索等构建配置 |
| `buildReport` | 构建完成后的页面数、资源数、warning |
| `phase` | `idle/scanning/ready/building/succeeded/failed` |

配置持久化仍走 `store_get/store_set`,命名空间为 `sites`。

## 七、后端架构

建议新增 Rust crate:

```text
src-tauri/crates/gt-site/
  src/
    lib.rs
    scan.rs
    config.rs
    markdown.rs
    assets.rs
    render.rs
    search.rs
    error.rs
```

职责划分:

| 模块 | 职责 |
| --- | --- |
| `scan` | 扫描仓库、识别候选文档目录、生成文件树 |
| `config` | 构建配置、默认值、配置校验 |
| `markdown` | Markdown 解析、frontmatter、标题提取 |
| `assets` | 图片和资源复制、路径重写、冲突处理 |
| `render` | HTML 页面生成、布局模板、导航数据注入 |
| `search` | 生成本地搜索索引 |
| `error` | 统一错误类型 |

Tauri command 层新增:

```rust
#[tauri::command]
fn site_scan(repo_path: String) -> Result<SiteScanReport, String>

#[tauri::command]
fn site_build(config: SiteBuildConfig) -> Result<SiteBuildReport, String>

#[tauri::command]
fn site_open_output(path: String) -> Result<(), String>
```

MVP 插件调用链:

```text
SitePanel.tsx
  → invoke("site_scan")
  → invoke("site_build")
  → invoke("site_open_output")
```

Rust command 仍由宿主应用统一注册。MVP 插件不能自己新增 Tauri command,因此相关 command 必须随本次功能一起写入 `src-tauri/src/lib.rs` 的 `generate_handler!`。

后续如果需要构建进度,再增加事件:

```text
site.build.started
site.build.progress
site.build.succeeded
site.build.failed
```

## 八、数据结构草案

### 8.1 扫描报告

```ts
interface SiteScanReport {
  repoPath: string;
  repoName: string;
  candidates: SitePathCandidate[];
  ignored: SiteIgnoredPath[];
  markdownCount: number;
  assetCount: number;
}

interface SitePathCandidate {
  path: string;
  kind: "file" | "dir";
  score: number;
  reason: string[];
  markdownCount: number;
  selectedByDefault: boolean;
}
```

### 8.2 构建配置

```ts
interface SiteBuildConfig {
  repoPath: string;
  outputDir: string;
  siteTitle: string;
  include: string[];
  exclude: string[];
  theme: "typora-light" | "typora-dark";
  withSearch: boolean;
  copyAssets: boolean;
}
```

### 8.3 构建报告

```ts
interface SiteBuildReport {
  outputDir: string;
  indexHtml: string;
  pageCount: number;
  assetCount: number;
  brokenLinks: BrokenLink[];
  warnings: SiteBuildWarning[];
  durationMs: number;
}
```

## 九、Markdown 渲染策略

Rust 侧建议使用成熟 Markdown 解析库,避免手写解析器。

候选库:

- `pulldown-cmark`: 轻量、稳定,适合 CommonMark。
- `comrak`: 功能更完整,支持 GFM 表格、任务列表、脚注等能力更方便。

建议首版使用 `comrak`,因为文档仓库常用 GitHub 风格 Markdown。

需要支持:

- 标题层级。
- 表格。
- 任务列表。
- 代码块。
- 引用块。
- 删除线。
- 自动链接。
- Frontmatter 读取但不直接渲染。

Frontmatter 可用于:

```yaml
---
title: Git 基础能力设计
order: 10
hidden: false
---
```

首版只识别 `title`、`order`、`hidden`。

## 十、链接与资源处理

### 10.1 Markdown 链接重写

相对 Markdown 链接:

```markdown
[Git 设计](./Git/Git基础能力设计.md)
```

构建后改为:

```html
<a href="./Git/Git基础能力设计.html">Git 设计</a>
```

锚点链接:

```markdown
[配置](#构建配置)
```

需要按标题 slug 规则映射到生成后的 heading id。

### 10.2 图片资源复制

Markdown:

```markdown
![架构图](./assets/architecture.png)
```

构建时复制到:

```text
assets/media/<hash>-architecture.png
```

然后重写为:

```html
<img src="../assets/media/<hash>-architecture.png" alt="架构图">
```

### 10.3 断链处理

断链不阻塞构建,但进入报告:

| 类型 | 处理 |
| --- | --- |
| 本地 Markdown 文件不存在 | warning |
| 本地图片不存在 | warning |
| 外部 URL | 保留原样 |
| 绝对本机路径 | 默认阻止并 warning |

## 十一、搜索索引

第一版生成轻量 JSON:

```json
[
  {
    "title": "Git 基础能力设计",
    "path": "pages/doc/Git/Git基础能力设计.html",
    "headings": ["目标", "总体架构", "命令设计"],
    "text": "去除 Markdown 标记后的正文摘要..."
  }
]
```

前端搜索在静态站点内用 `app.js` 完成,不依赖服务端。

首版可以做简单包含匹配。后续再评估:

- 分词。
- 拼音。
- Fuse.js 模糊搜索。
- 增量索引。

## 十二、输出页面设计

### 12.1 站点布局

```text
┌──────────────┬────────────────────────┬──────────────┐
│ 文档树        │ 正文                    │ 当前页大纲     │
│ 搜索框        │ Markdown 渲染内容        │ H2/H3 锚点     │
└──────────────┴────────────────────────┴──────────────┘
```

响应式规则:

- 桌面端显示三栏。
- 中等宽度隐藏右侧大纲。
- 移动端左侧目录变为抽屉。

### 12.2 Typora-like 样式原则

- 正文最大宽度 760 到 880px。
- 标题层级清晰,不过度装饰。
- 段落行高舒适。
- 表格支持横向滚动。
- 代码块背景与正文形成轻微区分。
- 图片最大宽度 100%,居中显示。
- 引用块低饱和边框。

## 十三、配置保存

构建配置建议保存到 Git Tributary 数据中心,不要第一版写入仓库。

命名空间:

```text
sites
```

key:

```text
build.<repo_hash>
```

value:

```json
{
  "version": 1,
  "repoPath": "/Users/mi/project/demo",
  "outputDir": "/Users/mi/project/demo/.gittributary/site",
  "include": ["README.md", "doc"],
  "exclude": ["node_modules", "target"],
  "theme": "typora-light",
  "withSearch": true,
  "updatedAt": 1782720000000
}
```

后续可以支持写入仓库:

```text
.gittributary/site-build.json
```

但这需要用户明确启用,避免自动污染业务仓库。

## 十四、安全边界

构建器处理的是用户本地文件,但仍需要安全约束。

必须限制:

- include/exclude 不能越过仓库根目录。
- 资源复制不能读取仓库外绝对路径。
- 输出目录不能默认覆盖仓库源码目录。
- 构建前如果输出目录非空,需要确认清理策略。
- HTML 中默认不执行 Markdown 内联脚本。
- 外部 URL 保留但不主动下载。

Markdown HTML 策略:

| 输入 | 默认处理 |
| --- | --- |
| 普通 Markdown | 渲染 |
| 内联 HTML | 允许安全子集或默认转义 |
| `<script>` | 转义或移除 |
| `javascript:` 链接 | 移除 href 并 warning |
| 本机绝对路径图片 | 不复制,warning |

## 十五、错误处理

错误分为阻塞错误和非阻塞 warning。

阻塞错误:

- 仓库路径不存在。
- 仓库路径不是目录。
- 输出目录不可写。
- include 路径全部无效。
- Markdown 读取失败且没有任何可构建页面。

非阻塞 warning:

- 单个 Markdown 文件解析失败。
- 图片缺失。
- 相对链接断链。
- 标题重复导致锚点改名。
- 输出文件名冲突后自动重命名。

## 十六、落地步骤

### M1: 构建闭环

- 新增 `gt-site` crate。
- 实现仓库扫描和候选目录识别。
- 实现 Markdown 到 HTML。
- 生成 `index.html`、页面文件、基础 CSS。
- 前端新增「站点」插件模块,能选择仓库、扫描、构建、打开结果。

### M2: 阅读体验

- 增加文档树。
- 增加当前页大纲。
- 增加图片复制和链接重写。
- 增加构建报告和 warning 列表。
- 增加亮色/暗色主题。

### M3: 搜索与质量检查

- 生成搜索索引。
- 静态站点内支持搜索。
- 增加断链检测。
- 增加 frontmatter `title/order/hidden`。
- 保存每个仓库的构建配置。

### M4: 自动化

- 接入 Flow 事件。
- 支持仓库打开后扫描。
- 支持提交后自动构建。
- 支持构建完成后触发后续 Flow。

## 十七、与现有模块关系

| 模块 | 关系 |
| --- | --- |
| Git | 复用当前打开仓库路径,后续可读取分支、提交信息作为站点元数据 |
| 数据中心 | 保存构建配置、最近输出目录、主题偏好 |
| Flow | 后续支持自动构建、构建完成事件 |
| 拓展 | 不进入外部插件市场;仅作为当前静态注册表插件存在 |
| 设置 | 可放全局默认输出目录、主题、安全策略 |

## 十八、MVP 插件落地方式

第一版作为一级插件注册:

```text
id: "site"
name: "站点"
description: "从本地仓库文档构建离线静态 HTML。"
category: "extension"
```

需要修改:

```text
src/plugins/types.ts              可不改,复用现有 PluginDescriptor
src/plugins/registry.ts           增加 site 插件注册
src/plugins/site/SitePanel.tsx    新增插件主面板
src-tauri/Cargo.toml              增加 gt-site workspace crate
src-tauri/src/lib.rs              注册 site_scan/site_build/site_open_output
src-tauri/crates/gt-site/         新增构建核心
```

MVP 不做:

- 插件安装包。
- 插件 manifest。
- 插件启停管理。
- 插件权限隔离。
- 插件市场安装流程。

当前目标是用“插件式模块”的工程结构交付静态站点功能,为后续真正插件系统保留接口经验。

## 十九、待决问题

1. 输出目录默认放仓库内 `.gittributary/site` 还是用户数据目录下。
2. Markdown 内联 HTML 默认转义还是允许安全子集。
3. 是否首版支持 Mermaid。
4. 是否首版支持单文件 HTML 导出。
5. 是否把构建配置写入仓库,便于团队共享。

## 二十、结论

静态 HTML 构建器适合作为 Git Tributary 的近期 MVP 插件。它能复用现有的静态插件注册表、本地仓库、数据中心和 Tauri 文件能力,同时不需要云服务和外部动态插件系统。

第一版应优先完成:

```text
选择仓库 → 扫描文档 → 勾选目录 → 构建 HTML → 本地打开
```

只要这条链路稳定,后续再逐步补搜索、断链检测、主题、Flow 自动化和更丰富的 Markdown 能力。
