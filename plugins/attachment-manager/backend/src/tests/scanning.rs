use std::fs;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

use crate::model::{AttachmentKind, LinkKind, ReferenceRole, MAX_NOTE_BYTES};
use crate::references::{
    canonical_remote_key, classify_remote_link, extract_references, remote_domain, remote_url,
    resolve_reference, ExtractedReference,
};
use crate::scan::{
    read_preview, read_preview_chunk, scan_repository, MAX_INLINE_AUDIO_PREVIEW_BYTES,
    PREVIEW_CHUNK_BYTES,
};

#[test]
fn scans_attachments_and_resolves_markdown_references() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("notes")).unwrap();
    fs::create_dir_all(directory.path().join("assets")).unwrap();
    fs::write(directory.path().join("assets/photo.png"), b"png").unwrap();
    fs::write(directory.path().join("assets/voice.mp3"), b"mp3").unwrap();
    fs::write(
        directory.path().join("notes/demo.md"),
        "![photo](../assets/photo.png)\n![[voice.mp3]]\n",
    )
    .unwrap();
    let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
    assert_eq!(report.notes_scanned, 1);
    assert_eq!(report.attachments.len(), 2);
    assert!(report
        .attachments
        .iter()
        .all(|item| item.references.len() == 1));
}

#[test]
fn scans_extended_image_formats_and_ignores_removed_types() {
    let directory = tempfile::tempdir().unwrap();
    for name in [
        "photo.HEIC",
        "scan.tiff",
        "icon.ico",
        "motion.apng",
        "next.jxl",
    ] {
        fs::write(directory.path().join(name), b"image").unwrap();
    }
    fs::write(directory.path().join("movie.mp4"), b"video").unwrap();
    fs::write(directory.path().join("document.pdf"), b"pdf").unwrap();
    let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
    assert_eq!(report.attachments.len(), 5);
    assert!(report
        .attachments
        .iter()
        .all(|item| item.kind == AttachmentKind::Image));
}

#[test]
fn resolves_angle_bracket_reference_with_spaces() {
    let references = extract_references("![photo](<assets/my photo.png>)").unwrap();
    assert_eq!(
        references,
        vec![ExtractedReference {
            target: "assets/my photo.png".to_string(),
            line: 1,
            role: ReferenceRole::Embed,
        }]
    );
}

#[test]
fn preserves_reference_roles_across_supported_syntaxes() {
    let references = extract_references(concat!(
        "![markdown embed](https://example.com/image.png)\n",
        "[markdown navigation](https://example.com/docs)\n",
        "![[https://example.com/audio.mp3]]\n",
        "[[https://example.com/home]]\n",
        "<img src=\"https://example.com/photo.webp\">\n",
        "<a href='https://example.com/api'>API</a>\n",
    ))
    .unwrap();
    assert_eq!(references.len(), 6);
    assert_eq!(references[0].role, ReferenceRole::Embed);
    assert_eq!(references[1].role, ReferenceRole::Navigation);
    assert_eq!(references[2].role, ReferenceRole::Embed);
    assert_eq!(references[3].role, ReferenceRole::Navigation);
    assert_eq!(references[4].role, ReferenceRole::Embed);
    assert_eq!(references[5].role, ReferenceRole::Navigation);
}

#[test]
fn rejects_preview_path_outside_repository() {
    let directory = tempfile::tempdir().unwrap();
    assert_eq!(
        read_preview(directory.path().to_str().unwrap(), "../secret.png").unwrap_err(),
        "invalid_attachment_path"
    );
}

#[test]
fn previews_images_larger_than_the_legacy_limit() {
    let directory = tempfile::tempdir().unwrap();
    let image = fs::File::create(directory.path().join("large.png")).unwrap();
    image.set_len(MAX_INLINE_AUDIO_PREVIEW_BYTES + 1).unwrap();
    let preview = read_preview(directory.path().to_str().unwrap(), "large.png").unwrap();
    assert_eq!(preview.mime_type, "image/png");
    assert_eq!(preview.size, MAX_INLINE_AUDIO_PREVIEW_BYTES + 1);
    assert_eq!(preview.chunk_size, PREVIEW_CHUNK_BYTES);
}

#[test]
fn streams_large_image_previews_in_frames_below_the_host_limit() {
    const IMAGE_BYTES: usize = 1_480_225;
    const HOST_FRAME_LIMIT: usize = 1024 * 1024;
    let directory = tempfile::tempdir().unwrap();
    let expected = vec![0x5a; IMAGE_BYTES];
    fs::write(directory.path().join("large.png"), &expected).unwrap();
    let preview = read_preview(directory.path().to_str().unwrap(), "large.png").unwrap();
    let mut encoded = String::new();
    let mut offset = 0;
    loop {
        let chunk = read_preview_chunk(
            directory.path().to_str().unwrap(),
            "large.png",
            offset,
            preview.size,
        )
        .unwrap();
        assert!(serde_json::to_vec(&chunk).unwrap().len() < HOST_FRAME_LIMIT);
        assert_eq!(chunk.offset, offset);
        encoded.push_str(&chunk.data);
        offset = chunk.next_offset;
        if chunk.done {
            break;
        }
    }
    assert_eq!(offset, IMAGE_BYTES as u64);
    assert_eq!(BASE64.decode(encoded).unwrap(), expected);
}

