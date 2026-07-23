use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{FlowRecord, FlowSummary};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowNodeDefinition {
    pub uses: String,
    pub name: String,
    pub node_type: String,
    pub summary: String,
    pub description: String,
    pub inputs_schema: BTreeMap<String, String>,
    pub outputs_schema: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowNodeSpec {
    pub id: String,
    pub name: Option<String>,
    pub job_id: String,
    pub uses: String,
    pub node_type: String,
    pub summary: String,
    pub inputs: BTreeMap<String, String>,
    pub known: bool,
    #[serde(default)]
    pub owner: Option<FlowNodeOwner>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum FlowNodeOwner {
    Core,
    Plugin(String),
}

#[derive(Debug, Clone)]
struct RegisteredFlowNode {
    definition: FlowNodeDefinition,
    owner: FlowNodeOwner,
}

#[derive(Debug, Clone)]
pub struct FlowNodeRegistry {
    definitions: BTreeMap<String, RegisteredFlowNode>,
}

impl Default for FlowNodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl FlowNodeRegistry {
    pub fn new() -> Self {
        Self {
            definitions: BTreeMap::new(),
        }
    }

    pub fn list(&self) -> Vec<FlowNodeDefinition> {
        self.definitions
            .values()
            .map(|registered| registered.definition.clone())
            .collect()
    }

    pub fn list_with_owners(&self) -> Vec<(FlowNodeDefinition, FlowNodeOwner)> {
        self.definitions
            .values()
            .map(|registered| (registered.definition.clone(), registered.owner.clone()))
            .collect()
    }

    pub fn get(&self, uses: &str) -> Option<&FlowNodeDefinition> {
        self.definitions
            .get(uses)
            .map(|registered| &registered.definition)
    }

    pub fn owner_of(&self, uses: &str) -> Option<&FlowNodeOwner> {
        self.definitions
            .get(uses)
            .map(|registered| &registered.owner)
    }

    pub fn replace_core_nodes(
        &mut self,
        definitions: Vec<FlowNodeDefinition>,
    ) -> Result<(), String> {
        self.replace_nodes(FlowNodeOwner::Core, definitions)
    }

    pub fn replace_plugin_nodes(
        &mut self,
        plugin_id: &str,
        definitions: Vec<FlowNodeDefinition>,
    ) -> Result<(), String> {
        if plugin_id.trim().is_empty() || plugin_id != plugin_id.trim() {
            return Err("flow_node_plugin_id_empty".to_string());
        }
        self.replace_nodes(FlowNodeOwner::Plugin(plugin_id.to_string()), definitions)
    }

    fn replace_nodes(
        &mut self,
        owner: FlowNodeOwner,
        definitions: Vec<FlowNodeDefinition>,
    ) -> Result<(), String> {
        let mut incoming = BTreeMap::new();
        for definition in definitions {
            if definition.uses.trim().is_empty() || definition.uses != definition.uses.trim() {
                return Err("flow_node_uses_empty".to_string());
            }
            if incoming
                .insert(definition.uses.clone(), definition)
                .is_some()
            {
                return Err("flow_node_uses_duplicate".to_string());
            }
        }
        for uses in incoming.keys() {
            if self
                .definitions
                .get(uses)
                .is_some_and(|registered| registered.owner != owner)
            {
                return Err(format!("flow_node_uses_conflict:{uses}"));
            }
        }

        self.definitions
            .retain(|_, registered| registered.owner != owner);
        for (uses, definition) in incoming {
            self.definitions.insert(
                uses,
                RegisteredFlowNode {
                    definition,
                    owner: owner.clone(),
                },
            );
        }
        Ok(())
    }

    pub fn unregister_plugin_nodes(&mut self, plugin_id: &str) {
        let owner = FlowNodeOwner::Plugin(plugin_id.to_string());
        self.definitions
            .retain(|_, registered| registered.owner != owner);
    }

    pub fn compile_record(&self, record: &FlowRecord) -> Vec<FlowNodeSpec> {
        compile_flow_nodes(&record.summary, self)
    }

    pub fn compile_summary(&self, summary: &FlowSummary) -> Vec<FlowNodeSpec> {
        compile_flow_nodes(summary, self)
    }
}

pub fn compile_flow_nodes(summary: &FlowSummary, registry: &FlowNodeRegistry) -> Vec<FlowNodeSpec> {
    let mut nodes = Vec::new();
    for job in &summary.jobs {
        for (index, step) in job.steps.iter().enumerate() {
            let registered = registry.definitions.get(&step.uses);
            let definition = registered.map(|item| &item.definition);
            let fallback_id = format!("{}-{}", job.id, index + 1);
            nodes.push(FlowNodeSpec {
                id: step.id.clone().unwrap_or(fallback_id),
                name: step.name.clone(),
                job_id: job.id.clone(),
                uses: step.uses.clone(),
                node_type: definition
                    .map(|item| item.node_type.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                summary: definition
                    .map(|item| item.summary.clone())
                    .unwrap_or_else(|| "未注册节点动作".to_string()),
                inputs: step.inputs.clone(),
                known: definition.is_some(),
                owner: registered.map(|item| item.owner.clone()),
            });
        }
    }
    nodes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin_node(uses: &str, name: &str) -> FlowNodeDefinition {
        FlowNodeDefinition {
            uses: uses.to_string(),
            name: name.to_string(),
            node_type: "plugin".to_string(),
            summary: name.to_string(),
            description: String::new(),
            inputs_schema: BTreeMap::new(),
            outputs_schema: BTreeMap::new(),
        }
    }

    fn core_node(uses: &str, name: &str) -> FlowNodeDefinition {
        let mut definition = plugin_node(uses, name);
        definition.node_type = "core".to_string();
        definition
    }

    #[test]
    fn new_registry_is_empty() {
        let registry = FlowNodeRegistry::new();
        assert!(registry.list().is_empty());
    }

    #[test]
    fn atomically_replaces_core_nodes() {
        let mut registry = FlowNodeRegistry::new();
        let first = "noteaura/test/first@v1";
        let stale = "noteaura/test/stale@v1";
        registry
            .replace_core_nodes(vec![core_node(first, "First"), core_node(stale, "Stale")])
            .unwrap();
        registry
            .replace_core_nodes(vec![core_node(first, "First v2")])
            .unwrap();
        assert_eq!(registry.get(first).unwrap().name, "First v2");
        assert!(registry.get(stale).is_none());
        assert_eq!(registry.owner_of(first), Some(&FlowNodeOwner::Core));
    }

    #[test]
    fn replaces_and_unregisters_nodes_by_plugin() {
        let mut registry = FlowNodeRegistry::new();
        let core = "noteaura/files/assert-exists@v1";
        registry
            .replace_core_nodes(vec![core_node(core, "Assert exists")])
            .unwrap();
        let first = "com.example.publisher/build@v1";
        let stale = "com.example.publisher/scan@v1";
        registry
            .replace_plugin_nodes(
                "com.example.publisher",
                vec![plugin_node(first, "Build"), plugin_node(stale, "Scan")],
            )
            .unwrap();
        assert_eq!(
            registry.owner_of(first),
            Some(&FlowNodeOwner::Plugin("com.example.publisher".to_string()))
        );

        registry
            .replace_plugin_nodes(
                "com.example.publisher",
                vec![plugin_node(first, "Build v2")],
            )
            .unwrap();
        assert_eq!(registry.get(first).unwrap().name, "Build v2");
        assert!(registry.get(stale).is_none());

        registry.unregister_plugin_nodes("com.example.publisher");
        assert!(registry.get(first).is_none());
        assert!(registry.get(core).is_some());
    }

    #[test]
    fn rejects_cross_owner_collisions_without_mutation() {
        let mut registry = FlowNodeRegistry::new();
        let core = "noteaura/files/assert-exists@v1";
        registry
            .replace_core_nodes(vec![core_node(core, "Assert exists")])
            .unwrap();
        let error = registry
            .replace_plugin_nodes("com.example.bad", vec![plugin_node(core, "Override core")])
            .unwrap_err();
        assert_eq!(error, format!("flow_node_uses_conflict:{core}"));
        assert_eq!(registry.owner_of(core), Some(&FlowNodeOwner::Core));

        let shared = "com.example.first/action@v1";
        registry
            .replace_plugin_nodes("com.example.first", vec![plugin_node(shared, "First")])
            .unwrap();
        assert!(registry
            .replace_plugin_nodes("com.example.second", vec![plugin_node(shared, "Second")])
            .is_err());
        assert_eq!(registry.get(shared).unwrap().name, "First");
    }

    #[test]
    fn rejects_duplicate_batch_without_removing_previous_nodes() {
        let mut registry = FlowNodeRegistry::new();
        let uses = "com.example.demo/action@v1";
        registry
            .replace_plugin_nodes("com.example.demo", vec![plugin_node(uses, "Existing")])
            .unwrap();
        assert!(registry
            .replace_plugin_nodes(
                "com.example.demo",
                vec![plugin_node(uses, "A"), plugin_node(uses, "B")],
            )
            .is_err());
        assert_eq!(registry.get(uses).unwrap().name, "Existing");
    }

    #[test]
    fn deserializes_legacy_specs_without_owner() {
        let spec: FlowNodeSpec = serde_json::from_value(serde_json::json!({
            "id": "scan",
            "name": null,
            "job_id": "job",
            "uses": "com.example.demo/scan@v1",
            "node_type": "unknown",
            "summary": "Legacy",
            "inputs": {},
            "known": false
        }))
        .unwrap();
        assert_eq!(spec.owner, None);
    }

    #[test]
    fn lists_core_and_plugin_owners() {
        let mut registry = FlowNodeRegistry::new();
        let core = "noteaura/files/assert-exists@v1";
        registry
            .replace_core_nodes(vec![core_node(core, "Assert exists")])
            .unwrap();
        let uses = "com.example.demo/action@v1";
        registry
            .replace_plugin_nodes("com.example.demo", vec![plugin_node(uses, "Demo")])
            .unwrap();
        let owners = registry
            .list_with_owners()
            .into_iter()
            .map(|(definition, owner)| (definition.uses, owner))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            owners.get(uses),
            Some(&FlowNodeOwner::Plugin("com.example.demo".to_string()))
        );
        assert_eq!(owners.get(core), Some(&FlowNodeOwner::Core));
    }

    #[test]
    fn rejects_core_collision_without_mutating_existing_core_nodes() {
        let mut registry = FlowNodeRegistry::new();
        let core = "noteaura/test/core@v1";
        let plugin = "com.example.demo/action@v1";
        registry
            .replace_core_nodes(vec![core_node(core, "Core")])
            .unwrap();
        registry
            .replace_plugin_nodes("com.example.demo", vec![plugin_node(plugin, "Plugin")])
            .unwrap();

        let error = registry
            .replace_core_nodes(vec![core_node(plugin, "Conflicting core")])
            .unwrap_err();
        assert_eq!(error, format!("flow_node_uses_conflict:{plugin}"));
        assert_eq!(registry.get(core).unwrap().name, "Core");
        assert_eq!(registry.get(plugin).unwrap().name, "Plugin");
    }
}
