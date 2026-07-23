# NoteAura

[简体中文](README.md) | English

![GitHub package.json version](https://img.shields.io/github/package-json/v/ChenXuRiYue/NoteAura?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/ChenXuRiYue/NoteAura?style=flat-square)
![GitHub last commit](https://img.shields.io/github/last-commit/ChenXuRiYue/NoteAura?style=flat-square)

NoteAura is a desktop companion for **Git-backed Markdown note repositories**. It does not try to replace your editor. Instead, it works beside your repository and turns Git history, GitHub backup, Pages publishing, automation Flow, and the local data center into a modern workspace for long-lived notes.

If you enjoy writing with Typora, Vim, VS Code, or a plain text editor, but want your notes to grow into history, websites, intelligent analysis, long-term memory, and self-motivation, NoteAura is built for that workflow.

See [doc/README.md](doc/README.md) for the project documentation index.

Release and project information:
[Install](INSTALL.md) · [Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md) · [MIT License](LICENSE)

## Contents

- [Positioning](#positioning)
- [First Release Capabilities](#first-release-capabilities)
- [Module Tour](#module-tour)
- [Roadmap](#roadmap)
- [Tech Stack](#tech-stack)
- [Development](#development)

## Positioning

Many note apps put the editor, database, sync, publishing, and AI assistant inside one closed system. NoteAura takes a different path: keep writing in your existing Markdown workflow, and add intelligence around the Git repository layer.

- **Editor-friendly**: keep using your preferred Markdown editor and folder structure.
- **Git log as a growth record**: commits, diffs, branches, and remotes become writing traces, review material, and future Agent context.
- **GitHub as backup and publishing infrastructure**: remote repositories support device migration, while Pages repositories host public note sites.
- **Automation through Flow**: build, sync, commit, push, and other actions can be composed with a GitHub Actions-like subset.
- **Long-term configuration in the data center**: credentials, environments, profiles, publishing tasks, and sync state are managed centrally for future memory and personalization features.

## First Release Capabilities

| Module | Value for note users | Currently supported |
| --- | --- | --- |
| Git | Give every note change a clear trace, with selective commits, history browsing, and diffs. | Open repositories, status, file diff, commit, history, branches, remotes, credentials. |
| Publishing | Build a Markdown note repository into static HTML and publish it to a GitHub Pages repository. | Publishing tasks, document scope scanning, build results, one-click build/copy/commit/push. |
| Flow | Turn repeated note operations into reusable automation and prepare the path for Agents and scheduled jobs. | YAML Flow, event catalog, node catalog, enable/disable, save, delete, manual run. |
| Data | Manage NoteAura's own configuration, environments, and cross-device sync data. | Namespace browsing, KV search/delete/compact, profiles/environments, remote sync configuration. |

## Module Tour

### Git: Turn Commit History Into a Note Timeline

The Git module is the foundation of the app. It presents changes, commits, history, remotes, branches, and credentials in a workflow that is friendlier to daily writers. You can review what changed before committing, then return to old commits to understand how a note evolved.

#### Changes

Inspect workspace status, select files, read diffs, and turn a writing session into a clean commit.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140659585.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140659585.png" alt="Git changes view" width="920"></a>

#### History

Browse commits, inspect changed files, and read file-level diffs so note evolution stays reviewable.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140727110.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140727110.png" alt="Git history view" width="920"></a>

#### Repositories and Remotes

Manage remotes, clone/fetch/pull/push, and sync local notes with GitHub or a Pages repository.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140750069.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140750069.png" alt="Git remote repositories view" width="920"></a>

#### Credentials

Store project-level username, email, token, or SSH settings, with masked display for sensitive fields.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140807537.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705140807537.png" alt="Git credential safety view" width="920"></a>

### Publishing: Turn Private Markdown Into a Shareable Site

The Publishing module is for the moment when you already have a Markdown note repository and want to publish part of it. It helps configure reusable publishing tasks, choose document scopes, build a static site, and commit the output to the target repository used by GitHub Pages.

#### Task

Save a reusable publishing task with source repo, target repo, branch, directory, and Pages URL.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142535410.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142535410.png" alt="Publishing task configuration" width="920"></a>

#### Scope

Scan README, doc, docs, notes, and other Markdown areas, then choose what should be published.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142619685.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142619685.png" alt="Publishing document scope" width="920"></a>

#### Execution

Build or publish manually, then review page count, link checks, commit/push results, and recent runs.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142812106.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142812106.png" alt="Publishing execution history" width="920"></a>

### Flow: Automate Repeated Note Operations

Flow is NoteAura's automation module. It uses a GitHub Actions-like YAML subset to connect events, nodes, and execution results. The first release can manage Flow folders and YAML drafts, browse event/node catalogs, and run flows manually. Automatic sync, scheduled jobs, file watchers, and Agent-driven workflows can grow from this layer.

#### Flow Management

Create, save, enable, disable, delete, and run flows in a folder-based view.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141851518.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141851518.png" alt="Flow management view" width="920"></a>

#### YAML Draft

Generate or edit Flow YAML from events and nodes, useful for publishing, sync, commit, and push pipelines.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141831839.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705141831839.png" alt="Flow YAML draft view" width="920"></a>

#### Event Catalog

Inspect events exposed by Git, Store, Flow, and other modules to decide what should trigger automation.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142048762.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142048762.png" alt="Flow event catalog" width="920"></a>

#### Node Catalog

Inspect available action nodes, such as note building, directory sync, Git commit/push, and data-center sync.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142100564.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705142100564.png" alt="Flow node catalog" width="920"></a>

### Data: Save Context for a Long-Term Note Assistant

The Data module manages NoteAura's configuration and state: local JSONL data, namespaces, profiles, environments, credential state, and remote configuration-center sync. Today it works as the configuration center. Over time, it can carry memory, preferences, cross-device state, and Agent context.

#### Data Center

Browse namespaces and KV entries, switch profile/environment, bind a remote config repository, and sync.

<a href="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705143151883.png"><img src="https://raw.githubusercontent.com/ChenXuRiYue/image-cloud/main/global/image-20260705143151883.png" alt="Data center view" width="920"></a>

## Roadmap

NoteAura's long-term goal is not to rebuild another closed note app. It aims to upgrade Git-backed notes into a personal knowledge system that can be analyzed, published, automated, and companionable.

- **Note growth visualization**: use commit frequency, file evolution, and topic changes to show how a knowledge base grows.
- **Agent analysis**: use diffs, commits, document scopes, and history as context for summaries, organization, publishing checks, and commit-message suggestions.
- **Review and self-motivation**: turn Git activity and note changes into review reminders, progress summaries, and writing feedback.
- **Memory and personalization**: use the data center to store preferences, environments, publishing habits, and long-term context.
- **Deeper automation**: add schedulers, file watchers, and background runners so sync, build, and publishing interrupt writing less often.

## Tech Stack

- Tauri 2
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI primitives
- Internal Rust crates: `na-git`, `na-files`, `na-data`, `na-flow` (all non-publishable)
- Plugin boundary: plugins use platform capabilities only through the versioned Extension API/IPC

## Development

```bash
npm install
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```
