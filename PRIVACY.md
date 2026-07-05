# 隐私说明

本文档说明 Git Tributary 在本机和用户配置的远端服务中如何处理数据。适用范围为 Git Tributary 0.1.x。

## 核心原则

- Git Tributary 是本地优先的桌面应用。
- 应用不会内置广告、统计分析或遥测上报。
- 应用不会主动把你的笔记内容发送给项目作者或项目作者控制的服务器。
- 只有当你主动配置 Git remote、GitHub Pages、数据中心远程同步等功能时，应用才会向对应远端执行 Git 或网络相关操作。

## 应用会读取什么

当你选择一个仓库或配置一项任务时，Git Tributary 可能读取：

- 你选择的 Git 仓库路径、分支、提交历史、状态、diff、remote 配置和文件列表。
- 你选择发布的 Markdown 文档及其相对路径。
- 与发布任务、Flow、Profile、环境和数据中心相关的本地配置。
- 为完成 Git 操作所需的用户名、邮箱、token、SSH 或系统 Git 凭据状态。

## 应用会写入什么

Git Tributary 会在本机保存必要配置和状态。默认应用级数据目录为：

```text
~/.git-tributary/
```

应用可能保存的数据包括：

- 应用 Profile、环境、命名空间和 KV 记录。
- 发布任务、Flow 草稿和执行状态。
- 数据中心远程同步配置。
- 凭据引用、凭据状态，以及用于特定远程操作的私有 token 记录。

发布构建时，应用也可能在你选择的笔记仓库中写入构建输出或工作目录，例如：

```text
<note-repo>/.gittributary/
```

## 凭据与 token

Git Tributary 会尽量将敏感字段作为私有记录处理，不应把 token 写入普通公开配置或发布输出。

你仍然应该遵守以下安全习惯：

- 不要把 `~/.git-tributary/` 整体提交到公开仓库。
- 不要截图或公开展示 token、私钥、私有 remote URL。
- 为 GitHub Pages 或数据中心同步创建最小权限 token。
- 如果 token 泄露，请立即在对应平台撤销并重新生成。

## 远程同步与 GitHub

当你主动使用 GitHub 备份、Pages 发布、远程仓库管理或数据中心同步时，Git Tributary 会根据你的配置向目标仓库执行 clone、fetch、pull、commit、push 等操作。

这些操作的数据处理方式由对应远端服务的隐私政策和仓库权限共同决定。请在发布前确认：

- 目标仓库是否公开。
- Pages 仓库是否会公开发布站点内容。
- 发布范围是否只包含你希望公开的 Markdown 文档。
- 配置同步仓库是否只包含可同步的 public 数据。

## 删除数据

卸载应用后，如需清理 Git Tributary 的本地配置与状态，可删除：

```bash
rm -rf ~/.git-tributary/
```

删除前请确认其中没有仍需保留的配置、Profile、同步状态或私有记录。

## 变更

如果未来版本加入自动更新、遥测、云服务、Agent 服务或第三方 API 集成，本隐私说明应在发布前同步更新，并明确说明新增数据流。
