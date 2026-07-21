# 发布插件

发布功能通过 manifest 向 GitTributary 贡献工作台页面。React 页面运行在独立 iframe，
Rust backend 由 sidecar 加载，内含插件私有的 `crates/gt-site`，负责扫描、构建、发布计划
和站点产物生成。它不链接 GitTributary 的任何核心 crate。

```bash
npm run plugin:build
npm run tauri -- dev
```

安装插件后出现“发布”工作台项；卸载后该项消失。插件通过版本化 Extension API 和
宿主进程通信，使用文件替换、Git 路径提交、Store 和 shell 等平台能力，不直接调用
任意 Tauri command，也不会接收 Git Token、SSH 私钥等明文凭据。

Pages 发布由插件前端编排：插件后端先生成发布计划，宿主准备 Git 分支，插件后端生成
staging 产物，宿主替换目标目录并完成 commit/push。Pages 规则留在插件，核心层只实现
通用文件和 Git capability。
