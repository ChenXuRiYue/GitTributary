use std::fs::{self, OpenOptions};
use std::io::Write;

use gt_data::{DataHub, RunJournal, RunJournalConfig, RunJournalEventKind, RunJournalObserver};
use gt_flow::{
    FlowLifecycleEvent, FlowLifecycleEventKind, FlowRunObserver, FlowRunReport, FlowRunStatus,
};

fn report(run_id: &str) -> FlowRunReport {
    FlowRunReport {
        run_id: run_id.to_string(),
        flow_id: "demo".to_string(),
        flow_name: "Demo".to_string(),
        status: FlowRunStatus::Succeeded,
        trigger: "workflow_dispatch".to_string(),
        reason: "manual_run".to_string(),
        started_at: "2026-07-21T00:00:00Z".to_string(),
        finished_at: "2026-07-21T00:00:01Z".to_string(),
        jobs: Vec::new(),
        event: serde_json::json!({ "secret": "must-not-be-persisted" }),
        inputs: serde_json::json!({ "token": "must-not-be-persisted" }),
        error: None,
    }
}

fn only_run_dir(journal: &RunJournal) -> std::path::PathBuf {
    fs::read_dir(journal.root())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
}

#[test]
fn journal_persists_bounded_lifecycle_without_report_payloads() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    let run_id = "run_123";

    journal
        .start_run(run_id, "demo", "2026-07-21T00:00:00Z")
        .unwrap();
    journal.complete_run(&report(run_id)).unwrap();

    let records = journal.read_run(run_id).unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].kind, RunJournalEventKind::RunStarted);
    assert_eq!(records[1].kind, RunJournalEventKind::RunCompleted);
    assert_eq!(records[0].seq, 1);
    assert_eq!(records[1].seq, 2);

    let bytes = fs::read(
        fs::read_dir(only_run_dir(&journal))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path(),
    )
    .unwrap();
    let text = String::from_utf8(bytes).unwrap();
    assert!(!text.contains("must-not-be-persisted"));
}

#[test]
fn journal_rotates_segments_and_keeps_each_file_bounded() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::with_config(
        directory.path(),
        RunJournalConfig {
            max_segment_bytes: 360,
            max_record_bytes: 360,
            ..RunJournalConfig::default()
        },
    );
    let run_id = "run_rotate";

    journal
        .start_run(run_id, "demo", "2026-07-21T00:00:00Z")
        .unwrap();
    journal.complete_run(&report(run_id)).unwrap();

    let segments = fs::read_dir(only_run_dir(&journal))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(segments.len(), 2);
    assert!(segments
        .iter()
        .all(|path| path.metadata().unwrap().len() <= 360));
    assert_eq!(journal.read_run(run_id).unwrap().len(), 2);
}

#[test]
fn journal_repairs_only_a_torn_tail_before_next_append() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    let run_id = "run_torn";
    journal
        .start_run(run_id, "demo", "2026-07-21T00:00:00Z")
        .unwrap();

    let segment = fs::read_dir(only_run_dir(&journal))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    OpenOptions::new()
        .append(true)
        .open(&segment)
        .unwrap()
        .write_all(b"{\"torn\"")
        .unwrap();

    journal.complete_run(&report(run_id)).unwrap();
    assert_eq!(journal.read_run(run_id).unwrap().len(), 2);
}

#[test]
fn journal_encodes_run_ids_instead_of_using_them_as_paths() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    let run_id = "../../outside";
    journal
        .start_run(run_id, "demo", "2026-07-21T00:00:00Z")
        .unwrap();

    let run_dir = only_run_dir(&journal);
    assert!(run_dir.starts_with(journal.root()));
    assert!(!run_dir
        .file_name()
        .unwrap()
        .to_string_lossy()
        .contains(".."));
    assert!(!directory.path().join("outside").exists());
}

#[test]
fn journal_rejects_oversized_records_before_writing() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::with_config(
        directory.path(),
        RunJournalConfig {
            max_segment_bytes: 64,
            max_record_bytes: 64,
            ..RunJournalConfig::default()
        },
    );

    assert!(journal
        .start_run("run_large", "demo", "2026-07-21T00:00:00Z")
        .is_err());
    assert!(journal.read_run("run_large").unwrap().is_empty());
}

#[test]
fn journal_detects_checksum_mismatch_on_complete_json() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    let run_id = "run_checksum";
    journal
        .start_run(run_id, "demo", "2026-07-21T00:00:00Z")
        .unwrap();

    let segment = fs::read_dir(only_run_dir(&journal))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let content = fs::read_to_string(&segment).unwrap();
    let mut frame: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
    frame["event"]["flow_id"] = serde_json::json!("tampered");
    fs::write(
        &segment,
        format!("{}\n", serde_json::to_string(&frame).unwrap()),
    )
    .unwrap();

    assert!(journal.read_run(run_id).is_err());
}

