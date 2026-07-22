use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{from_value, to_value, Value};

pub(super) fn field<T: DeserializeOwned>(payload: &Value, field: &str) -> Result<T, String> {
    let value = payload
        .get(field)
        .cloned()
        .ok_or_else(|| format!("missing_payload_field:{field}"))?;
    from_value(value).map_err(|error| format!("invalid_payload_field:{field}:{error}"))
}

pub(super) fn optional_field<T: DeserializeOwned>(
    payload: &Value,
    field: &str,
) -> Result<Option<T>, String> {
    payload
        .get(field)
        .cloned()
        .map(from_value)
        .transpose()
        .map_err(|error| format!("invalid_payload_field:{field}:{error}"))
}

pub(super) fn serialize<T: Serialize>(value: T) -> Result<Value, String> {
    to_value(value).map_err(|error| format!("serialization_failed:{error}"))
}
