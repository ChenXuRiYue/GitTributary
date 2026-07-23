use std::hint::black_box;
use std::time::Duration;

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use na_plugin_protocol::{method, Message, Request};
use serde_json::json;

const WORKFLOW: &str = r#"
name: Publish notes

gn:
  id: flow.publish_notes
  enabled: true

on:
  git.commit.created:
    branches: [main]

jobs:
  publish:
    runs-on: noteaura-local
    steps:
      - id: validate
        uses: noteaura/files/assert-exists@v1
        with:
          path: ${{ gn.workspace.active_repo }}
      - id: publish
        uses: com.example.publisher/build@v1
        with:
          source: ${{ steps.validate.outputs.path }}
"#;

fn flow_benchmarks(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("flow");
    group.sample_size(50);
    group.measurement_time(Duration::from_secs(3));
    group.throughput(Throughput::Bytes(WORKFLOW.len() as u64));
    group.bench_function("parse_workflow", |bencher| {
        bencher.iter(|| na_flow::parse_workflow(black_box(WORKFLOW)).unwrap())
    });

    for segments in [1_usize, 8, 64] {
        let folder = std::iter::repeat_n("release", segments)
            .collect::<Vec<_>>()
            .join("/");
        group.bench_with_input(
            BenchmarkId::new("normalize_folder", segments),
            &folder,
            |bencher, folder| {
                bencher.iter(|| na_flow::normalize_folder(Some(black_box(folder)), None))
            },
        );
    }
    group.finish();
}

fn protocol_benchmarks(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("plugin_protocol");
    group.sample_size(50);
    group.measurement_time(Duration::from_secs(3));

    for payload_bytes in [0_usize, 1_024, 64 * 1_024] {
        let message = Message::Request(Request::new(
            "benchmark-request",
            method::INVOKE,
            json!({ "payload": "x".repeat(payload_bytes) }),
        ));
        group.throughput(Throughput::Bytes(payload_bytes.max(1) as u64));
        group.bench_with_input(
            BenchmarkId::new("serialize_json", payload_bytes),
            &message,
            |bencher, message| bencher.iter(|| serde_json::to_vec(black_box(message)).unwrap()),
        );
    }
    group.finish();
}

criterion_group!(benches, flow_benchmarks, protocol_benchmarks);
criterion_main!(benches);
