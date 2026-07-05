# Git Tributary

简体中文 | [English](README.en.md)

![GitHub package.json version](https://img.shields.io/github/package-json/v/ChenXuRiYue/GitTributary?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/ChenXuRiYue/GitTributary?style=flat-square)
![GitHub last commit](https://img.shields.io/github/last-commit/ChenXuRiYue/GitTributary?style=flat-square)

Git Tributary 是一个面向 **Git + Markdown 笔记仓库** 的桌面增强工具。它不替代你喜欢的编辑器，而是站在仓库旁边，把 Git 留痕、GitHub 备份、Pages 发布、自动化 Flow 和本地数据中心组织成一套更现代的笔记工作台。

如果你喜欢用 Typora、Vim、VS Code 或普通文本编辑器写笔记，又希望笔记能自然沉淀出历史、发布站点、智能分析、长期记忆和自我激励，Git Tributary 就是为这类工作流准备的。

更多设计文档见 [doc/README.md](doc/README.md)。

发布与项目信息：
[安装说明](INSTALL.md) · [更新日志](CHANGELOG.md) · [隐私说明](PRIVACY.md) · [安全政策](SECURITY.md) · [MIT License](LICENSE)

## 目录

- [产品定位](#产品定位)
- [首版能力](#首版能力)
- [模块导览](#模块导览)
- [发展方向](#发展方向)
- [技术栈](#技术栈)
- [开发](#开发)

## 产品定位

很多笔记软件会把编辑器、数据库、同步、发布和 AI 都包在同一个系统里。Git Tributary 选择另一条路：让创作继续发生在你已经顺手的 Markdown 工作流里，把增强能力放到 Git 仓库这一层。

- **不侵入编辑器**：继续使用你喜欢的 Markdown 编辑器和目录结构。
- **把 Git log 变成笔记的生长记录**：提交、diff、分支和远端不只是工程工具，也可以成为创作轨迹、复盘素材和未来 Agent 的上下文。
- **把 GitHub 变成备份与发布底座**：远程仓库负责跨设备迁移，Pages 仓库负责把笔记发布成可浏览的网站。
- **把自动化留给 Flow**：用接近 GitHub Actions 子集的方式，把构建、同步、提交、推送等动作串成可复用流程。
- **把长期配置沉入数据中心**：凭据、环境、Profile、发布任务和同步状态集中管理，为后续记忆与个性化助手打基础。

## 首版能力

| 模块 | 对笔记用户的价值 | 当前已支持 |
| --- | --- | --- |
| Git | 让每次笔记修改都有清晰留痕，可选择性提交、查看历史和 diff。 | 仓库打开、状态、文件 diff、提交、历史、分支、远端、凭据。 |
| 发布 | 把 Markdown 笔记库构建成静态 HTML，并发布到 GitHub Pages 仓库。 | 发布任务、文档范围扫描、构建结果、一键构建/复制/commit/push。 |
| Flow | 把重复动作沉淀成自动化流程，为后续 Agent 和定时任务留出接口。 | YAML Flow、事件目录、节点目录、启停、保存、删除、手动运行。 |
| 数据 | 管理 Git Tributary 自身的配置、环境和跨设备同步数据。 | 命名空间浏览、KV 搜索/删除/compact、Profile/环境、远程同步配置。 |

## 模块导览

### Git：让提交历史成为笔记的时间线

Git 模块是整个应用的基础。它把笔记仓库的变更、提交、历史、远端和凭据放在一个更适合日常写作者的界面里。你可以在提交前看清楚自己今天改了什么，也可以回到历史提交里复盘某篇笔记如何生长。

#### 变更管理

查看工作区状态、按文件选择提交、阅读 diff，并把一次笔记整理沉淀成清晰 commit。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140659585.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140659585.png" alt="Git changes view" width="920"></a>

#### 历史管理

浏览提交列表、查看提交文件和单文件 diff，让笔记的演进过程可以被回看和分析。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140727110.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140727110.png" alt="Git history view" width="920"></a>

#### 多仓库与远端

管理 remote、clone/fetch/pull/push，把本地笔记自然同步到 GitHub 或 Pages 仓库。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140750069.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140750069.png" alt="Git remote repositories view" width="920"></a>

#### 安全凭据

保存项目级用户名、邮箱、Token 或 SSH 配置，并对敏感字段做掩码展示。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140807537.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140807537.png" alt="Git credential safety view" width="920"></a>

### 发布：把私人 Markdown 变成可分享的网站

发布模块面向“我已经有一个 Markdown 笔记仓库，现在想把其中一部分发布出去”的场景。它会帮助你配置发布任务、选择文档范围、构建静态站点，并把产物提交到 GitHub Pages 使用的目标仓库。

#### 任务域

保存一套可复用的发布任务，包括源仓库、发布仓库、分支、目录和 Pages URL。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142535410.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142535410.png" alt="Publishing task configuration" width="920"></a>

#### 范围域

扫描 README、doc、docs、notes 等 Markdown 区域，选择要发布的文档范围。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142619685.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142619685.png" alt="Publishing document scope" width="920"></a>

#### 执行域

手动构建或发布，查看页面数量、链接检查、提交推送结果和近期执行记录。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142812106.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142812106.png" alt="Publishing execution history" width="920"></a>

当前发布的构建结果如下（[Git Tributary 文档发布 Demo](https://chenxuriyue.github.io/gt-site-demo/pages/README.html)）

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705152741858.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705152741858.png" alt="Git Tributary published documentation demo" width="920"></a>

### Flow：把重复的笔记动作自动化

Flow 是 Git Tributary 的自动化模块。它采用 GitHub Actions 子集风格的 YAML，把事件、节点和执行结果连接起来。首版已经可以管理 Flow 文件夹和 YAML 草稿，浏览事件/节点目录，并手动运行流程。后续自动同步、定时任务、文件监听和 Agent 驱动流程都会从这里生长。

#### Flow 管理

在文件夹视图中创建、保存、启停、删除和运行 Flow，让常用流程可复用。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141851518.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141851518.png" alt="Flow management view" width="920"></a>

#### YAML 草稿

基于事件和节点生成或编辑 Flow YAML，适合把发布、同步、提交串成流程。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141831839.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141831839.png" alt="Flow YAML draft view" width="920"></a>

#### 事件目录

查看 Git、Store、Flow 等模块暴露的事件，为“发生什么时触发流程”提供入口。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142048762.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142048762.png" alt="Flow event catalog" width="920"></a>

#### 节点目录

查看可用 action 节点，例如构建笔记、同步目录、Git commit/push、数据中心同步。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142100564.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142100564.png" alt="Flow node catalog" width="920"></a>

### 数据：为长期笔记助手保存上下文

数据模块管理 Git Tributary 产生的配置与状态，包括本地 JSONL 数据、命名空间、Profile、环境、凭据状态和远程配置中心同步。它现在承担“配置中心”的角色，未来会继续承载记忆、个性化偏好、跨设备状态和 Agent 上下文。

#### 数据中心

浏览命名空间和 KV 条目，切换 Profile/环境，绑定远程配置仓库并执行同步。

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705143151883.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705143151883.png" alt="Data center view" width="920"></a>

## 发展方向

Git Tributary 的长期目标不是再造一个封闭笔记软件，而是把 Git 笔记仓库升级成可分析、可发布、可自动化、可陪伴的个人知识系统。

- **笔记生长可视化**：基于 commit 频率、文件修改轨迹和主题演进，展示知识库如何变化。
- **Agent 智能分析**：围绕 diff、commit、文档范围和历史上下文，提供总结、整理、发布前检查和提交信息建议。
- **复习与自我激励**：从 Git 活跃度和笔记变化中生成回顾提醒、阶段总结和持续写作反馈。
- **记忆与个性化**：利用数据中心保存偏好、环境、发布习惯和长期上下文，让助手越来越懂你的笔记库。
- **更完整的自动化**：接入定时器、文件监听和后台 Runner，让同步、构建和发布更少打断创作。

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI primitives
- Rust crates: `gt-git`, `gt-store`, `gt-flow`, `gt-site`

## 开发

```bash
npm install
npm run tauri dev
```

构建前端：

```bash
npm run build
```
