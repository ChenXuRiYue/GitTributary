# doc/

本目录存放项目文档。

## 项目内文档

本目录直接存放项目开发过程中沉淀的对话式开发文档,已从外部笔记中的
`GitTributary/vibe-coding` 迁移到当前仓库,可随项目一起版本化维护。

### 核心设计文档

| 文档 | 说明 |
| --- | --- |
| `项目模块现状.md` | 当前仓库模块、前端插件与 Rust crate 状态 |
| `Git基础能力设计.md` | `gt-git` 平台级 Git 能力层 |
| `数据中心设计.md` | `gt-store` JSONL、命名空间、Profile 与同步 |
| `数据中心远程同步设计.md` | 数据中心绑定 GitHub 配置数据库、事件同步与并发方案 |
| `数据流与响应链路规范.md` | 操作 -> store -> UI 的响应式链路 |
| `流体系设计规范.md` | `gt-flow` 的 GitHub Actions 子集 + CloudEvents 规范 |
| `流构造与执行技术实现.md` | `gt-flow` 构造草稿、静态诊断、Runner 与 Tauri 命令实现 |
| `工作流操作说明手册.md` | 当前工作流模块的创建、保存、运行和排障操作说明 |
| `流节点能力边界手册.md` | 当前内置 Flow 节点的输入输出、执行行为和能力边界 |
| `Flow节点使用速查与片段.md` | 当前全部 Flow 节点的用法、特性和 YAML 片段示例 |
| `配置目录规范.md` | `~/.git-tributary/` 目录、public/private 数据分层 |

## 外部笔记软链接

`doc/GitTributary` 是一个**本机软链接**,指向个人笔记仓库中对应的文档目录:

```bash
# 建立方式（按你的实际笔记路径替换）
ln -s "<你的笔记路径>/开源项目/GitTributary" doc/GitTributary
```

该软链接已被 `.gitignore` 忽略(因为是绝对路径、本机私有),
clone 项目后需手动创建,或跳过——不影响构建与运行。