#[test]
fn journal_can_reconcile_incomplete_runs_after_exclusive_ownership_is_confirmed() {
    let directory = tempfile::tempdir().unwrap();
    {
        let data = DataHub::open(directory.path()).unwrap();
        data.run_journal()
            .start_run("run_crashed", "demo", "2026-07-21T00:00:00Z")
            .unwrap();
    }

    let reopened = DataHub::open(directory.path()).unwrap();
    assert_eq!(
        reopened
            .run_journal()
            .read_run("run_crashed")
            .unwrap()
            .len(),
        1
    );
    reopened
        .run_journal()
        .reconcile_incomplete("2026-07-21T00:01:00Z")
        .unwrap();
    let records = reopened.run_journal().read_run("run_crashed").unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1].kind, RunJournalEventKind::RunAbandoned);
    assert_eq!(records[1].status, FlowRunStatus::Failed);
}

#[test]
fn journal_lists_runs_and_prunes_oldest_completed_history() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::with_config(
        directory.path(),
        RunJournalConfig {
            max_completed_runs: 1,
            ..RunJournalConfig::default()
        },
    );
    for (run_id, started_at) in [
        ("run_old", "2026-07-21T00:00:00Z"),
        ("run_new", "2026-07-21T00:01:00Z"),
    ] {
        journal.start_run(run_id, "demo", started_at).unwrap();
        let mut completed = report(run_id);
        completed.started_at = started_at.to_string();
        completed.finished_at = started_at.to_string();
        journal.complete_run(&completed).unwrap();
    }

    let summaries = journal.list_runs(10).unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].run_id, "run_new");
    assert!(journal.read_run("run_old").unwrap().is_empty());
}

#[test]
fn journal_rejects_completion_from_another_flow() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    journal
        .start_run("run_mismatch", "flow-a", "2026-07-21T00:00:00Z")
        .unwrap();
    let mut completed = report("run_mismatch");
    completed.flow_id = "flow-b".to_string();

    assert!(journal.complete_run(&completed).is_err());
    assert_eq!(journal.read_run("run_mismatch").unwrap().len(), 1);
}

#[test]
fn journal_observer_records_ordered_job_and_node_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    journal
        .start_run("run_observed", "demo", "2026-07-21T00:00:00Z")
        .unwrap();
    let mut observer = RunJournalObserver::new(&journal);
    for (kind, status, node_id) in [
        (
            FlowLifecycleEventKind::JobStarted,
            FlowRunStatus::Running,
            None,
        ),
        (
            FlowLifecycleEventKind::NodeStarted,
            FlowRunStatus::Running,
            Some("upload"),
        ),
        (
            FlowLifecycleEventKind::NodeFinished,
            FlowRunStatus::Succeeded,
            Some("upload"),
        ),
        (
            FlowLifecycleEventKind::JobFinished,
            FlowRunStatus::Succeeded,
            None,
        ),
    ] {
        observer.observe(&FlowLifecycleEvent {
            kind,
            run_id: "run_observed".to_string(),
            flow_id: "demo".to_string(),
            job_id: Some("publish".to_string()),
            node_id: node_id.map(str::to_string),
            status,
            occurred_at: "2026-07-21T00:00:01Z".to_string(),
        });
    }
    assert_eq!(observer.first_error(), None);
    journal.complete_run(&report("run_observed")).unwrap();

    let records = journal.read_run("run_observed").unwrap();
    assert_eq!(records.len(), 6);
    assert_eq!(records[2].kind, RunJournalEventKind::NodeStarted);
    assert_eq!(records[2].node_id.as_deref(), Some("upload"));
}

#[test]
fn journal_observer_reports_invalid_order_without_persisting_it() {
    let directory = tempfile::tempdir().unwrap();
    let journal = RunJournal::new(directory.path());
    journal
        .start_run("run_bad_order", "demo", "2026-07-21T00:00:00Z")
        .unwrap();
    let mut observer = RunJournalObserver::new(&journal);
    observer.observe(&FlowLifecycleEvent {
        kind: FlowLifecycleEventKind::NodeStarted,
        run_id: "run_bad_order".to_string(),
        flow_id: "demo".to_string(),
        job_id: Some("publish".to_string()),
        node_id: Some("upload".to_string()),
        status: FlowRunStatus::Running,
        occurred_at: "2026-07-21T00:00:01Z".to_string(),
    });

    assert!(observer.first_error().is_some());
    assert_eq!(journal.read_run("run_bad_order").unwrap().len(), 1);
}
