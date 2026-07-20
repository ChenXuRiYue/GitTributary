//! `gt-git` 可重复性能基准。
//!
//! 该测试默认 ignored，避免普通单元测试每次构造大型仓库。性能门禁应使用 release
//! 模式、单线程执行，避免多个磁盘密集型 fixture 相互干扰：
//!
//! ```text
//! cargo test -p gt-git --release --test performance_test -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 每项预算都可通过环境变量覆盖。查找顺序为：
//! `GT_PERF_<PROFILE>_<OP>_P95_MS`、`GT_PERF_<OP>_P95_MS`、内置预算。
//! 例如：`GT_PERF_LARGE_STATUS_P95_MS=2500`。CI 可以统一设置
//! `GT_PERF_BUDGET_MULTIPLIER=1.25` 吸收共享 runner 抖动，但不应关闭断言。

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use git2::{Repository, Signature};
use gt_git::GitRepo;
use tempfile::TempDir;

const SAMPLE_COUNT: usize = 20;
const FIRST_LOG_PAGE: usize = 50;
const RESULT_BUDGET_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy)]
struct FixtureProfile {
    name: &'static str,
    tracked_files: usize,
    modified_files: usize,
    untracked_files: usize,
    commits: usize,
    branches: usize,
    untracked_depth: usize,
    status_budget_ms: u64,
    log_budget_ms: u64,
    branches_budget_ms: u64,
}

const PROFILES: [FixtureProfile; 4] = [
    FixtureProfile {
        name: "small",
        tracked_files: 40,
        modified_files: 8,
        untracked_files: 12,
        commits: 20,
        branches: 4,
        untracked_depth: 2,
        status_budget_ms: 250,
        log_budget_ms: 100,
        branches_budget_ms: 100,
    },
    FixtureProfile {
        name: "medium",
        tracked_files: 800,
        modified_files: 120,
        untracked_files: 250,
        commits: 200,
        branches: 24,
        untracked_depth: 8,
        status_budget_ms: 750,
        log_budget_ms: 250,
        branches_budget_ms: 150,
    },
    FixtureProfile {
        name: "large",
        tracked_files: 4_000,
        modified_files: 600,
        untracked_files: 1_000,
        commits: 800,
        branches: 80,
        untracked_depth: 16,
        status_budget_ms: 2_000,
        log_budget_ms: 300,
        branches_budget_ms: 300,
    },
    // 深目录和大量未跟踪文件专门覆盖 recurse_untracked_dirs 的最坏路径。
    FixtureProfile {
        name: "hostile",
        tracked_files: 300,
        modified_files: 50,
        untracked_files: 3_000,
        commits: 100,
        branches: 12,
        untracked_depth: 48,
        status_budget_ms: 2_000,
        log_budget_ms: 300,
        branches_budget_ms: 300,
    },
];

struct Fixture {
    _temp_dir: TempDir,
    path: PathBuf,
    expected_statuses: usize,
    expected_commits: usize,
    expected_branches: usize,
}

struct Measurement {
    p50: Duration,
    p95: Duration,
    min: Duration,
    max: Duration,
    result_count: usize,
    estimated_bytes: usize,
}

