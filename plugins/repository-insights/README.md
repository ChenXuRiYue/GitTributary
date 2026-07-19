# 仓库洞察插件

这是 GitTributary 当前项目内维护的第一个插件,用于验证:

- `manifest.json` 声明 React 页面、Rust 后台和所需权限。
- `frontend/` 是独立构建的 React 页面,只通过消息 bridge 调用宿主。
- `backend/` 构建为 Rust `cdylib`,只加载到 `gt-plugin-host` sidecar。

## 开发

在仓库根目录执行:

```bash
npm run plugin:build
npm run tauri -- dev
```

默认 Tauri Debug 命令会自动准备 sidecar，并构建全部插件。

插件未嵌入 GitTributary 时,前端会使用 mock 数据,因此也可以独立预览:

```bash
cd plugins/repository-insights/frontend
npm install
npm run dev
```

## Rust 后台 ABI

MVP sidecar 加载以下三个导出:

- `gittributary_plugin_abi_version`
- `gittributary_plugin_handle_request`
- `gittributary_plugin_free_string`

真实调用链:

```text
React plugin page
  -> postMessage
  -> React ExtensionFrame
  -> Tauri extension_call
  -> gt-plugin-host sidecar
  -> Rust plugin repository_summary
```

当前原生 ABI 只用于受信任的本地 MVP。等平台契约稳定后,再增加 WASI Component 运行时和生成式 SDK,摘要领域逻辑无需重写。
