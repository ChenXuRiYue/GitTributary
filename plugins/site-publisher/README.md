# 发布插件

发布功能通过 manifest 向 GitTributary 贡献工作台页面。React 页面运行在独立 iframe，
Rust backend 由 sidecar 加载，内含 `crates/gt-site` 的扫描、构建和 Pages 发布逻辑。

```bash
npm run plugin:build
npm run tauri -- dev
```

安装插件后出现“发布”工作台项；卸载后该项消失。插件通过 Extension API 使用宿主
的 `gt-files`、Git、Store 和 shell 能力，不直接调用任意 Tauri command。