/// 一个测试依次跑完四种 fixture，确保测试 runner 即使忽略 `--test-threads=1`
/// 也不会让这些磁盘密集型场景并发竞争。
#[test]
#[ignore = "large deterministic fixtures; run through the performance gate"]
fn git_read_operations_stay_within_p95_budgets() {
    assert!(cfg!(not(debug_assertions)), "性能门禁必须使用 --release");

    for profile in PROFILES {
        let fixture_started = Instant::now();
        let fixture = build_fixture(profile);
        println!(
            "PERF fixture={} build_ms={} tracked={} modified={} untracked={} commits={} branches={} depth={}",
            profile.name,
            fixture_started.elapsed().as_millis(),
            profile.tracked_files,
            profile.modified_files,
            profile.untracked_files,
            profile.commits,
            profile.branches,
            profile.untracked_depth,
        );

        let status = measure(&fixture.path, |repo| {
            let rows = repo.status().expect("status should succeed");
            let bytes = rows.iter().map(|row| row.path.as_os_str().len() + 2).sum();
            (rows.len(), bytes)
        });
        assert_eq!(status.result_count, fixture.expected_statuses);
        report_and_assert(profile, "status", status, profile.status_budget_ms);

        let log = measure(&fixture.path, |repo| {
            let rows = repo.log(FIRST_LOG_PAGE).expect("log should succeed");
            let bytes = rows
                .iter()
                .map(|row| {
                    row.id.len()
                        + row.short_id.len()
                        + row.message.len()
                        + row.author.len()
                        + row.email.len()
                        + 16
                })
                .sum();
            (rows.len(), bytes)
        });
        assert_eq!(
            log.result_count,
            fixture.expected_commits.min(FIRST_LOG_PAGE)
        );
        report_and_assert(profile, "log", log, profile.log_budget_ms);

        let branches = measure(&fixture.path, |repo| {
            let rows = repo.branches().expect("branches should succeed");
            let bytes = rows.iter().map(|row| row.name.len() + 2).sum();
            (rows.len(), bytes)
        });
        assert_eq!(branches.result_count, fixture.expected_branches);
        report_and_assert(profile, "branches", branches, profile.branches_budget_ms);
    }
}

fn measure(path: &Path, operation: impl Fn(&GitRepo) -> (usize, usize)) -> Measurement {
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    let mut result_count = 0;
    let mut estimated_bytes = 0;

    let warmup_repo = GitRepo::open(path).expect("fixture should remain openable");
    let _ = operation(&warmup_repo);
    drop(warmup_repo);

    // 每次重新打开句柄，覆盖真实命令中的 Repository::discover 成本；fixture 构造和预热不计时。
    for _ in 0..SAMPLE_COUNT {
        let started = Instant::now();
        let repo = GitRepo::open(path).expect("fixture should remain openable");
        let result = operation(&repo);
        samples.push(started.elapsed());
        result_count = result.0;
        estimated_bytes = result.1;
    }

    samples.sort_unstable();
    let p95_index = ((SAMPLE_COUNT * 95).div_ceil(100)).saturating_sub(1);
    let p50_index = ((SAMPLE_COUNT * 50).div_ceil(100)).saturating_sub(1);
    Measurement {
        min: samples[0],
        p50: samples[p50_index],
        p95: samples[p95_index],
        max: samples[SAMPLE_COUNT - 1],
        result_count,
        estimated_bytes,
    }
}

fn report_and_assert(
    profile: FixtureProfile,
    operation: &str,
    measurement: Measurement,
    default_budget_ms: u64,
) {
    let budget = budget(profile.name, operation, default_budget_ms);
    println!(
        "PERF fixture={} operation={} samples={} min_ms={:.2} p50_ms={:.2} p95_ms={:.2} max_ms={:.2} budget_ms={:.2} rows={} estimated_bytes={} result_budget_bytes={}",
        profile.name,
        operation,
        SAMPLE_COUNT,
        measurement.min.as_secs_f64() * 1_000.0,
        measurement.p50.as_secs_f64() * 1_000.0,
        measurement.p95.as_secs_f64() * 1_000.0,
        measurement.max.as_secs_f64() * 1_000.0,
        budget.as_secs_f64() * 1_000.0,
        measurement.result_count,
        measurement.estimated_bytes,
        RESULT_BUDGET_BYTES,
    );
    assert!(
        measurement.p95 <= budget,
        "{} {} p95 {:.2}ms exceeded {:.2}ms budget",
        profile.name,
        operation,
        measurement.p95.as_secs_f64() * 1_000.0,
        budget.as_secs_f64() * 1_000.0,
    );
    assert!(
        measurement.estimated_bytes <= RESULT_BUDGET_BYTES,
        "{} {} result {} bytes exceeded {} byte budget",
        profile.name,
        operation,
        measurement.estimated_bytes,
        RESULT_BUDGET_BYTES,
    );
}

