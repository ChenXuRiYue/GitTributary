use gt_flow::{default_folder_for_summary, normalize_folder, parse_workflow, workflow_key};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn folder_normalization_is_idempotent_and_removes_traversal_segments(
        segments in prop::collection::vec("[^/]{0,16}", 0..32),
    ) {
        let input = segments.join("/");
        let once = normalize_folder(Some(&input), None);
        let twice = normalize_folder(Some(&once), None);
        prop_assert_eq!(&once, &twice);
        prop_assert!(!once.split('/').any(|segment| segment == "." || segment == ".." || segment.is_empty()));
    }

    #[test]
    fn workflow_keys_are_a_pure_prefix_mapping(id in ".{0,128}") {
        let key = workflow_key(&id);
        prop_assert_eq!(key, format!("workflow.{id}"));
    }

    #[test]
    fn arbitrary_workflow_text_never_panics(input in ".{0,4096}") {
        let result = std::panic::catch_unwind(|| parse_workflow(&input));
        prop_assert!(result.is_ok());
    }
}

#[test]
fn default_folder_is_stable_after_parse_and_normalization() {
    let workflow = r#"
name: Scheduled backup
gt:
  id: flow.scheduled_backup
  enabled: true
on:
  schedule:
    - cron: "0 18 * * *"
jobs:
  backup:
    runs-on: gittributary-local
    steps:
      - uses: gittributary/git/push@v1
"#;
    let summary = parse_workflow(workflow).unwrap();
    let default = default_folder_for_summary(&summary);
    assert_eq!(default, "定时");
    assert_eq!(normalize_folder(None, Some(&summary)), default);
}
