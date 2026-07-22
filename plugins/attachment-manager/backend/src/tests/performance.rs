use std::fs;
use std::time::Instant;

use crate::scan::scan_repository;

#[test]
#[ignore = "performance fixture; run through npm run perf:attachments"]
fn classifies_large_link_inventory_within_budget() {
    const LINK_COUNT: usize = 5_000;
    const SAMPLE_COUNT: usize = 20;
    let directory = tempfile::tempdir().unwrap();
    let content = (0..LINK_COUNT)
        .map(|index| match index % 5 {
            0 => format!("![image](https://cdn.example.com/{index}.webp)\n"),
            1 => format!("[audio](https://cdn.example.com/{index}.mp3)\n"),
            2 => format!("[video](https://cdn.example.com/{index}.mp4)\n"),
            3 => format!("[site](https://docs.example.com/api/{index})\n"),
            _ => format!("[download](https://files.example.com/{index}.zip)\n"),
        })
        .collect::<String>();
    fs::write(directory.path().join("links.md"), content).unwrap();

    let _ = scan_repository(directory.path().to_str().unwrap()).unwrap();
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for _ in 0..SAMPLE_COUNT {
        let started = Instant::now();
        let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
        assert_eq!(report.attachments.len(), LINK_COUNT);
        samples.push(started.elapsed());
    }
    samples.sort_unstable();
    let p50 = samples[(SAMPLE_COUNT * 50).div_ceil(100) - 1];
    let p95 = samples[(SAMPLE_COUNT * 95).div_ceil(100) - 1];
    let budget_ms = std::env::var("GT_PERF_ATTACHMENT_LINK_SCAN_P95_MS")
        .ok()
        .map(|value| value.parse::<u64>().expect("budget must be an integer"))
        .unwrap_or(1_000);
    println!(
        "PERF fixture=attachment-links links={} samples={} p50_ms={:.2} p95_ms={:.2} budget_ms={}",
        LINK_COUNT,
        SAMPLE_COUNT,
        p50.as_secs_f64() * 1_000.0,
        p95.as_secs_f64() * 1_000.0,
        budget_ms,
    );
    assert!(
        p95.as_millis() <= budget_ms as u128,
        "attachment link scan p95 {:.2}ms exceeded {}ms budget",
        p95.as_secs_f64() * 1_000.0,
        budget_ms,
    );
}
