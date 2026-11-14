use crate::model::{CommandResult, Platform, WorkspaceItem};

/// Formats an item's metadata, documentation, and optional check/script outputs into
/// a structured Markdown prompt bundle suitable for external AI coding agents.
pub fn format_item_context(
    item: &WorkspaceItem,
    results: Option<&[CommandResult]>,
    host: Platform,
) -> String {
    let mut out = String::new();

    out.push_str(&format!("# Settled Context: {} (`{}`)\n\n", item.name, item.id));
    out.push_str(&format!("- **Host Platform**: `{}`\n", host.as_str()));
    out.push_str(&format!("- **Item Directory**: `{}`\n", item.path));
    if !item.description.is_empty() {
        out.push_str(&format!("- **Description**: {}\n", item.description));
    }
    if !item.tags.is_empty() {
        out.push_str(&format!("- **Tags**: {}\n", item.tags.join(", ")));
    }
    if !item.platforms.is_empty() {
        let plats: Vec<&str> = item.platforms.iter().map(Platform::as_str).collect();
        out.push_str(&format!("- **Target Platforms**: {}\n", plats.join(", ")));
    } else {
        out.push_str("- **Target Platforms**: all\n");
    }

    if let Some(err) = &item.parse_error {
        out.push_str(&format!("\n> **meta.json Parse Error**: `{err}`\n"));
    }

    if let Some(results) = results {
        if !results.is_empty() {
            out.push_str("\n## Recent Command Results\n\n");
            for res in results {
                let code_str = res
                    .exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "none".to_string());
                out.push_str(&format!(
                    "### [{}] `{}` ({}) — exit: {}, {}ms\n",
                    format_status(res.status),
                    res.command_name,
                    res.group_key,
                    code_str,
                    res.duration_ms
                ));
                out.push_str(&format!("Command: `{}`\n\n", res.resolved_run));
                if let Some(err) = &res.error {
                    out.push_str(&format!("Runner error: `{err}`\n\n"));
                }
                if !res.logs.is_empty() {
                    out.push_str("```text\n");
                    for line in &res.logs {
                        out.push_str(&line.text);
                        out.push('\n');
                    }
                    out.push_str("```\n\n");
                }
            }
        }
    }

    if !item.readme.trim().is_empty() {
        out.push_str("\n## Item Documentation (`readme.md`)\n\n");
        out.push_str(item.readme.trim());
        out.push('\n');
    }

    if !item.raw_meta.trim().is_empty() {
        out.push_str("\n## Raw `meta.json`\n\n```json\n");
        out.push_str(item.raw_meta.trim());
        out.push_str("\n```\n");
    }

    out
}

fn format_status(status: crate::model::RunStatus) -> &'static str {
    match status {
        crate::model::RunStatus::Idle => "IDLE",
        crate::model::RunStatus::Running => "RUNNING",
        crate::model::RunStatus::Pass => "PASS",
        crate::model::RunStatus::Fail => "FAIL",
        crate::model::RunStatus::Canceled => "CANCELED",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{LogStream, OutputLine, RunStatus};

    #[test]
    fn builds_structured_markdown_context_with_logs() {
        let item = WorkspaceItem {
            id: "git-core".to_string(),
            path: "/tmp/ws/items/git-core".to_string(),
            meta_path: "/tmp/ws/items/git-core/meta.json".to_string(),
            readme_path: Some("/tmp/ws/items/git-core/readme.md".to_string()),
            readme: "Check user.name and email.".to_string(),
            raw_meta: "{\"name\":\"Git Core\"}".to_string(),
            name: "Git Core".to_string(),
            description: "Git identity check".to_string(),
            create_at: Some(1794596400),
            tags: vec!["git".to_string()],
            platforms: vec![Platform::Windows, Platform::Macos],
            applicable: true,
            script_groups: Vec::new(),
            parse_error: None,
        };
        let results = vec![CommandResult {
            run_id: "r1".to_string(),
            command_id: "git-core::check::0".to_string(),
            item_id: "git-core".to_string(),
            group_key: "check".to_string(),
            command_index: 0,
            command_name: "Check git user".to_string(),
            resolved_run: "git config user.name".to_string(),
            status: RunStatus::Fail,
            exit_code: Some(1),
            duration_ms: 42,
            logs: vec![OutputLine {
                stream: LogStream::Stderr,
                text: "not set".to_string(),
            }],
            error: None,
        }];

        let md = format_item_context(&item, Some(&results), Platform::Windows);
        assert!(md.contains("Git Core (`git-core`)"));
        assert!(md.contains("[FAIL] `Check git user` (check)"));
        assert!(md.contains("not set"));
        assert!(md.contains("Check user.name and email."));
    }
}
