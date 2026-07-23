use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

pub mod method {
    pub const PING: &str = "ping";
    pub const STATUS: &str = "status";
    pub const LOAD_PLUGIN: &str = "load_plugin";
    pub const INVOKE: &str = "invoke";
    pub const UNLOAD_PLUGIN: &str = "unload_plugin";
    pub const SHUTDOWN: &str = "shutdown";
}

pub mod event {
    pub const HELLO: &str = "hello";
    pub const PROTOCOL_ERROR: &str = "protocol_error";
}

pub mod error_code {
    pub const INVALID_REQUEST: &str = "invalid_request";
    pub const METHOD_NOT_FOUND: &str = "method_not_found";
    pub const PROTOCOL_VERSION_MISMATCH: &str = "protocol_version_mismatch";
    pub const INTERNAL_ERROR: &str = "internal_error";
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
    Request(Request),
    Response(Response),
    Event(Event),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub protocol_version: u32,
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl Request {
    pub fn new(id: impl Into<String>, method: impl Into<String>, params: Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            id: id.into(),
            method: method.into(),
            params,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol_version: u32,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            id: id.into(),
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: impl Into<String>, error: RpcError) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            id: id.into(),
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub protocol_version: u32,
    pub event: String,
    #[serde(default)]
    pub payload: Value,
}

impl Event {
    pub fn new(event: impl Into<String>, payload: Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            event: event.into(),
            payload,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloPayload {
    pub host_name: String,
    pub host_version: String,
    pub process_id: u32,
    pub supported_methods: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub state: HostState,
    pub process_id: u32,
    pub loaded_plugins: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostState {
    Running,
    ShuttingDown,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_round_trips_as_tagged_camel_case_json() {
        let message = Message::Request(Request::new("request-1", method::PING, json!({})));
        let json = serde_json::to_string(&message).unwrap();

        assert!(json.contains(r#""type":"request""#));
        assert!(json.contains(r#""protocolVersion":1"#));
        assert_eq!(serde_json::from_str::<Message>(&json).unwrap(), message);
    }

    #[test]
    fn success_and_error_responses_are_mutually_exclusive() {
        let success = serde_json::to_value(Message::Response(Response::success(
            "1",
            json!({ "pong": true }),
        )))
        .unwrap();
        let error = serde_json::to_value(Message::Response(Response::error(
            "2",
            RpcError::new(error_code::METHOD_NOT_FOUND, "unknown method"),
        )))
        .unwrap();

        assert!(success.get("result").is_some());
        assert!(success.get("error").is_none());
        assert!(error.get("result").is_none());
        assert!(error.get("error").is_some());
    }
}
