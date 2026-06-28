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
}

#[derive(Debug, Clone)]
pub struct FlowNodeRegistry {
    definitions: BTreeMap<String, FlowNodeDefinition>,
}

impl Default for FlowNodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl FlowNodeRegistry {
    pub fn new() -> Self {
        Self {
            definitions: builtin_node_definitions()
                .into_iter()
                .map(|definition| (definition.uses.clone(), definition))
                .collect(),
        }
    }

    pub fn list(&self) -> Vec<FlowNodeDefinition> {
        self.definitions.values().cloned().collect()
    }

    pub fn get(&self, uses: &str) -> Option<&FlowNodeDefinition> {
        self.definitions.get(uses)
    }

    pub fn register(&mut self, definition: FlowNodeDefinition) {
        self.definitions.insert(definition.uses.clone(), definition);
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
            let definition = registry.get(&step.uses);
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
            });
        }
    }
    nodes
}

pub fn builtin_node_definitions() -> Vec<FlowNodeDefinition> {
    vec![
        node_definition(
            "gittributary/workspace/resolve-publish-context@v1",
            "解析发布上下文",
            "context",
            "解析源仓库、目标仓库、输出目录和目标分支",
            "根据当前工作区和数据中心配置产出发布链路所需上下文,供后续构建、同步和 Git 节点引用。",
            &[
                ("source_repo", "string"),
                ("target_repo", "string"),
                ("target_branch", "string"),
            ],
            &[
                ("source_repo", "string"),
                ("target_repo", "string"),
                ("target_branch", "string"),
                ("output_dir", "string"),
            ],
        ),
        node_definition(
            "gittributary/notes/build-html@v1",
            "构建笔记 HTML",
            "build",
            "把笔记内容构建成 HTML 产物",
            "调用笔记系统构建能力,将源仓库中的 Markdown 或笔记数据输出为可发布的 HTML 目录。",
            &[("repo", "string"), ("output", "string")],
            &[("html_dir", "string")],
        ),
        node_definition(
            "gittributary/files/assert-exists@v1",
            "校验文件存在",
            "validate",
            "检查目标路径是否存在并可选校验非空",
            "用于在写入、提交或推送前确认构建产物存在,避免把空目录或错误产物发布出去。",
            &[("path", "string"), ("non_empty", "boolean")],
            &[("path", "string")],
        ),
        node_definition(
            "gittributary/files/sync-dir@v1",
            "同步目录",
            "sync",
            "把一个目录同步到另一个目录",
            "用于将构建产物复制到目标仓库工作区,后续可扩展为增量同步、删除孤儿文件和冲突报告。",
            &[("from", "string"), ("to", "string")],
            &[("changed_count", "number")],
        ),
        node_definition(
            "gittributary/git/commit-all@v1",
            "提交全部变更",
            "git",
            "暂存并提交指定仓库的全部变更",
            "用于在目标仓库中生成一次提交。没有变更时应返回可解释结果,由 Runner 决定 skipped 或 failed。",
            &[("repo", "string"), ("message", "string")],
            &[("commit", "string"), ("branch", "string")],
        ),
        node_definition(
            "gittributary/git/push@v1",
            "推送分支",
            "git",
            "把指定仓库分支推送到远程",
            "用于将本地提交推送到远程仓库。该节点通常是发布类 Flow 的最后高风险动作。",
            &[("repo", "string"), ("remote", "string"), ("branch", "string")],
            &[("remote", "string"), ("branch", "string")],
        ),
        node_definition(
            "gittributary/store/sync-now@v1",
            "同步数据中心",
            "sync",
            "立即同步公共数据中心配置",
            "调用数据中心同步能力,将 public 配置与已绑定的配置数据库进行一次双向同步。",
            &[],
            &[("message", "string")],
        ),
        node_definition(
            "gittributary/ui/notify@v1",
            "发送通知",
            "notify",
            "向用户展示 Flow 运行结果",
            "用于在 Flow 完成或失败后给出可见反馈。P0 可以先记录到运行日志,P1 再接系统通知。",
            &[("title", "string"), ("message", "string")],
            &[],
        ),
    ]
}

fn node_definition(
    uses: &str,
    name: &str,
    node_type: &str,
    summary: &str,
    description: &str,
    inputs_schema: &[(&str, &str)],
    outputs_schema: &[(&str, &str)],
) -> FlowNodeDefinition {
    FlowNodeDefinition {
        uses: uses.to_string(),
        name: name.to_string(),
        node_type: node_type.to_string(),
        summary: summary.to_string(),
        description: description.to_string(),
        inputs_schema: inputs_schema
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect(),
        outputs_schema: outputs_schema
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect(),
    }
}