#[test]
fn retains_the_inline_limit_for_large_audio() {
    let directory = tempfile::tempdir().unwrap();
    let audio = fs::File::create(directory.path().join("large.mp3")).unwrap();
    audio.set_len(MAX_INLINE_AUDIO_PREVIEW_BYTES + 1).unwrap();
    assert_eq!(
        read_preview(directory.path().to_str().unwrap(), "large.mp3").unwrap_err(),
        "preview_file_too_large"
    );
}

#[test]
fn ignores_remote_and_data_references() {
    assert_eq!(
        resolve_reference("note.md", "https://example.com/a.png"),
        None
    );
    assert_eq!(
        resolve_reference("note.md", "data:image/png;base64,abc"),
        None
    );
}

#[test]
fn aggregates_remote_links_without_binding_them_to_local_attachments() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("assets")).unwrap();
    fs::write(directory.path().join("assets/photo.png"), b"png").unwrap();
    fs::write(
        directory.path().join("first.md"),
        concat!(
            "![local](assets/photo.png)\n",
            "![remote](https://example.com/media/photo.png?width=800#preview)\n",
            "![ignored](data:image/png;base64,abc)\n",
        ),
    )
    .unwrap();
    fs::write(
        directory.path().join("second.md"),
        "<img src=\"https://example.com/media/photo.png?width=800#other\">\n",
    )
    .unwrap();
    let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
    assert_eq!(report.attachments.len(), 2);
    assert_eq!(report.total_size, 3);
    let local = report
        .attachments
        .iter()
        .find(|item| item.kind == AttachmentKind::Image)
        .unwrap();
    assert_eq!(local.references.len(), 1);
    let remote = report
        .attachments
        .iter()
        .find(|item| item.kind == AttachmentKind::Link)
        .unwrap();
    assert_eq!(remote.link_kind, Some(LinkKind::Image));
    assert_eq!(remote.domain.as_deref(), Some("example.com"));
    assert_eq!(remote.references.len(), 2);
}

#[test]
fn classifies_remote_links_without_network_requests() {
    let cases = [
        ("https://cdn.example.com/photo.JPEG?v=2", LinkKind::Image),
        ("https://cdn.example.com/voice.opus", LinkKind::Audio),
        ("https://cdn.example.com/movie.webm", LinkKind::Video),
        ("https://example.com/api", LinkKind::Website),
        ("https://example.com/index.html", LinkKind::Website),
        ("https://example.com/archive.tar.gz", LinkKind::Download),
        ("https://example.com/file.custom", LinkKind::Unknown),
    ];
    for (url, expected) in cases {
        assert_eq!(classify_remote_link(url), expected, "{url}");
    }
}

#[test]
fn classifies_vscode_api_as_website_and_extracts_domain() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("links.md"),
        "[VS Code API](https://code.visualstudio.com/api)\n",
    )
    .unwrap();
    let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
    let link = report.attachments.first().unwrap();
    assert_eq!(link.kind, AttachmentKind::Link);
    assert_eq!(link.link_kind, Some(LinkKind::Website));
    assert_eq!(link.domain.as_deref(), Some("code.visualstudio.com"));
    assert_eq!(link.references[0].role, ReferenceRole::Navigation);
}

#[test]
fn recognizes_only_http_links_and_preserves_query() {
    assert_eq!(
        remote_url("<HTTPS://example.com/file.svg?v=2#icon>"),
        Some("https://example.com/file.svg?v=2#icon".to_string())
    );
    assert_eq!(remote_url("data:image/png;base64,abc"), None);
    assert_eq!(remote_url("ftp://example.com/file.png"), None);
    assert_eq!(remote_url("https:///missing-host.png"), None);
    assert_eq!(remote_url("https://user@example.com/private.png"), None);
}

#[test]
fn canonical_remote_key_ignores_only_fragment() {
    assert_eq!(
        canonical_remote_key("https://example.com/image.png?q=1#first"),
        "https://example.com/image.png?q=1"
    );
    assert_ne!(
        canonical_remote_key("https://example.com/image.png?q=1#first"),
        canonical_remote_key("https://example.com/image.png?q=2#first")
    );
    assert_eq!(
        remote_domain("http://[::1]:8080/path").as_deref(),
        Some("[::1]")
    );
}

#[test]
fn ignores_references_inside_fenced_code_blocks() {
    let references = extract_references(concat!(
        "[outside](https://example.com/outside)\n",
        "```md\n",
        "![example](https://example.com/inside.png)\n",
        "```\n",
        "~~~html\n",
        "<img src=\"https://example.com/inside.jpg\">\n",
        "~~~\n",
    ))
    .unwrap();
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].target, "https://example.com/outside");
    assert_eq!(references[0].line, 1);
    assert_eq!(references[0].role, ReferenceRole::Navigation);
}

#[test]
fn counts_only_markdown_files_that_were_parsed() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("oversized.md"),
        vec![b'x'; MAX_NOTE_BYTES as usize + 1],
    )
    .unwrap();
    let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
    assert_eq!(report.notes_scanned, 0);
    assert_eq!(report.skipped_entries, 1);
}
