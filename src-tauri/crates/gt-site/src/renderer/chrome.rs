use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub(crate) enum LucideIcon {
    Archive,
    ChevronLeft,
    File,
    FileCode,
    FileImage,
    FileJson,
    FileText,
    FileType,
    Folder,
    FolderOpen,
    Moon,
    Music,
    Sheet,
    Sun,
    Video,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct FileIconMeta {
    pub(crate) class_suffix: &'static str,
    pub(crate) title: &'static str,
    pub(crate) icon: LucideIcon,
}

pub(crate) fn render_site_controls() -> String {
    format!(
        r#"<div class="site-controls">{} {}</div>"#,
        render_sidebar_toggle(),
        render_theme_toggle()
    )
}

fn render_sidebar_toggle() -> String {
    format!(
        r#"<button class="site-control-button sidebar-toggle" type="button" aria-controls="siteSidebar" aria-expanded="true" aria-label="收起侧边栏" title="收起侧边栏"><span aria-hidden="true">{}</span></button>"#,
        lucide_svg(LucideIcon::ChevronLeft)
    )
}

fn render_theme_toggle() -> String {
    format!(
        r#"<button class="site-control-button theme-toggle" type="button" aria-label="切换为暗色" title="切换为暗色"><span class="theme-icon theme-icon-light" aria-hidden="true">{}</span><span class="theme-icon theme-icon-dark" aria-hidden="true">{}</span></button>"#,
        lucide_svg(LucideIcon::Sun),
        lucide_svg(LucideIcon::Moon),
    )
}

pub(crate) fn render_theme_bootstrap() -> &'static str {
    r#"<script>
(function () {
  try {
    var stored = localStorage.getItem("gt-site-theme");
    var preferred = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : preferred;
  } catch (_) {
    document.documentElement.dataset.theme = "light";
  }
})();
</script>"#
}

pub(crate) fn nav_file_icon(path: &str) -> FileIconMeta {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "md" | "markdown" | "mdx" => FileIconMeta {
            class_suffix: "markdown",
            title: "Markdown 文件",
            icon: LucideIcon::FileText,
        },
        "json" | "jsonc" => FileIconMeta {
            class_suffix: "json",
            title: "JSON 文件",
            icon: LucideIcon::FileJson,
        },
        "js" | "jsx" | "ts" | "tsx" | "rs" | "go" | "py" | "java" | "kt" | "swift" | "c" | "cc"
        | "cpp" | "h" | "hpp" | "sh" | "zsh" | "fish" | "sql" | "xml" | "toml" | "yaml" | "yml"
        | "html" | "css" | "scss" | "vue" | "svelte" => FileIconMeta {
            class_suffix: "code",
            title: "代码文件",
            icon: LucideIcon::FileCode,
        },
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => FileIconMeta {
            class_suffix: "image",
            title: "图片文件",
            icon: LucideIcon::FileImage,
        },
        "pdf" => FileIconMeta {
            class_suffix: "pdf",
            title: "PDF 文件",
            icon: LucideIcon::FileType,
        },
        "csv" | "tsv" | "xls" | "xlsx" => FileIconMeta {
            class_suffix: "sheet",
            title: "表格文件",
            icon: LucideIcon::Sheet,
        },
        "zip" | "gz" | "tgz" | "tar" | "rar" | "7z" => FileIconMeta {
            class_suffix: "archive",
            title: "压缩文件",
            icon: LucideIcon::Archive,
        },
        "mp3" | "wav" | "m4a" | "flac" | "ogg" => FileIconMeta {
            class_suffix: "audio",
            title: "音频文件",
            icon: LucideIcon::Music,
        },
        "mp4" | "mov" | "webm" | "avi" | "mkv" => FileIconMeta {
            class_suffix: "video",
            title: "视频文件",
            icon: LucideIcon::Video,
        },
        "txt" | "log" => FileIconMeta {
            class_suffix: "text",
            title: "文本文件",
            icon: LucideIcon::FileText,
        },
        _ => FileIconMeta {
            class_suffix: "default",
            title: "文件",
            icon: LucideIcon::File,
        },
    }
}

pub(crate) fn lucide_svg(icon: LucideIcon) -> String {
    let paths = match icon {
        LucideIcon::Archive => {
            r#"<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>"#
        }
        LucideIcon::ChevronLeft => r#"<path d="m15 18-6-6 6-6"/>"#,
        LucideIcon::File => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>"#
        }
        LucideIcon::FileCode => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>"#
        }
        LucideIcon::FileImage => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="10" cy="13" r="2"/><path d="m20 17-1.1-1.1a2 2 0 0 0-2.8 0L14 18"/>"#
        }
        LucideIcon::FileJson => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>"#
        }
        LucideIcon::FileText => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>"#
        }
        LucideIcon::FileType => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13v-1h6v1"/><path d="M11 18h2"/><path d="M12 12v6"/>"#
        }
        LucideIcon::Folder => {
            r#"<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>"#
        }
        LucideIcon::FolderOpen => {
            r#"<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6A2 2 0 0 1 18.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>"#
        }
        LucideIcon::Moon => r#"<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>"#,
        LucideIcon::Music => {
            r#"<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>"#
        }
        LucideIcon::Sheet => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9v8"/>"#
        }
        LucideIcon::Sun => {
            r#"<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>"#
        }
        LucideIcon::Video => {
            r#"<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>"#
        }
    };
    format!(
        r#"<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">{paths}</svg>"#
    )
}
