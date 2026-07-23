# Changelog

All notable changes to NoteAura are documented in this file.

This project follows a lightweight form of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning while the public API and release process mature.

## [0.1.0] - 2026-07-05

### Added

- First public release of NoteAura, a desktop companion for Git-backed Markdown note repositories.
- Git workspace support: open repositories, inspect working tree changes, view file diffs, create commits, browse history, manage branches, and work with remotes.
- Publishing support: configure publishing tasks, scan Markdown document scopes, build static HTML output, and push generated pages through a target repository workflow.
- Flow support: create, save, enable, disable, delete, and manually run YAML-based local automation flows.
- Data center support: browse local namespaces, inspect and manage key-value records, switch profile/environment context, and configure optional remote sync.
- Credential and remote configuration views for Git and data-center workflows.

### Notes

- The first release is focused on macOS desktop usage.
- Installer generation, signing, notarization, checksum generation, and release upload are expected to be handled by the release flow.
- Automatic application update packages are not part of the first release assets unless the release flow explicitly adds Tauri updater metadata and signatures.

### Known Limitations

- The macOS package may be architecture-specific depending on the release flow output, for example Apple Silicon only.
- Flow currently supports manual local execution; scheduled and background runners are future work.
- Data-center remote sync is available, but users should treat credential and configuration repositories carefully and avoid committing private tokens.
