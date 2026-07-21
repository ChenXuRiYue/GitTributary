use std::collections::BTreeMap;

use gt_store::Store;
use proptest::prelude::*;
use serde_json::{Number, Value};

fn primitive_json() -> impl Strategy<Value = Value> {
    prop_oneof![
        any::<bool>().prop_map(Value::Bool),
        any::<i64>().prop_map(|value| Value::Number(Number::from(value))),
        ".{0,128}".prop_map(Value::String),
    ]
}

#[test]
fn null_is_an_immediate_and_persistent_delete_tombstone() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::open(temp.path()).unwrap();
    store
        .set("property-test", "nullable", Value::String("present".into()))
        .unwrap();
    store.set("property-test", "nullable", Value::Null).unwrap();
    assert_eq!(store.get("property-test", "nullable"), None);
    store
        .set_with_ts(
            "property-test",
            "remote-nullable",
            Value::String("present".into()),
            10,
        )
        .unwrap();
    store
        .set_with_ts("property-test", "remote-nullable", Value::Null, 20)
        .unwrap();
    assert_eq!(store.get("property-test", "remote-nullable"), None);
    drop(store);

    let reopened = Store::open(temp.path()).unwrap();
    assert_eq!(reopened.get("property-test", "nullable"), None);
    assert_eq!(reopened.get("property-test", "remote-nullable"), None);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn arbitrary_key_value_sets_survive_reopen(
        entries in prop::collection::btree_map("[a-z][a-z0-9_.-]{0,31}", primitive_json(), 0..64),
    ) {
        let temp = tempfile::tempdir().unwrap();
        {
            let mut store = Store::open(temp.path()).unwrap();
            for (key, value) in &entries {
                store.set("property-test", key, value.clone()).unwrap();
            }
        }

        let reopened = Store::open(temp.path()).unwrap();
        let restored = reopened.entries("property-test").into_iter().collect::<BTreeMap<_, _>>();
        prop_assert_eq!(restored, entries);
    }

    #[test]
    fn deleting_an_arbitrary_existing_key_is_persistent(
        key in "[a-z][a-z0-9_.-]{0,31}",
        value in primitive_json(),
    ) {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::open(temp.path()).unwrap();
        store.set("property-test", &key, value).unwrap();
        store.delete("property-test", &key).unwrap();
        drop(store);

        let reopened = Store::open(temp.path()).unwrap();
        prop_assert_eq!(reopened.get("property-test", &key), None);
    }
}
