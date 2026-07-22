mod catalog;

use std::collections::{BTreeMap, VecDeque};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{FlowRecord, FlowSummary};
use catalog::builtin_event_definitions;

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
