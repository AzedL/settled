use crate::model::{Platform, WorkspaceItem};

/// Formats a concise locator context bundle identifying a Settled item for external AI coding agents.
pub fn format_item_context(
    item: &WorkspaceItem,
    workspace_root: &str,
    host: Platform,
) -> String {
    let mut out = String::new();
    let title = if item.name.trim().is_empty() {
        item.id.as_str()
    } else {
        item.name.trim()
    };

    out.push_str(&format!("# Settled Item: {} (`{}`)\n\n", title, item.id));
    if !workspace_root.trim().is_empty() {
        out.push_str(&format!("- **Workspace**: `{}`\n", workspace_root.trim()));
    }
    out.push_str(&format!("- **Item Directory**: `{}`\n", item.path));
    out.push_str(&format!("- **Host Platform**: `{}`\n", host.as_str()));

    if !item.platforms.is_empty() {
        let plats: Vec<&str> = item.platforms.iter().map(Platform::as_str).collect();
        out.push_str(&format!("- **Target Platforms**: {}\n", plats.join(", ")));
    } else {
        out.push_str("- **Target Platforms**: all\n");
    }

    if !item.applicable {
        out.push_str("- **Applicable on Host**: false\n");
    }

    if let Some(desc) = &item.description
        && !desc.trim().is_empty()
    {
        out.push_str(&format!("- **Description**: {}\n", desc.trim()));
    }

    if !item.tags.is_empty() {
        out.push_str(&format!("- **Tags**: {}\n", item.tags.join(", ")));
    }

    if !item.script_groups.is_empty() {
        let groups: Vec<String> = item
            .script_groups
            .iter()
            .map(|group| format!("`{}`", group.key))
            .collect();
        out.push_str(&format!("- **Scripts**: {}\n", groups.join(", ")));
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ResolvedCommand, ScriptGroup, ScriptRole};

    fn make_command(index: usize, key: &str) -> ResolvedCommand {
        ResolvedCommand {
            index,
            key: key.to_string(),
            command_id: format!("item::{key}::{index}"),
            name: format!("Step {index}"),
            description: None,
            raw_run: "echo step".to_string(),
            resolved_run: "echo step".to_string(),
            platforms: Vec::new(),
            applicable: true,
            shell: None,
            effective_shell: "bash".to_string(),
            encoding: "utf-8".to_string(),
        }
    }

    #[test]
    fn builds_concise_locator_context_without_dumping_files_or_logs() {
        let item = WorkspaceItem {
            id: "git-core".to_string(),
            path: "/tmp/ws/settled-items/git-core".to_string(),
            meta_path: "/tmp/ws/settled-items/git-core/meta.json".to_string(),
            readme_path: Some("/tmp/ws/settled-items/git-core/README.md".to_string()),
            readme: "Check user.name and email.".to_string(),
            raw_meta: "{\"name\":\"Git Core\"}".to_string(),
            name: "Git Core".to_string(),
            description: Some("Git identity check".to_string()),
            create_at: Some(1794596400),
            tags: vec!["git".to_string(), "init".to_string()],
            platforms: vec![Platform::Windows, Platform::Macos],
            applicable: true,
            script_groups: vec![
                ScriptGroup {
                    key: "check".to_string(),
                    role: ScriptRole::Check,
                    commands: vec![make_command(0, "check")],
                },
                ScriptGroup {
                    key: "fix".to_string(),
                    role: ScriptRole::Fix,
                    commands: vec![make_command(0, "fix")],
                },
            ],
        };

        let md = format_item_context(&item, "/tmp/ws", Platform::Windows);
        assert!(md.contains("# Settled Item: Git Core (`git-core`)"));
        assert!(md.contains("- **Workspace**: `/tmp/ws`"));
        assert!(md.contains("- **Item Directory**: `/tmp/ws/settled-items/git-core`"));
        assert!(md.contains("- **Host Platform**: `windows`"));
        assert!(md.contains("- **Target Platforms**: windows, macos"));
        assert!(md.contains("- **Description**: Git identity check"));
        assert!(md.contains("- **Tags**: git, init"));
        assert!(md.contains("- **Scripts**: `check`, `fix`"));
        assert!(!md.contains("**Applicable on Host**"));
        assert!(!md.contains("Check user.name and email."));
        assert!(!md.contains("{\"name\":\"Git Core\"}"));
        assert!(!md.contains("echo step"));
    }

    #[test]
    fn omits_empty_optional_fields_and_flags_non_applicable_items() {
        let item = WorkspaceItem {
            id: "minimal".to_string(),
            path: "/tmp/ws/settled-items/minimal".to_string(),
            meta_path: "/tmp/ws/settled-items/minimal/meta.json".to_string(),
            readme_path: None,
            readme: String::new(),
            raw_meta: "{\"name\":\"\"}".to_string(),
            name: "   ".to_string(),
            description: Some("  ".to_string()),
            create_at: None,
            tags: Vec::new(),
            platforms: Vec::new(),
            applicable: false,
            script_groups: Vec::new(),
        };

        let md = format_item_context(&item, "", Platform::Linux);
        assert!(md.contains("# Settled Item: minimal (`minimal`)"));
        assert!(!md.contains("**Workspace**"));
        assert!(md.contains("- **Host Platform**: `linux`"));
        assert!(md.contains("- **Target Platforms**: all"));
        assert!(md.contains("- **Applicable on Host**: false"));
        assert!(!md.contains("**Description**"));
        assert!(!md.contains("**Tags**"));
        assert!(!md.contains("**Scripts**"));
    }
}
