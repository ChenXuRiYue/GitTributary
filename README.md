# GitTributary

GitTributary is a Tauri, React, and TypeScript desktop app for Git workflows,
local configuration storage, and repository-oriented automation.

## Development

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Commit Message Standard

Commit subjects must be written in English and follow a short Conventional
Commits shape:

```text
type(scope): short summary
```

Use the commit body as the description. The description must be bilingual, with
English first and Chinese second. Keep the subject concise and move detailed
context, affected modules, implementation notes, and follow-up information into
the body.

Example:

```text
fix(git): improve history preview

Keep the history list scrollable and show long commit details in a floating
preview card.

保持提交历史列表可滚动，并通过浮动预览卡展示较长的提交详情。
```
