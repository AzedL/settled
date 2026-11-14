use serde::de::{self, Deserializer, Visitor};
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

/// Normalizes Unix timestamp integers into canonical seconds (dividing millisecond inputs by 1000).
fn normalize_unix_seconds(value: i64) -> i64 {
    if value.abs() >= 100_000_000_000 {
        value / 1000
    } else {
        value
    }
}

/// Converts civil Gregorian date (YYYY-MM-DD) to days since 1970-01-01.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let shifted_month = month as i64 + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted_month + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Parses an ISO-8601 / RFC3339 timestamp string (`YYYY-MM-DD[THH:MM:SS[.fff][Z|+HH:MM|-HH:MM]]`)
/// into Unix timestamp seconds for backwards compatibility with legacy `meta.json` files.
fn parse_iso8601_to_unix(input: &str) -> Option<i64> {
    let trimmed = input.trim();
    let (date_part, rest) = trimmed.split_once(['T', 't', ' '])?;
    let mut date_segs = date_part.split('-');
    let year: i64 = date_segs.next()?.parse().ok()?;
    let month: u32 = date_segs.next()?.parse().ok()?;
    let day: u32 = date_segs.next()?.parse().ok()?;
    if date_segs.next().is_some()
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
    {
        return None;
    }

    let (time_part, tz_offset_secs) = if let Some(stripped) = rest.strip_suffix(['Z', 'z']) {
        (stripped, 0i64)
    } else if let Some(tz_pos) = rest.rfind(['+', '-']) {
        let (t, tz) = rest.split_at(tz_pos);
        let sign = if tz.starts_with('-') { -1i64 } else { 1i64 };
        let tz_digits = &tz[1..];
        let (tz_h, tz_m) = if let Some((h, m)) = tz_digits.split_once(':') {
            (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?)
        } else if tz_digits.len() == 4 {
            (
                tz_digits[..2].parse::<i64>().ok()?,
                tz_digits[2..].parse::<i64>().ok()?,
            )
        } else {
            return None;
        };
        if !(0..=23).contains(&tz_h) || !(0..=59).contains(&tz_m) {
            return None;
        }
        (t, sign * (tz_h * 3600 + tz_m * 60))
    } else {
        (rest, 0i64)
    };

    let time_no_frac = time_part.split('.').next().unwrap_or(time_part);
    let mut time_segs = time_no_frac.split(':');
    let hour: i64 = time_segs.next()?.parse().ok()?;
    let minute: i64 = time_segs.next()?.parse().ok()?;
    let second: i64 = time_segs.next().unwrap_or("0").parse().ok()?;
    if time_segs.next().is_some()
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - tz_offset_secs)
}

fn deserialize_optional_unix_timestamp<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    struct TimestampVisitor;

    impl<'de> Visitor<'de> for TimestampVisitor {
        type Value = Option<i64>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a Unix timestamp integer, numeric string, ISO-8601 string, or null")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
            Ok(Some(normalize_unix_seconds(value)))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            let signed = i64::try_from(value)
                .map_err(|_| de::Error::custom("createAt timestamp overflows i64"))?;
            Ok(Some(normalize_unix_seconds(signed)))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if let Ok(parsed) = trimmed.parse::<i64>() {
                return Ok(Some(normalize_unix_seconds(parsed)));
            }
            if let Some(ts) = parse_iso8601_to_unix(trimmed) {
                return Ok(Some(ts));
            }
            Err(de::Error::custom(format!(
                "invalid createAt timestamp '{trimmed}' (expected Unix seconds integer)"
            )))
        }
    }

    deserializer.deserialize_any(TimestampVisitor)
}

/// Raw `meta.json` manifest stored inside `<workspace>/items/<item-id>/meta.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemMetaRaw {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_unix_timestamp")]
    pub create_at: Option<i64>,
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
    pub description: Option<String>,
    pub create_at: Option<i64>,
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
