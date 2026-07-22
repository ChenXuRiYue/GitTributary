use std::io::Cursor;

use super::*;

#[test]
fn missing_override_falls_back_without_panicking() {
    let _ = resolve_host_executable();
}

#[test]
fn bounded_line_accepts_exact_limit_and_eof_without_newline() {
    let mut reader = BufReader::with_capacity(2, Cursor::new(b"abcd\nef"));

    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::Line(line) if line == b"abcd"
    ));
    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::Line(line) if line == b"ef"
    ));
    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::Eof
    ));
}

#[test]
fn bounded_line_discards_oversized_frame_and_recovers_at_next_line() {
    let mut reader = BufReader::with_capacity(3, Cursor::new(b"abcdef\nok\n"));

    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::TooLarge
    ));
    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::Line(line) if line == b"ok"
    ));
}

#[test]
fn bounded_line_never_returns_oversized_unterminated_data() {
    let mut reader = BufReader::with_capacity(2, Cursor::new(b"abcdef"));

    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::TooLarge
    ));
    assert!(matches!(
        read_bounded_line(&mut reader, 4).unwrap(),
        BoundedLine::Eof
    ));
}
