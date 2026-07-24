use super::EventDefinition;

pub(super) fn builtin_event_definitions() -> Vec<EventDefinition> {
    vec![
        event_definition(
            "app.started",
            "noteaura://app",
            "app",
            event_copy(
                "应用启动",
                "应用启动完成",
                "Note Aura 启动并完成基础状态初始化后触发,适合驱动初始化检查、恢复任务或启动通知类 Flow。",
            ),
            &[],
            &[("started_at", "string")],
        ),
        event_definition(
            "workflow_dispatch",
            "noteaura://ui",
            "ui",
            event_copy(
                "手动触发",
                "用户手动触发 Flow",
                "用户在界面或命令面板主动运行某个 Flow 时触发,通常携带用户填写的 inputs。",
            ),
            &["inputs"],
            &[("inputs", "object")],
        ),
        event_definition(
            "git.repo.opened",
            "noteaura://na-git",
            "git",
            event_copy(
                "仓库已打开",
                "Git 仓库打开成功",
                "用户打开或切换到一个 Git 仓库且仓库概况读取成功后触发,适合驱动仓库级初始化、状态检查或自动扫描。",
            ),
            &["repositories"],
            &[("repo", "string"), ("branch", "string")],
        ),
        event_definition(
            "git.commit.created",
            "noteaura://na-git",
            "git",
            event_copy(
                "提交已创建",
                "Git 仓库创建了新的提交",
                "通过 Note Aura 创建 commit 成功后触发,包含仓库、分支和提交 SHA,适合触发推送、生成记录或后续质量检查。",
            ),
            &["repositories", "branches"],
            &[("repo", "string"), ("branch", "string"), ("commit", "string")],
        ),
        event_definition(
            "git.push.completed",
            "noteaura://na-git",
            "git",
            event_copy(
                "推送已完成",
                "Git 推送完成",
                "通过 Note Aura push 成功后触发,包含仓库、分支和 remote,适合触发同步后的通知、发布后检查或远端状态刷新。",
            ),
            &["repositories", "branches"],
            &[("repo", "string"), ("branch", "string"), ("remote", "string")],
        ),
        event_definition(
            "store.key.changed",
            // Protocol identifier kept stable although the crate moved into na-data.
            "noteaura://na-store",
            "store",
            event_copy(
                "配置已变更",
                "数据中心 key 写入成功",
                "公共数据中心 key 被 set 或 delete 成功后触发,不包含 private/secrets 命名空间,适合驱动设置联动和配置刷新。",
            ),
            &["namespace", "keys"],
            &[
                ("namespace", "string"),
                ("key", "string"),
                ("operation", "string"),
            ],
        ),
        event_definition(
            "flow.run.succeeded",
            "noteaura://na-flow",
            "flow",
            event_copy(
                "Flow 成功",
                "Flow 运行成功",
                "后续 Runner 完成某个 Flow 且结果为成功时触发,适合串联下游 Flow 或展示成功通知。",
            ),
            &["flow_id"],
            &[("flow_id", "string"), ("run_id", "string")],
        ),
        event_definition(
            "flow.run.failed",
            "noteaura://na-flow",
            "flow",
            event_copy(
                "Flow 失败",
                "Flow 运行失败",
                "后续 Runner 完成某个 Flow 且结果为失败时触发,适合触发告警、回滚提示或失败恢复 Flow。",
            ),
            &["flow_id"],
            &[("flow_id", "string"), ("run_id", "string")],
        ),
        event_definition(
            "flow.run.skipped",
            "noteaura://na-flow",
            "flow",
            event_copy(
                "Flow 跳过",
                "Flow 运行被跳过",
                "Runner 判断某个 Flow 当前不应执行时触发,例如 Flow 已停用、并发策略跳过或条件不满足。",
            ),
            &["flow_id"],
            &[("flow_id", "string"), ("run_id", "string")],
        ),
        event_definition(
            "flow.run.journal_failed",
            "noteaura://na-flow",
            "flow",
            event_copy(
                "Flow 审计日志写入失败",
                "Flow 已完成，但运行终态未能持久化",
                "Flow 的业务动作已经结束，但 RunJournal 终态写入失败时触发；消费者不得自动重试该 Flow。",
            ),
            &["flow_id"],
            &[
                ("flow_id", "string"),
                ("run_id", "string"),
                ("status", "string"),
            ],
        ),
        event_definition(
            "flow.run.result_persistence_failed",
            "noteaura://na-flow",
            "flow",
            event_copy(
                "Flow 结果投影写入失败",
                "Flow 已完成，但安全运行结果未能持久化",
                "Flow 的业务动作已经结束，但安全结果投影写入失败时触发；消费者不得自动重试该 Flow。",
            ),
            &["flow_id"],
            &[
                ("flow_id", "string"),
                ("run_id", "string"),
                ("status", "string"),
            ],
        ),
    ]
}

struct EventCopy<'a> {
    summary: &'a str,
    description: &'a str,
    trigger_description: &'a str,
}

fn event_copy<'a>(
    summary: &'a str,
    description: &'a str,
    trigger_description: &'a str,
) -> EventCopy<'a> {
    EventCopy {
        summary,
        description,
        trigger_description,
    }
}

fn event_definition(
    event_type: &str,
    source: &str,
    domain: &str,
    copy: EventCopy<'_>,
    filters: &[&str],
    data_schema: &[(&str, &str)],
) -> EventDefinition {
    EventDefinition {
        event_type: event_type.to_string(),
        source: source.to_string(),
        domain: domain.to_string(),
        summary: copy.summary.to_string(),
        description: copy.description.to_string(),
        trigger_description: copy.trigger_description.to_string(),
        stability: "stable".to_string(),
        filters: filters.iter().map(|item| (*item).to_string()).collect(),
        data_schema: data_schema
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect(),
    }
}
