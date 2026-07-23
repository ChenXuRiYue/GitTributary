# 安装说明

本文档面向 NoteAura 的正式发布包。安装包本身由发布 Flow 生成，请以 GitHub Release 页面提供的文件为准。

## 系统要求

- macOS。
- Git 已安装，并且命令行可访问。
- 如需使用 GitHub 备份、GitHub Pages 发布或数据中心远程同步，需要可访问 GitHub，并准备相应仓库权限。

## 下载安装包

在 GitHub Release 页面下载与你设备匹配的安装包：

- Apple Silicon Mac：通常选择 `macos-arm64` 或 `aarch64` 标识的 DMG。
- Intel Mac：通常选择 `macos-x64` 或 `x86_64` 标识的 DMG。
- Universal 包：如果 Release 提供 universal DMG，可同时用于 Apple Silicon 和 Intel Mac。

如果 Release 同时提供 `SHA256SUMS.txt`，建议下载后校验安装包：

```bash
shasum -a 256 /path/to/NoteAura-0.1.0-macos-arm64.dmg
```

将输出与 Release 页面或 `SHA256SUMS.txt` 中的值对比。

## 安装

1. 打开下载的 DMG 文件。
2. 将 `NoteAura.app` 拖入 `Applications`。
3. 从 `Applications` 启动 NoteAura。

如果 macOS 提示无法验证开发者，请优先确认你下载的是官方 Release 文件，并检查 Release 是否声明已经签名和公证。首次发布阶段若尚未完成 Apple 公证，可能需要在系统设置中手动允许启动。

## 首次使用

NoteAura 不替代 Markdown 编辑器。建议先准备一个已有的 Git + Markdown 笔记仓库，然后在应用中打开该仓库。

常见首用流程：

1. 打开一个本地 Git 仓库。
2. 在 Git 模块查看变更、diff、历史和远端。
3. 在发布模块配置源仓库、目标 Pages 仓库和发布范围。
4. 在数据模块配置本机 Profile、环境和可选远程同步。
5. 如需复用流程，在 Flow 模块保存并手动运行自动化任务。

## 本地数据位置

NoteAura 会在本机保存应用配置、Profile、环境、发布任务、数据中心记录和部分凭据状态。

主要目录：

```text
~/.noteaura/
```

发布构建过程中，应用也可能在用户选择的笔记仓库内生成临时或输出目录，例如：

```text
<note-repo>/.noteaura/
```

请根据自己的备份策略决定是否将这些目录加入仓库的 `.gitignore`。

## 升级

1. 退出正在运行的 NoteAura。
2. 下载新版本 DMG。
3. 用新版本 `NoteAura.app` 替换 `Applications` 中的旧版本。
4. 重新启动应用。

建议升级前确认重要笔记仓库已经提交或备份。

## 卸载

1. 退出 NoteAura。
2. 删除 `Applications/NoteAura.app`。
3. 如需完全清理应用配置，可删除：

```bash
rm -rf ~/.noteaura/
```

删除 `~/.noteaura/` 会移除 NoteAura 的本地配置、Profile、同步状态和本地保存的私有记录。执行前请确认不再需要这些数据。
