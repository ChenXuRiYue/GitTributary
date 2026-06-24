# Git Tributary

[English](#english)

![GitHub package.json version](https://img.shields.io/github/package-json/v/ChenXuRiYue/GitTributary?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/ChenXuRiYue/GitTributary?style=flat-square)
![GitHub last commit](https://img.shields.io/github/last-commit/ChenXuRiYue/GitTributary?style=flat-square)

Git Tributary 是一个部署在 GitHub 上的桌面端 Git 增强工具。它面向 Markdown
笔记仓库、个人知识库和轻量创作工作流，目标是在不侵入你原本编辑器的前提下，
把 Git 留痕、GitHub 备份、变更查看、提交管理、远程同步和可扩展插件能力组织成一个干净的本地工具。

产品介绍来源：[产品文档](doc/GitTributary/产品文档/GitTributary.md)

## 目录

- [产品定位](#产品定位)
- [功能模块](#功能模块)
- [技术栈](#技术栈)
- [开发](#开发)
- [提交规范](#提交规范)
- [English](#english)

## 产品定位

很多 Markdown 创作者更喜欢 Typora、Vim、普通文本编辑器等轻量工具，而不是把创作环境放进复杂的知识库软件中。Git Tributary 的定位是做一个伴生增强端：

- 创作仍然发生在你喜欢的编辑器里。
- Git log 成为天然的创作留痕和可分析数据库。
- GitHub 提供远程备份、跨设备迁移和后续 Pages 发布的基础能力。
- 本地桌面端只承载少数高频、高要求的辅助界面。
- 插件化能力为复习、AI、模板、自动化、发布等工作流留下扩展空间。

## 功能模块

- **Git 面板**：仓库状态、文件变更、勾选提交、提交历史、分支、远程同步和凭证安全设置。
- **数据中心**：统一配置管理、命名空间浏览、Profile 切换和本地/可同步数据分层。
- **复习工作流**：面向遗忘曲线的个人脑库和当周复习导出方向。
- **AI 辅助**：面向笔记总结、检查、洞察和提交信息生成的助手能力。
- **插件化架构**：一级插件和 Git 二级视图都通过注册表驱动，便于继续扩展。

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI primitives
- Rust crates: `gt-git`, `gt-store`

## 开发

```bash
npm install
npm run tauri dev
```

构建前端：

```bash
npm run build
```

推荐工具：

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 提交规范

提交标题必须使用英文，并保持简短的 Conventional Commits 形式：

```text
type(scope): short summary
```

提交 body 作为 description，必须双语：英文在先，中文在后。标题只保留短摘要，详细背景、影响范围、实现说明和后续信息放入 body。

示例：

```text
fix(git): improve history preview

Keep the history list scrollable and show long commit details in a floating
preview card.

保持提交历史列表可滚动，并通过浮动预览卡展示较长的提交详情。
```

## English

[中文](#git-tributary)

Git Tributary is a Git-enhanced desktop app hosted on GitHub. It is designed for
Markdown note repositories, personal knowledge bases, and lightweight writing
workflows. The product keeps your writing inside your preferred editor while
adding a focused local companion for Git history, GitHub backup, change review,
commit management, remote sync, and plugin-driven extensions.

Product context is summarized from the local product document:
[产品文档](doc/GitTributary/产品文档/GitTributary.md)

### Positioning

Git Tributary is built around a simple idea: writing tools should stay clean, and
Git can provide the trace, backup, migration, and publishing foundation around
them.

- Keep using Typora, Vim, text editors, or any Markdown workflow you like.
- Use Git log as a natural activity record and analyzable data source.
- Use GitHub for remote backup, cross-device migration, and future Pages-based publishing.
- Keep the desktop UI small, focused, and high quality.
- Leave room for plugins such as review, AI, templates, automation, and publishing.

### Modules

- **Git panel**: repository status, file changes, selective commits, commit history, branches, remote sync, and credential safety.
- **Data center**: unified configuration storage, namespace browsing, profile switching, and public/private data visibility.
- **Review workflow**: personal memory-bank and weekly review export direction.
- **AI assistant**: note summarization, review, insight, and commit message assistance.
- **Plugin architecture**: top-level plugins and Git subviews are registry-driven for future extension.

### Development

```bash
npm install
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

### Commit Message Standard

Commit subjects must be written in English and follow a short Conventional
Commits shape:

```text
type(scope): short summary
```

Use the commit body as the description. The description must be bilingual, with
English first and Chinese second. Keep the subject concise and move detailed
context, affected modules, implementation notes, and follow-up information into
the body.
