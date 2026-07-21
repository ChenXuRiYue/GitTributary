use std::collections::{BTreeMap, VecDeque};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{FlowRecord, FlowSummary};

pub const EVENT_RECENT_LIMIT: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CloudEvent {
    pub specversion: String,
    pub id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub time: String,
    pub subject: Option<String>,
    pub datacontenttype: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventDraft {
    pub source: String,
    #[serde(rename = "type", alias = "event_type")]
    pub event_type: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventDefinition {
    #[serde(rename = "type")]
    pub event_type: String,
    pub source: String,
    pub domain: String,
    pub summary: String,
    pub description: String,
    pub trigger_description: String,
    pub stability: String,
    pub filters: Vec<String>,
    pub data_schema: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowTriggerMatch {
    pub flow_id: String,
    pub flow_name: String,
    pub trigger: String,
    pub matched: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowRunIntent {
    pub id: String,
    pub flow_id: String,
    pub event_id: String,
    pub trigger: String,
    pub reason: String,
    pub created_at: String,
    #[serde(default)]
    pub inputs: Value,
    pub event: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventReceipt {
    pub event: CloudEvent,
    pub matches: Vec<FlowTriggerMatch>,
    pub run_intents: Vec<FlowRunIntent>,
}

#[derive(Debug, Clone)]
pub struct EventPool {
    definitions: BTreeMap<String, EventDefinition>,
    recent_events: VecDeque<CloudEvent>,
    recent_limit: usize,
    next_event_seq: u64,
    next_run_intent_seq: u64,
}

impl Default for EventPool {
    fn default() -> Self {
        Self::new()
    }
}

impl EventPool {
    pub fn new() -> Self {
        Self {
            definitions: builtin_event_definitions()
                .into_iter()
                .map(|definition| (definition.event_type.clone(), definition))
                .collect(),
            recent_events: VecDeque::new(),
            recent_limit: EVENT_RECENT_LIMIT,
            next_event_seq: 0,
            next_run_intent_seq: 0,
        }
    }

    pub fn catalog(&self) -> Vec<EventDefinition> {
        self.definitions.values().cloned().collect()
    }

    pub fn register_definition(&mut self, definition: EventDefinition) {
        self.definitions
            .insert(definition.event_type.clone(), definition);
    }

    pub fn recent_events(&self) -> Vec<CloudEvent> {
        self.recent_events.iter().rev().cloned().collect()
    }

    pub fn publish(
        &mut self,
        draft: EventDraft,
        flows: &[FlowRecord],
    ) -> crate::Result<EventReceipt> {
        self.ensure_known_event(&draft.event_type)?;
        let event = self.complete_event(draft);
        let matches = match_event_against_flows(&event, flows);
        let run_intents = matches
            .iter()
            .filter(|matched| matched.matched)
            .map(|matched| self.create_run_intent(&event, matched))
            .collect::<Vec<_>>();
        self.push_recent_event(event.clone());
        Ok(EventReceipt {
            event,
            matches,
            run_intents,
        })
    }

    pub fn match_event(
        &self,
        draft: EventDraft,
        flows: &[FlowRecord],
    ) -> crate::Result<EventReceipt> {
        self.ensure_known_event(&draft.event_type)?;
        let event = preview_event(draft);
        let matches = match_event_against_flows(&event, flows);
        let run_intents = matches
            .iter()
            .filter(|matched| matched.matched)
            .map(|matched| preview_run_intent(&event, matched))
            .collect::<Vec<_>>();
        Ok(EventReceipt {
            event,
            matches,
            run_intents,
        })
    }

    fn ensure_known_event(&self, event_type: &str) -> crate::Result<()> {
        if self.definitions.contains_key(event_type) {
            return Ok(());
        }
        Err(crate::FlowError::Validation(format!(
            "事件类型未登记: {event_type}"
        )))
    }

    fn complete_event(&mut self, draft: EventDraft) -> CloudEvent {
        self.next_event_seq = self.next_event_seq.saturating_add(1);
        CloudEvent {
            specversion: "1.0".to_string(),
            id: format!(
                "evt_{}_{}",
                Utc::now().timestamp_millis(),
                self.next_event_seq
            ),
            source: draft.source,
            event_type: draft.event_type,
            time: now_rfc3339(),
            subject: draft.subject,
            datacontenttype: "application/json".to_string(),
            data: normalized_data(draft.data),
        }
    }

    fn create_run_intent(
        &mut self,
        event: &CloudEvent,
        matched: &FlowTriggerMatch,
    ) -> FlowRunIntent {
        self.next_run_intent_seq = self.next_run_intent_seq.saturating_add(1);
        FlowRunIntent {
            id: format!(
                "run_intent_{}_{}",
                Utc::now().timestamp_millis(),
                self.next_run_intent_seq
            ),
            flow_id: matched.flow_id.clone(),
            event_id: event.id.clone(),
            trigger: matched.trigger.clone(),
            reason: matched.reason.clone(),
            created_at: now_rfc3339(),
            inputs: Value::Object(Default::default()),
            event: event_summary(event),
        }
    }

    fn push_recent_event(&mut self, event: CloudEvent) {
        self.recent_events.push_back(event);
        while self.recent_events.len() > self.recent_limit {
            self.recent_events.pop_front();
        }
    }
}

pub fn builtin_event_definitions() -> Vec<EventDefinition> {
    vec![
        event_definition(
            "app.started",
            "gittributary://app",
            "app",
            "应用启动",
            "应用启动完成",
            "GitTributary 启动并完成基础状态初始化后触发,适合驱动初始化检查、恢复任务或启动通知类 Flow。",
            &[],
            &[("started_at", "string")],
        ),
        event_definition(
            "workflow_dispatch",
            "gittributary://ui",
            "ui",
            "手动触发",
            "用户手动触发 Flow",
            "用户在界面或命令面板主动运行某个 Flow 时触发,通常携带用户填写的 inputs。",
            &["inputs"],
            &[("inputs", "object")],
        ),
        event_definition(
            "git.repo.opened",
            "gittributary://gt-git",
            "git",
            "仓库已打开",
            "Git 仓库打开成功",
            "用户打开或切换到一个 Git 仓库且仓库概况读取成功后触发,适合驱动仓库级初始化、状态检查或自动扫描。",
            &["repositories"],
            &[("repo", "string"), ("branch", "string")],
        ),
        event_definition(
            "git.commit.created",
            "gittributary://gt-git",
            "git",
            "提交已创建",
            "Git 仓库创建了新的提交",
            "通过 GitTributary 创建 commit 成功后触发,包含仓库、分支和提交 SHA,适合触发推送、生成记录或后续质量检查。",
            &["repositories", "branches"],
            &[("repo", "string"), ("branch", "string"), ("commit", "string")],
        ),
        event_definition(
            "git.push.completed",
            "gittributary://gt-git",
            "git",
            "推送已完成",
            "Git 推送完成",
            "通过 GitTributary push 成功后触发,包含仓库、分支和 remote,适合触发同步后的通知、发布后检查或远端状态刷新。",
            &["repositories", "branches"],
            &[("repo", "string"), ("branch", "string"), ("remote", "string")],
        ),
        event_definition(
            "store.key.changed",
            // Protocol identifier kept stable although the crate moved into gt-data.
            "gittributary://gt-store",
            "store",
            "配置已变更",
            "数据中心 key 写入成功",
            "公共数据中心 key 被 set 或 delete 成功后触发,不包含 private/secrets 命名空间,适合驱动设置联动和配置刷新。",
            &["namespace", "keys"],
            &[
                ("namespace", "string"),
                ("key", "string"),
                ("operation", "string"),
            ],
        ),
        event_definition(
            "flow.run.succeeded",
            "gittributary://gt-flow",
            "flow",
            "Flow 成功",
            "Flow 运行成功",
            "后续 Runner 完成某个 Flow 且结果为成功时触发,适合串联下游 Flow 或展示成功通知。",
            &["flow_id"],
            &[("flow_id", "string"), ("run_id", "string")],
        ),
        event_definition(
            "flow.run.failed",
            "gittributary://gt-flow",
            "flow",
            "Flow 失败",
            "Flow 运行失败",
            "后续 Runner 完成某个 Flow 且结果为失败时触发,适合触发告警、回滚提示或失败恢复 Flow。",
            &["flow_id"],
            &[("flow_id", "string"), ("run_id", "string")],
        ),
        event_definition(
            "flow.run.skipped",
            "gittributary://gt-flow",
            "flow",
            "Flow 跳过",
            "Flow 运行被跳过",
            "Runner 判断某个 Flow 当前不应执行时触发,例如 Flow 已停用、并发策略跳过或条件不满足。",
            &["flow_id"],
            &[("flow_id", "string"), ("run_id", "string")],
        ),
        event_definition(
            "flow.run.journal_failed",
            "gittributary://gt-flow",
            "flow",
            "Flow 审计日志写入失败",
            "Flow 已完成，但运行终态未能持久化",
            "Flow 的业务动作已经结束，但 RunJournal 终态写入失败时触发；消费者不得自动重试该 Flow。",
            &["flow_id"],
            &[
                ("flow_id", "string"),
                ("run_id", "string"),
                ("status", "string"),
            ],
        ),
        event_definition(
            "flow.run.result_persistence_failed",
            "gittributary://gt-flow",
            "flow",
            "Flow 结果投影写入失败",
            "Flow 已完成，但安全运行结果未能持久化",
            "Flow 的业务动作已经结束，但安全结果投影写入失败时触发；消费者不得自动重试该 Flow。",
            &["flow_id"],
            &[
                ("flow_id", "string"),
                ("run_id", "string"),
                ("status", "string"),
            ],
        ),
    ]
}

fn event_definition(
    event_type: &str,
    source: &str,
    domain: &str,
    summary: &str,
    description: &str,
    trigger_description: &str,
    filters: &[&str],
    data_schema: &[(&str, &str)],
) -> EventDefinition {
    EventDefinition {
        event_type: event_type.to_string(),
        source: source.to_string(),
        domain: domain.to_string(),
        summary: summary.to_string(),
        description: description.to_string(),
        trigger_description: trigger_description.to_string(),
        stability: "stable".to_string(),
        filters: filters.iter().map(|item| (*item).to_string()).collect(),
        data_schema: data_schema
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect(),
    }
}

fn preview_event(draft: EventDraft) -> CloudEvent {
    CloudEvent {
        specversion: "1.0".to_string(),
        id: "evt_preview".to_string(),
        source: draft.source,
        event_type: draft.event_type,
        time: now_rfc3339(),
        subject: draft.subject,
        datacontenttype: "application/json".to_string(),
        data: normalized_data(draft.data),
    }
}

fn preview_run_intent(event: &CloudEvent, matched: &FlowTriggerMatch) -> FlowRunIntent {
    FlowRunIntent {
        id: "run_intent_preview".to_string(),
        flow_id: matched.flow_id.clone(),
        event_id: event.id.clone(),
        trigger: matched.trigger.clone(),
        reason: matched.reason.clone(),
        created_at: now_rfc3339(),
        inputs: Value::Object(Default::default()),
        event: event_summary(event),
    }
}

fn match_event_against_flows(event: &CloudEvent, flows: &[FlowRecord]) -> Vec<FlowTriggerMatch> {
    let mut matches = Vec::new();
    for flow in flows {
        let summary = &flow.summary;
        if !flow.enabled || !summary.enabled {
            matches.push(skipped(summary, &event.event_type, "flow_disabled"));
            continue;
        }
        let Some(trigger) = summary
            .triggers
            .iter()
            .find(|trigger| trigger_kind_matches(&trigger.kind, &event.event_type))
        else {
            matches.push(skipped(
                summary,
                &event.event_type,
                "event_type_not_subscribed",
            ));
            continue;
        };
        if let Some(reason) = filter_mismatch_reason(event, &trigger.filters) {
            matches.push(FlowTriggerMatch {
                flow_id: summary.id.clone(),
                flow_name: summary.name.clone(),
                trigger: trigger.kind.clone(),
                matched: false,
                reason,
            });
            continue;
        }
        matches.push(FlowTriggerMatch {
            flow_id: summary.id.clone(),
            flow_name: summary.name.clone(),
            trigger: trigger.kind.clone(),
            matched: true,
            reason: "event_matched".to_string(),
        });
    }
    matches.sort_by(|a, b| {
        b.matched
            .cmp(&a.matched)
            .then_with(|| a.flow_name.cmp(&b.flow_name))
            .then_with(|| a.flow_id.cmp(&b.flow_id))
    });
    matches
}

fn skipped(summary: &FlowSummary, trigger: &str, reason: &str) -> FlowTriggerMatch {
    FlowTriggerMatch {
        flow_id: summary.id.clone(),
        flow_name: summary.name.clone(),
        trigger: trigger.to_string(),
        matched: false,
        reason: reason.to_string(),
    }
}

fn trigger_kind_matches(kind: &str, event_type: &str) -> bool {
    kind == event_type
        || (kind == "store_changed" && event_type == "store.key.changed")
        || (kind == "workflow_dispatch" && event_type == "workflow_dispatch")
}

fn filter_mismatch_reason(
    event: &CloudEvent,
    filters: &BTreeMap<String, Vec<String>>,
) -> Option<String> {
    for (key, expected) in filters {
        if expected.is_empty() {
            continue;
        }
        let actual = match key.as_str() {
            "branches" => event_data_string(event, "branch"),
            "repositories" => event_data_string(event, "repo"),
            "namespace" => event_data_string(event, "namespace"),
            "keys" => event_data_string(event, "key"),
            _ => None,
        };
        let Some(actual) = actual else {
            return Some(format!("missing_filter_field:{key}"));
        };
        if !expected
            .iter()
            .any(|item| filter_value_matches(item, &actual))
        {
            return Some(format!("filter_mismatch:{key}"));
        }
    }
    None
}

fn filter_value_matches(expected: &str, actual: &str) -> bool {
    let expected = expected.trim();
    expected == actual || expected == "*" || expected.starts_with("${{")
}

fn event_data_string(event: &CloudEvent, key: &str) -> Option<String> {
    event
        .data
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn normalized_data(data: Value) -> Value {
    if data.is_null() {
        Value::Object(Default::default())
    } else {
        data
    }
}

fn event_summary(event: &CloudEvent) -> Value {
    json!({
        "id": event.id,
        "type": event.event_type,
        "source": event.source,
        "time": event.time,
        "subject": event.subject,
        "data": event.data,
    })
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
