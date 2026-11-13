use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use thiserror::Error;

/// Canonical platform identifier enforced across `meta.json` and runtime execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

impl Platform {
    /// Returns the canonical platform identifier for the current host OS.
    pub fn current() -> Self {
        match std::env::consts::OS {
            "windows" => Self::Windows,
            "macos" => Self::Macos,
            _ => Self::Linux,
        }
    }

    /// Returns the canonical lowercase platform string.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Macos => "macos",
            Self::Linux => "linux",
        }
    }
}

impl fmt::Display for Platform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Functional role of a script group registered under `meta.json.scripts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScriptRole {
    Check,
    Fix,
    Custom,
}

impl ScriptRole {
    /// Derives the role from the script key in `meta.json`.
    pub fn from_key(key: &str) -> Self {
        match key {
            "check" => Self::Check,
            "fix" => Self::Fix,
            _ => Self::Custom,
        }
    }
}

/// Execution state for an individual command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Idle,
    Running,
    Pass,
    Fail,
    Canceled,
}

/// Stream source for streamed or recorded command output lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
    System,
}

/// A single output line captured from a running command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputLine {
    pub stream: LogStream,
    pub text: String,
}

/// Raw step object inside `meta.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub run: String,
    pub platforms: Option<Vec<Platform>>,
    pub shell: Option<String>,
    pub encoding: Option<String>,
}

/// Single command specification (`string | Step`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum CommandInput {
    Shorthand(String),
    Step(StepInput),
}

/// Script group specification (`string | Step | (string | Step)[]`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ScriptInput {
    One(CommandInput),
    Many(Vec<CommandInput>),
}

impl ScriptInput {
    /// Normalizes single or array command definitions into a flat list.
    pub fn into_commands(self) -> Vec<CommandInput> {
        match self {
            Self::One(cmd) => vec![cmd],
            Self::Many(cmds) => cmds,
        }
    }
}

/// Raw `meta.json` manifest stored inside `<workspace>/items/<item-id>/meta.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemMetaRaw {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub create_at: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub platforms: Vec<Platform>,
    #[serde(default)]
    pub scripts: BTreeMap<String, ScriptInput>,
}

/// Normalized, runtime-ready command entry derived from `meta.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCommand {
    pub index: usize,
    pub key: String,
    pub command_id: String,
    pub name: String,
    pub description: Option<String>,
    pub raw_run: String,
    pub resolved_run: String,
    pub platforms: Vec<Platform>,
    pub applicable: bool,
    pub shell: Option<String>,
    pub effective_shell: String,
    pub encoding: String,
}

/// Ordered script group (`check`, `fix`, or custom key) on an item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptGroup {
    pub key: String,
    pub role: ScriptRole,
    pub commands: Vec<ResolvedCommand>,
}

/// Loaded item directory from `<workspace>/items/<id>/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub id: String,
    pub path: String,
    pub meta_path: String,
    pub readme_path: Option<String>,
    pub readme: String,
    pub raw_meta: String,
    pub name: String,
    pub description: String,
    pub create_at: String,
    pub tags: Vec<String>,
    pub platforms: Vec<Platform>,
    pub applicable: bool,
    pub script_groups: Vec<ScriptGroup>,
    pub parse_error: Option<String>,
}

/// Complete snapshot of a scanned Settled workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub root_path: String,
    pub items_dir: String,
    pub items_dir_exists: bool,
    pub host_platform: Platform,
    pub default_shell: String,
    pub items: Vec<WorkspaceItem>,
    pub all_tags: Vec<String>,
    pub scan_warnings: Vec<String>,
}

/// Target descriptor required to execute a single resolved command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionTarget {
    pub item_id: String,
    pub item_dir: String,
    pub group_key: String,
    pub command_index: usize,
    pub command_id: String,
    pub command_name: String,
    pub resolved_run: String,
    pub shell: String,
    pub encoding: String,
}

impl CommandExecutionTarget {
    /// Builds an execution target from an item and one of its resolved commands.
    pub fn from_resolved(item: &WorkspaceItem, cmd: &ResolvedCommand) -> Self {
        Self {
            item_id: item.id.clone(),
            item_dir: item.path.clone(),
            group_key: cmd.key.clone(),
            command_index: cmd.index,
            command_id: cmd.command_id.clone(),
            command_name: cmd.name.clone(),
            resolved_run: cmd.resolved_run.clone(),
            shell: cmd.effective_shell.clone(),
            encoding: cmd.encoding.clone(),
        }
    }
}

/// Streaming lifecycle events emitted while commands execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        run_id: String,
        command_id: String,
        item_id: String,
        group_key: String,
        command_index: usize,
    },
    #[serde(rename_all = "camelCase")]
    Output {
        run_id: String,
        command_id: String,
        stream: LogStream,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Finished {
        run_id: String,
        command_id: String,
        item_id: String,
        group_key: String,
        command_index: usize,
        status: RunStatus,
        exit_code: Option<i32>,
        duration_ms: u64,
        error: Option<String>,
    },
}

/// Final aggregated execution outcome for a single command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub run_id: String,
    pub command_id: String,
    pub item_id: String,
    pub group_key: String,
    pub command_index: usize,
    pub command_name: String,
    pub resolved_run: String,
    pub status: RunStatus,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub logs: Vec<OutputLine>,
    pub error: Option<String>,
}

/// Errors produced by `settled-core`.
#[derive(Debug, Error)]
pub enum SettledError {
    #[error("Workspace path does not exist or is not a directory: {0}")]
    InvalidWorkspace(String),
    #[error("Item '{0}' was not found in workspace")]
    ItemNotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
