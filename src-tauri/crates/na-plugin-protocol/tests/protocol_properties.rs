use na_plugin_protocol::{Event, Message, Request, Response, RpcError, PROTOCOL_VERSION};
use proptest::prelude::*;
use serde_json::{Map, Number, Value};

fn json_leaf() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        any::<i64>().prop_map(|value| Value::Number(Number::from(value))),
        ".{0,64}".prop_map(Value::String),
    ]
}

fn json_value() -> impl Strategy<Value = Value> {
    json_leaf().prop_recursive(4, 64, 8, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..8).prop_map(Value::Array),
            prop::collection::btree_map("[a-zA-Z0-9_.-]{1,16}", inner, 0..8)
                .prop_map(|entries| Value::Object(entries.into_iter().collect::<Map<_, _>>())),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn every_request_round_trips_through_tagged_json(
        id in ".{0,64}",
        method in ".{0,64}",
        params in json_value(),
    ) {
        let message = Message::Request(Request::new(id, method, params));
        let bytes = serde_json::to_vec(&message).unwrap();
        let restored: Message = serde_json::from_slice(&bytes).unwrap();
        prop_assert_eq!(restored, message);
    }

    #[test]
    fn every_event_round_trips_and_uses_current_protocol(
        name in ".{0,64}",
        payload in json_value(),
    ) {
        let event = Event::new(name, payload);
        prop_assert_eq!(event.protocol_version, PROTOCOL_VERSION);
        let message = Message::Event(event);
        let restored: Message = serde_json::from_value(serde_json::to_value(&message).unwrap()).unwrap();
        prop_assert_eq!(restored, message);
    }

    #[test]
    fn response_constructors_preserve_the_success_xor_error_invariant(
        id in ".{0,64}",
        result in json_value(),
        code in ".{0,32}",
        message in ".{0,64}",
        data in proptest::option::of(json_value()),
    ) {
        let success = Response::success(id.clone(), result.clone());
        prop_assert_eq!(success.result, Some(result));
        prop_assert!(success.error.is_none());

        let mut error = RpcError::new(code, message);
        if let Some(data) = data.clone() {
            error = error.with_data(data);
        }
        let failure = Response::error(id, error);
        prop_assert!(failure.result.is_none());
        prop_assert!(failure.error.is_some());
        prop_assert_eq!(failure.error.unwrap().data, data);
    }
}