fn budget(profile: &str, operation: &str, default_ms: u64) -> Duration {
    let profile_key = format!(
        "GT_PERF_{}_{}_P95_MS",
        profile.to_ascii_uppercase(),
        operation.to_ascii_uppercase()
    );
    let operation_key = format!("GT_PERF_{}_P95_MS", operation.to_ascii_uppercase());
    let configured_ms = env_number(&profile_key)
        .or_else(|| env_number(&operation_key))
        .unwrap_or(default_ms as f64);
    let multiplier = env_number("GT_PERF_BUDGET_MULTIPLIER").unwrap_or(1.0);

    assert!(configured_ms > 0.0, "{profile_key} must be positive");
    assert!(
        multiplier > 0.0,
        "GT_PERF_BUDGET_MULTIPLIER must be positive"
    );
    Duration::from_secs_f64(configured_ms * multiplier / 1_000.0)
}

fn env_number(key: &str) -> Option<f64> {
    env::var(key).ok().map(|value| {
        value
            .parse::<f64>()
            .unwrap_or_else(|_| panic!("{key} must be a number, got {value:?}"))
    })
}

fn build_fixture(profile: FixtureProfile) -> Fixture {
    let temp_dir = tempfile::Builder::new()
        .prefix(&format!("gt-git-perf-{}-", profile.name))
        .tempdir()
        .expect("create fixture directory");
    let path = temp_dir.path().to_path_buf();
    let repo = GitRepo::init(&path).expect("initialize fixture repository");

    for index in 0..profile.tracked_files {
        write_file(
            &path.join(format!("tracked/{:02}/{index:05}.txt", index % 32)),
            format!("fixture={} file={index}\n", profile.name).as_bytes(),
        );
    }
    repo.stage_all().expect("stage initial fixture files");
    repo.commit("perf: initial fixture")
        .expect("commit initial fixture files");
    drop(repo);

    add_history(&path, profile.commits.saturating_sub(1));
    add_branches(&path, profile.branches.saturating_sub(1));

    for index in 0..profile.modified_files {
        write_file(
            &path.join(format!("tracked/{:02}/{index:05}.txt", index % 32)),
            format!("fixture={} modified={index}\n", profile.name).as_bytes(),
        );
    }
    for index in 0..profile.untracked_files {
        let depth = if profile.untracked_depth == 0 {
            0
        } else {
            index % profile.untracked_depth
        };
        let mut file = path.join("untracked");
        for level in 0..depth {
            file.push(format!("d{level:02}"));
        }
        file.push(format!("file-{index:05}.txt"));
        write_file(&file, b"untracked fixture\n");
    }

    Fixture {
        _temp_dir: temp_dir,
        path,
        expected_statuses: profile.modified_files + profile.untracked_files,
        expected_commits: profile.commits,
        expected_branches: profile.branches,
    }
}

fn add_history(path: &Path, additional_commits: usize) {
    let repo = Repository::open(path).expect("open fixture for history");
    let signature = Signature::new("GitTributary Perf", "perf@example.invalid", &fixed_time())
        .expect("create deterministic signature");

    for index in 0..additional_commits {
        let parent_oid = repo.refname_to_id("HEAD").expect("resolve fixture HEAD");
        let parent = repo.find_commit(parent_oid).expect("find fixture parent");
        let tree = parent.tree().expect("read fixture tree");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("perf: history {index:05}"),
            &tree,
            &[&parent],
        )
        .expect("append fixture history");
    }
}

fn add_branches(path: &Path, additional_branches: usize) {
    let repo = Repository::open(path).expect("open fixture for branches");
    let head = repo
        .head()
        .expect("resolve fixture HEAD")
        .peel_to_commit()
        .expect("resolve fixture commit");
    for index in 0..additional_branches {
        repo.branch(&format!("perf/branch-{index:04}"), &head, false)
            .expect("create fixture branch");
    }
}

fn fixed_time() -> git2::Time {
    git2::Time::new(1_700_000_000, 0)
}

fn write_file(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create fixture parent directory");
    }
    fs::write(path, contents).expect("write fixture file");
}
