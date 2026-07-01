pub(crate) enum EmphasisKind {
    Strong,
    Emphasis,
    Delete,
}

pub(crate) struct EmphasisSpan {
    pub(crate) kind: EmphasisKind,
    pub(crate) inner: String,
    pub(crate) next_index: usize,
}

pub(crate) fn scan_emphasis(chars: &[char], index: usize) -> Option<EmphasisSpan> {
    scan_wrapped_marker(chars, index, "**", EmphasisKind::Strong)
        .or_else(|| scan_wrapped_marker(chars, index, "__", EmphasisKind::Strong))
        .or_else(|| scan_wrapped_marker(chars, index, "~~", EmphasisKind::Delete))
        .or_else(|| scan_asterisk_emphasis(chars, index))
        .or_else(|| scan_underscore_emphasis(chars, index))
}

impl EmphasisKind {
    pub(crate) fn tags(&self) -> (&'static str, &'static str) {
        match self {
            Self::Strong => ("<strong>", "</strong>"),
            Self::Emphasis => ("<em>", "</em>"),
            Self::Delete => ("<del>", "</del>"),
        }
    }
}

fn scan_wrapped_marker(
    chars: &[char],
    index: usize,
    marker: &str,
    kind: EmphasisKind,
) -> Option<EmphasisSpan> {
    if !starts_with_marker(chars, index, marker) {
        return None;
    }
    let marker_len = marker.chars().count();
    let end = find_inline_marker(chars, index + marker_len, marker)?;
    if end <= index + marker_len {
        return None;
    }
    Some(EmphasisSpan {
        kind,
        inner: chars[index + marker_len..end].iter().collect(),
        next_index: end + marker_len,
    })
}

fn scan_asterisk_emphasis(chars: &[char], index: usize) -> Option<EmphasisSpan> {
    if chars.get(index).copied()? != '*' {
        return None;
    }
    let end = find_inline_char(chars, index + 1, '*')?;
    if end <= index + 1 || starts_with_marker(chars, end, "**") {
        return None;
    }
    Some(EmphasisSpan {
        kind: EmphasisKind::Emphasis,
        inner: chars[index + 1..end].iter().collect(),
        next_index: end + 1,
    })
}

fn scan_underscore_emphasis(chars: &[char], index: usize) -> Option<EmphasisSpan> {
    if chars.get(index).copied()? != '_' || is_word_char(chars.get(index.wrapping_sub(1)).copied())
    {
        return None;
    }
    let end = find_inline_char(chars, index + 1, '_')?;
    if end <= index + 1 || is_word_char(chars.get(end + 1).copied()) {
        return None;
    }
    Some(EmphasisSpan {
        kind: EmphasisKind::Emphasis,
        inner: chars[index + 1..end].iter().collect(),
        next_index: end + 1,
    })
}

fn starts_with_marker(chars: &[char], index: usize, marker: &str) -> bool {
    let marker_chars = marker.chars().collect::<Vec<_>>();
    index + marker_chars.len() <= chars.len()
        && marker_chars
            .iter()
            .enumerate()
            .all(|(offset, ch)| chars[index + offset] == *ch)
}

fn find_inline_marker(chars: &[char], start: usize, marker: &str) -> Option<usize> {
    let marker_len = marker.chars().count();
    if marker_len == 0 || start + marker_len > chars.len() {
        return None;
    }
    (start..=chars.len().saturating_sub(marker_len))
        .find(|index| starts_with_marker(chars, *index, marker))
}

fn find_inline_char(chars: &[char], start: usize, marker: char) -> Option<usize> {
    chars
        .iter()
        .enumerate()
        .skip(start)
        .find_map(|(index, ch)| (*ch == marker).then_some(index))
}

fn is_word_char(ch: Option<char>) -> bool {
    ch.is_some_and(|ch| ch.is_alphanumeric())
}
