use serde::{Deserialize, Serialize};
use settled_core::{APP_DATA_DIR_NAME, canonicalize_if_possible, paths_equal};
use std::fs;
use std::path::{Path, PathBuf};

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
const MANAGED_CLI_MANIFEST_NAME: &str = "managed-cli.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliPathStatus {
    Ready,
    NotInPath,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NeedsApplicationsMove,
    #[cfg_attr(windows, allow(dead_code))]
    Conflict,
    Shadowed,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRegistrationInfo {
    pub status: CliPathStatus,
    pub bundled_path: Option<String>,
    pub conflict_path: Option<String>,
    pub manual_command: Option<String>,
}

impl CliRegistrationInfo {
    pub fn unavailable() -> Self {
        Self {
            status: CliPathStatus::Unavailable,
            bundled_path: None,
            conflict_path: None,
            manual_command: None,
        }
    }

    fn ready(bundled: &Path) -> Self {
        Self {
            status: CliPathStatus::Ready,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            conflict_path: None,
            manual_command: None,
        }
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn conflict(bundled: &Path, conflict_path: &Path) -> Self {
        Self {
            status: CliPathStatus::Conflict,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            conflict_path: Some(conflict_path.to_string_lossy().into_owned()),
            manual_command: None,
        }
    }

    fn shadowed(bundled: &Path, active_path: &Path) -> Self {
        Self {
            status: CliPathStatus::Shadowed,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            conflict_path: Some(active_path.to_string_lossy().into_owned()),
            manual_command: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PathHit {
    MatchesBundled,
    ShadowedBy(PathBuf),
    NotFound,
}

#[cfg(unix)]
#[derive(Debug, PartialEq, Eq)]
enum SymlinkAttempt {
    Linked,
    NeedsElevation,
    Conflict(PathBuf),
    Failed(String),
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedCliManifest {
    target_path: String,
    content_hash: String,
    version: String,
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
enum ManagedTargetState {
    Absent,
    UpToDate,
    ManagedUpdatable,
    Conflict(PathBuf),
}

fn cli_binary_filename() -> &'static str {
    if cfg!(windows) {
        "settled.exe"
    } else {
        "settled"
    }
}

fn find_bundled_cli() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let current_exe = std::env::current_exe().ok()?;
    let candidate = current_exe.parent()?.join(cli_binary_filename());
    candidate.is_file().then_some(candidate)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_ephemeral_macos_location(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    raw.starts_with("/Volumes/") || raw.contains("/AppTranslocation/")
}

#[cfg_attr(windows, allow(dead_code))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn same_canonical_path(a: &Path, b: &Path) -> bool {
    let a_canon = canonicalize_if_possible(a);
    let b_canon = canonicalize_if_possible(b);
    paths_equal(&a_canon.to_string_lossy(), &b_canon.to_string_lossy())
}

fn resolve_first_settled_in_dirs<F>(
    dirs: &[PathBuf],
    candidate_names: &[&str],
    is_bundled_match: F,
) -> PathHit
where
    F: Fn(&Path) -> bool,
{
    for dir in dirs {
        for name in candidate_names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                if is_bundled_match(&candidate) {
                    return PathHit::MatchesBundled;
                }
                return PathHit::ShadowedBy(candidate);
            }
        }
    }
    PathHit::NotFound
}

#[cfg(unix)]
fn is_replaceable_settled_symlink(link_path: &Path, bundled: &Path) -> bool {
    if same_canonical_path(link_path, bundled) {
        return true;
    }
    // Dangling symlink (e.g., previous Settled.app was moved or deleted) is safe to repair.
    if !link_path.exists() {
        return true;
    }
    // Live symlink pointing to an older Settled app bundle is safe to update;
    // live symlinks to unrelated tools (e.g., Homebrew or custom scripts) are treated as conflicts.
    fs::read_link(link_path)
        .ok()
        .map(|target| target.to_string_lossy().into_owned())
        .is_some_and(|raw| raw.contains(".app/Contents/MacOS/settled"))
}

#[cfg(unix)]
fn try_direct_symlink_classified(bundled: &Path, link_path: &Path) -> SymlinkAttempt {
    let Some(parent) = link_path.parent() else {
        return SymlinkAttempt::Failed("Missing parent directory for link".to_string());
    };

    let mut had_replaceable_symlink = false;
    match fs::symlink_metadata(link_path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            if same_canonical_path(link_path, bundled) {
                return SymlinkAttempt::Linked;
            }
            if !is_replaceable_settled_symlink(link_path, bundled) {
                return SymlinkAttempt::Conflict(link_path.to_path_buf());
            }
            had_replaceable_symlink = true;
        }
        Ok(_) => {
            return SymlinkAttempt::Conflict(link_path.to_path_buf());
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return SymlinkAttempt::NeedsElevation;
        }
        Err(err) => return SymlinkAttempt::Failed(err.to_string()),
    }

    if !parent.is_dir() {
        return SymlinkAttempt::NeedsElevation;
    }

    if had_replaceable_symlink && let Err(err) = fs::remove_file(link_path) {
        return if err.kind() == std::io::ErrorKind::PermissionDenied {
            SymlinkAttempt::NeedsElevation
        } else {
            SymlinkAttempt::Failed(err.to_string())
        };
    }

    match std::os::unix::fs::symlink(bundled, link_path) {
        Ok(()) => SymlinkAttempt::Linked,
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            SymlinkAttempt::NeedsElevation
        }
        Err(err) => SymlinkAttempt::Failed(err.to_string()),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn normalize_windows_path(s: &str) -> String {
    let mut win = s.trim().replace('/', "\\");
    while win.len() > 3 && win.ends_with('\\') {
        win.pop();
    }
    win.to_ascii_lowercase()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn windows_paths_equal(a: &str, b: &str) -> bool {
    normalize_windows_path(a) == normalize_windows_path(b)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn split_path_entries(raw: &str, sep: char) -> Vec<String> {
    raw.split(sep)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
fn windows_path_contains_dir(raw: &str, dir: &str) -> bool {
    split_path_entries(raw, ';')
        .iter()
        .any(|entry| windows_paths_equal(entry, dir))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn append_windows_path_entry(raw: &str, dir: &str) -> Option<String> {
    let mut entries = split_path_entries(raw, ';');
    if entries.iter().any(|entry| windows_paths_equal(entry, dir)) {
        return None;
    }
    entries.push(dir.to_string());
    Some(entries.join(";"))
}

#[cfg(windows)]
fn decode_windows_reg_string(bytes: &[u8]) -> String {
    let u16s: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&chunk| u16::from_le_bytes(chunk))
        .take_while(|&code| code != 0)
        .collect();
    String::from_utf16_lossy(&u16s)
}

#[cfg(windows)]
fn expand_windows_env_vars(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%'
            && let Some(end_rel) = chars[i + 1..].iter().position(|&c| c == '%')
            && end_rel > 0
        {
            let var_name: String = chars[i + 1..i + 1 + end_rel].iter().collect();
            if let Ok(val) = std::env::var(&var_name) {
                out.push_str(&val);
                i += end_rel + 2;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(windows)]
fn read_windows_registry_path(root: winreg::HKEY, subkey: &str) -> Option<String> {
    use winreg::RegKey;

    let key = RegKey::predef(root).open_subkey(subkey).ok()?;
    let val = key.get_raw_value("Path").ok()?;
    Some(decode_windows_reg_string(&val.bytes))
}

#[cfg(windows)]
fn effective_windows_path_dirs() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let sys_raw = read_windows_registry_path(
        HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    );
    let user_raw = read_windows_registry_path(HKEY_CURRENT_USER, "Environment");

    let mut dirs = Vec::new();
    for raw in [sys_raw, user_raw].into_iter().flatten() {
        for entry in split_path_entries(&raw, ';') {
            let expanded = expand_windows_env_vars(&entry);
            if !expanded.trim().is_empty() {
                dirs.push(PathBuf::from(expanded));
            }
        }
    }

    if dirs.is_empty()
        && let Some(path_var) = std::env::var_os("PATH")
    {
        dirs.extend(std::env::split_paths(&path_var));
    }

    dirs
}

#[cfg(windows)]
fn add_dir_to_windows_user_path(dir: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, RegType};
    use winreg::{RegKey, RegValue};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = hkcu
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(|e| format!("Failed to open HKCU\\Environment: {e}"))?;

    let current = env
        .get_raw_value("Path")
        .ok()
        .map(|val| decode_windows_reg_string(&val.bytes))
        .unwrap_or_default();

    let Some(updated) = append_windows_path_entry(&current, dir) else {
        return Ok(());
    };

    let mut encoded: Vec<u8> = updated
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    if encoded.len() < 2 {
        encoded = vec![0, 0];
    }
    env.set_raw_value(
        "Path",
        &RegValue {
            bytes: encoded.into(),
            vtype: RegType::REG_EXPAND_SZ,
        },
    )
    .map_err(|e| format!("Failed to update HKCU\\Environment\\Path: {e}"))?;

    // Broadcast WM_SETTINGCHANGE so Explorer and newly opened terminals see the updated PATH.
    let _ = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Add-Type -Namespace Settled -Name Native -MemberDefinition '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'; $r = [UIntPtr]::Zero; [void][Settled.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    Ok(())
}

#[cfg(target_os = "macos")]
fn effective_macos_path_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    let has_dir = |list: &[PathBuf], candidate: &Path| {
        list.iter()
            .any(|existing| same_canonical_path(existing, candidate))
    };

    // Finder-launched GUI apps often inherit a minimal PATH lacking Homebrew & /usr/local/bin.
    // Append standard directories in macOS login-shell precedence order so shadowing is detected.
    #[cfg(target_arch = "aarch64")]
    {
        let hb = Path::new("/opt/homebrew/bin");
        if hb.is_dir() && !has_dir(&dirs, hb) {
            dirs.push(hb.to_path_buf());
        }
    }
    let usr_local = Path::new("/usr/local/bin");
    if !has_dir(&dirs, usr_local) {
        dirs.push(usr_local.to_path_buf());
    }

    dirs
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn compute_file_fingerprint(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mut h1: u64 = 0xcbf2_9ce4_8422_2325;
    let mut h2: u64 = 0x8422_2325_cbf2_9ce4;
    for &b in &bytes {
        h1 ^= u64::from(b);
        h1 = h1.wrapping_mul(0x0100_0000_01b3);
        h2 = h2.wrapping_mul(0x0100_0000_01b3);
        h2 ^= u64::from(b);
    }
    Some(format!("{}:{h1:016x}{h2:016x}", bytes.len()))
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn parse_semver_tuple(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.trim().trim_start_matches('v').split('-').next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn version_ge(current: &str, recorded: &str) -> bool {
    match (parse_semver_tuple(current), parse_semver_tuple(recorded)) {
        (Some(cur), Some(rec)) => cur >= rec,
        _ => current == recorded,
    }
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn default_managed_manifest_path() -> Option<PathBuf> {
    Some(
        dirs::data_dir()?
            .join(APP_DATA_DIR_NAME)
            .join(MANAGED_CLI_MANIFEST_NAME),
    )
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn inspect_managed_copy_target(
    target: &Path,
    bundled: &Path,
    manifest_path: &Path,
    current_version: &str,
) -> ManagedTargetState {
    let meta = match fs::symlink_metadata(target) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return ManagedTargetState::Absent;
        }
        Err(_) => return ManagedTargetState::Conflict(target.to_path_buf()),
    };

    // Never follow or overwrite symlinks or directories when copying a managed CLI binary.
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return ManagedTargetState::Conflict(target.to_path_buf());
    }

    let Some(bundled_hash) = compute_file_fingerprint(bundled) else {
        return ManagedTargetState::Conflict(target.to_path_buf());
    };
    let Some(target_hash) = compute_file_fingerprint(target) else {
        return ManagedTargetState::Conflict(target.to_path_buf());
    };
    if bundled_hash == target_hash {
        return ManagedTargetState::UpToDate;
    }

    let manifest = fs::read_to_string(manifest_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ManagedCliManifest>(&raw).ok());
    if let Some(manifest) = manifest
        && paths_equal(
            &canonicalize_if_possible(Path::new(&manifest.target_path)).to_string_lossy(),
            &canonicalize_if_possible(target).to_string_lossy(),
        )
        && manifest.content_hash == target_hash
        && version_ge(current_version, &manifest.version)
    {
        return ManagedTargetState::ManagedUpdatable;
    }

    ManagedTargetState::Conflict(target.to_path_buf())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn install_managed_linux_copy(
    bundled: &Path,
    target: &Path,
    manifest_path: &Path,
    current_version: &str,
) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let Some(parent) = target.parent() else {
        return Err("Missing target directory".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create '{}': {e}", parent.display()))?;

    let tmp_path = parent.join(format!(".settled.{}.tmp", std::process::id()));
    let copy_result = (|| -> Result<(), String> {
        fs::copy(bundled, &tmp_path)
            .map_err(|e| format!("Failed to copy CLI binary to '{}': {e}", tmp_path.display()))?;
        let mut perms = fs::metadata(&tmp_path)
            .map_err(|e| format!("Failed to inspect '{}': {e}", tmp_path.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tmp_path, perms)
            .map_err(|e| format!("Failed to mark '{}' executable: {e}", tmp_path.display()))?;
        fs::rename(&tmp_path, target).map_err(|e| {
            format!(
                "Failed to install CLI binary to '{}': {e}",
                target.display()
            )
        })?;
        Ok(())
    })();

    if let Err(err) = copy_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }

    if let Some(hash) = compute_file_fingerprint(target) {
        if let Some(manifest_parent) = manifest_path.parent() {
            let _ = fs::create_dir_all(manifest_parent);
        }
        let manifest = ManagedCliManifest {
            target_path: canonicalize_if_possible(target)
                .to_string_lossy()
                .into_owned(),
            content_hash: hash,
            version: current_version.to_string(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&manifest) {
            let _ = fs::write(manifest_path, json);
        }
    }

    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn env_path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn env_path_contains_dir(dir: &Path) -> bool {
    env_path_dirs()
        .iter()
        .any(|entry| same_canonical_path(entry, dir))
}

/// Checks bundled CLI registration status on startup.
///
/// When a direct symlink (or AppImage copy into an absent/Settled-managed `~/.local/bin/settled`
/// already on `PATH`) can be performed silently without privilege elevation, file clobbering,
/// or shell-profile mutation, this completes it before returning so no banner flashes.
pub fn inspect_or_auto_register_cli() -> CliRegistrationInfo {
    let Some(bundled) = find_bundled_cli() else {
        return CliRegistrationInfo::unavailable();
    };
    inspect_for_bundled_cli(&bundled)
}

fn inspect_for_bundled_cli(bundled: &Path) -> CliRegistrationInfo {
    #[cfg(target_os = "macos")]
    {
        if is_ephemeral_macos_location(bundled) {
            return CliRegistrationInfo {
                status: CliPathStatus::NeedsApplicationsMove,
                bundled_path: Some(bundled.to_string_lossy().into_owned()),
                conflict_path: None,
                manual_command: None,
            };
        }

        let link_path = Path::new("/usr/local/bin/settled");
        let path_dirs = effective_macos_path_dirs();

        match resolve_first_settled_in_dirs(&path_dirs, &["settled"], |p| {
            same_canonical_path(p, bundled)
        }) {
            PathHit::MatchesBundled => return CliRegistrationInfo::ready(bundled),
            PathHit::ShadowedBy(active) => {
                if !same_canonical_path(&active, link_path) {
                    return CliRegistrationInfo::shadowed(bundled, &active);
                }
                // `active` IS `/usr/local/bin/settled` but points elsewhere.
                // Let `try_direct_symlink_classified` decide if it's a replaceable Settled symlink or a conflict.
            }
            PathHit::NotFound => {}
        }

        match try_direct_symlink_classified(bundled, link_path) {
            SymlinkAttempt::Linked => {
                match resolve_first_settled_in_dirs(&path_dirs, &["settled"], |p| {
                    same_canonical_path(p, bundled)
                }) {
                    PathHit::MatchesBundled => CliRegistrationInfo::ready(bundled),
                    PathHit::ShadowedBy(active) => CliRegistrationInfo::shadowed(bundled, &active),
                    PathHit::NotFound => CliRegistrationInfo::ready(bundled),
                }
            }
            SymlinkAttempt::Conflict(conflict_path) => {
                CliRegistrationInfo::conflict(bundled, &conflict_path)
            }
            SymlinkAttempt::NeedsElevation | SymlinkAttempt::Failed(_) => {
                let bundled_str = bundled.to_string_lossy().into_owned();
                let quoted = shell_single_quote(&bundled_str);
                CliRegistrationInfo {
                    status: CliPathStatus::NotInPath,
                    bundled_path: Some(bundled_str),
                    conflict_path: None,
                    manual_command: Some(format!(
                        "if [ ! -e /usr/local/bin/settled ] || [ -L /usr/local/bin/settled ]; then sudo mkdir -p /usr/local/bin && sudo ln -sfn {quoted} /usr/local/bin/settled; else echo 'Conflict: /usr/local/bin/settled already exists'; fi"
                    )),
                }
            }
        }
    }

    #[cfg(windows)]
    {
        let dirs = effective_windows_path_dirs();
        match resolve_first_settled_in_dirs(
            &dirs,
            &["settled.exe", "settled.cmd", "settled.bat"],
            |p| same_canonical_path(p, bundled),
        ) {
            PathHit::MatchesBundled => return CliRegistrationInfo::ready(bundled),
            PathHit::ShadowedBy(active) => return CliRegistrationInfo::shadowed(bundled, &active),
            PathHit::NotFound => {}
        }

        let bundled_dir = bundled
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let escaped_dir = bundled_dir.replace('\'', "''");
        CliRegistrationInfo {
            status: CliPathStatus::NotInPath,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            conflict_path: None,
            manual_command: Some(format!(
                "$p=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path', (($p -split ';' | ?{{$_}}) + '{escaped_dir}' | Select-Object -Unique) -join ';', 'User')"
            )),
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let current_version = env!("CARGO_PKG_VERSION");
        let path_dirs = env_path_dirs();
        let is_appimage = std::env::var_os("APPIMAGE").is_some();

        if is_appimage {
            let Some(home) = dirs::home_dir() else {
                return CliRegistrationInfo::unavailable();
            };
            let local_bin = home.join(".local").join("bin");
            let local_target = local_bin.join("settled");
            let Some(manifest_path) = default_managed_manifest_path() else {
                return CliRegistrationInfo::unavailable();
            };

            let target_state = inspect_managed_copy_target(
                &local_target,
                bundled,
                &manifest_path,
                current_version,
            );

            match resolve_first_settled_in_dirs(&path_dirs, &["settled"], |p| {
                same_canonical_path(p, bundled)
                    || (same_canonical_path(p, &local_target)
                        && target_state == ManagedTargetState::UpToDate)
            }) {
                PathHit::MatchesBundled => return CliRegistrationInfo::ready(bundled),
                PathHit::ShadowedBy(active) => {
                    if !same_canonical_path(&active, &local_target) {
                        return CliRegistrationInfo::shadowed(bundled, &active);
                    }
                }
                PathHit::NotFound => {}
            }

            let local_in_path = env_path_contains_dir(&local_bin);
            match target_state {
                ManagedTargetState::Conflict(conflict_path) => {
                    return CliRegistrationInfo::conflict(bundled, &conflict_path);
                }
                ManagedTargetState::UpToDate if local_in_path => {
                    return CliRegistrationInfo::ready(bundled);
                }
                ManagedTargetState::Absent | ManagedTargetState::ManagedUpdatable
                    if local_in_path =>
                {
                    if install_managed_linux_copy(
                        bundled,
                        &local_target,
                        &manifest_path,
                        current_version,
                    )
                    .is_ok()
                    {
                        return CliRegistrationInfo::ready(bundled);
                    }
                }
                _ => {}
            }

            let bundled_str = bundled.to_string_lossy().into_owned();
            return CliRegistrationInfo {
                status: CliPathStatus::NotInPath,
                bundled_path: Some(bundled_str.clone()),
                conflict_path: None,
                manual_command: Some(format!(
                    "mkdir -p \"$HOME/.local/bin\" && cp -n {} \"$HOME/.local/bin/settled\" && chmod +x \"$HOME/.local/bin/settled\"",
                    shell_single_quote(&bundled_str)
                )),
            };
        }

        let link_path = Path::new("/usr/local/bin/settled");
        match resolve_first_settled_in_dirs(&path_dirs, &["settled"], |p| {
            same_canonical_path(p, bundled)
        }) {
            PathHit::MatchesBundled => return CliRegistrationInfo::ready(bundled),
            PathHit::ShadowedBy(active) => {
                if !same_canonical_path(&active, link_path) {
                    return CliRegistrationInfo::shadowed(bundled, &active);
                }
            }
            PathHit::NotFound => {}
        }

        match try_direct_symlink_classified(bundled, link_path) {
            SymlinkAttempt::Linked => {
                match resolve_first_settled_in_dirs(&path_dirs, &["settled"], |p| {
                    same_canonical_path(p, bundled)
                }) {
                    PathHit::MatchesBundled => CliRegistrationInfo::ready(bundled),
                    PathHit::ShadowedBy(active) => CliRegistrationInfo::shadowed(bundled, &active),
                    PathHit::NotFound => CliRegistrationInfo::ready(bundled),
                }
            }
            SymlinkAttempt::Conflict(conflict_path) => {
                CliRegistrationInfo::conflict(bundled, &conflict_path)
            }
            SymlinkAttempt::NeedsElevation | SymlinkAttempt::Failed(_) => {
                let bundled_str = bundled.to_string_lossy().into_owned();
                let quoted = shell_single_quote(&bundled_str);
                CliRegistrationInfo {
                    status: CliPathStatus::NotInPath,
                    bundled_path: Some(bundled_str),
                    conflict_path: None,
                    manual_command: Some(format!(
                        "if [ ! -e /usr/local/bin/settled ] || [ -L /usr/local/bin/settled ]; then sudo mkdir -p /usr/local/bin && sudo ln -sfn {quoted} /usr/local/bin/settled; else echo 'Conflict: /usr/local/bin/settled already exists'; fi"
                    )),
                }
            }
        }
    }
}

/// Explicitly registers the bundled `settled` CLI on PATH after user action.
///
/// Refuses to overwrite existing non-symlink files (or unmanaged Linux copies),
/// surfacing `Conflict` instead of forcing replacement.
pub fn register_cli_in_path() -> Result<CliRegistrationInfo, String> {
    let Some(bundled) = find_bundled_cli() else {
        return Ok(CliRegistrationInfo::unavailable());
    };

    #[cfg(target_os = "macos")]
    {
        if is_ephemeral_macos_location(&bundled) {
            return Ok(CliRegistrationInfo {
                status: CliPathStatus::NeedsApplicationsMove,
                bundled_path: Some(bundled.to_string_lossy().into_owned()),
                conflict_path: None,
                manual_command: None,
            });
        }

        let link_path = Path::new("/usr/local/bin/settled");
        match try_direct_symlink_classified(&bundled, link_path) {
            SymlinkAttempt::Linked => return Ok(inspect_for_bundled_cli(&bundled)),
            SymlinkAttempt::Conflict(conflict_path) => {
                return Ok(CliRegistrationInfo::conflict(&bundled, &conflict_path));
            }
            SymlinkAttempt::Failed(err) => return Err(err),
            SymlinkAttempt::NeedsElevation => {}
        }

        let bundled_str = bundled.to_string_lossy().into_owned();
        // Guard inside the elevated script too so TOCTOU regular files are never overwritten.
        let shell_cmd = format!(
            "if [ -e /usr/local/bin/settled ] && [ ! -L /usr/local/bin/settled ]; then echo 'CONFLICT_REGULAR_FILE' >&2; exit 42; fi; mkdir -p /usr/local/bin && ln -sfn {} /usr/local/bin/settled",
            shell_single_quote(&bundled_str)
        );
        let applescript = format!(
            "do shell script \"{}\" with administrator privileges",
            escape_applescript_string(&shell_cmd)
        );
        let output = std::process::Command::new("osascript")
            .args(["-e", &applescript])
            .output()
            .map_err(|e| format!("Failed to invoke macOS authorization dialog: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("CONFLICT_REGULAR_FILE") {
                return Ok(CliRegistrationInfo::conflict(&bundled, link_path));
            }
            if stderr.contains("-128") || stderr.to_ascii_lowercase().contains("cancel") {
                return Ok(inspect_for_bundled_cli(&bundled));
            }
            return Err(format!(
                "Failed to register CLI in /usr/local/bin: {}",
                stderr.trim()
            ));
        }

        Ok(inspect_for_bundled_cli(&bundled))
    }

    #[cfg(windows)]
    {
        let bundled_dir = bundled
            .parent()
            .ok_or_else(|| "Unable to resolve bundled CLI directory".to_string())?
            .to_string_lossy()
            .into_owned();
        add_dir_to_windows_user_path(&bundled_dir)?;
        Ok(inspect_for_bundled_cli(&bundled))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let current_version = env!("CARGO_PKG_VERSION");
        let link_path = Path::new("/usr/local/bin/settled");
        let is_appimage = std::env::var_os("APPIMAGE").is_some();

        if !is_appimage {
            match try_direct_symlink_classified(&bundled, link_path) {
                SymlinkAttempt::Linked => return Ok(inspect_for_bundled_cli(&bundled)),
                SymlinkAttempt::Conflict(conflict_path) => {
                    return Ok(CliRegistrationInfo::conflict(&bundled, &conflict_path));
                }
                SymlinkAttempt::NeedsElevation | SymlinkAttempt::Failed(_) => {}
            }
        }

        let home =
            dirs::home_dir().ok_or_else(|| "Unable to resolve user home directory".to_string())?;
        let local_bin = home.join(".local").join("bin");
        let local_target = local_bin.join("settled");
        let manifest_path = default_managed_manifest_path()
            .ok_or_else(|| "Unable to resolve OS application data directory".to_string())?;

        match inspect_managed_copy_target(&local_target, &bundled, &manifest_path, current_version)
        {
            ManagedTargetState::Conflict(conflict_path) => {
                return Ok(CliRegistrationInfo::conflict(&bundled, &conflict_path));
            }
            ManagedTargetState::UpToDate => {}
            ManagedTargetState::Absent | ManagedTargetState::ManagedUpdatable => {
                install_managed_linux_copy(
                    &bundled,
                    &local_target,
                    &manifest_path,
                    current_version,
                )?;
            }
        }

        if env_path_contains_dir(&local_bin) {
            return Ok(inspect_for_bundled_cli(&bundled));
        }

        Ok(CliRegistrationInfo {
            status: CliPathStatus::NotInPath,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            conflict_path: None,
            manual_command: Some("export PATH=\"$HOME/.local/bin:$PATH\"".to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn detects_ephemeral_macos_locations() {
        assert!(is_ephemeral_macos_location(Path::new(
            "/Volumes/Settled/Settled.app/Contents/MacOS/settled"
        )));
        assert!(is_ephemeral_macos_location(Path::new(
            "/private/var/folders/aa/bb/T/AppTranslocation/1234/d/Settled.app/Contents/MacOS/settled"
        )));
        assert!(!is_ephemeral_macos_location(Path::new(
            "/Applications/Settled.app/Contents/MacOS/settled"
        )));
    }

    #[test]
    fn quotes_posix_paths_safely() {
        assert_eq!(
            shell_single_quote("/Applications/Settled App/it's/settled"),
            "'/Applications/Settled App/it'\\''s/settled'"
        );
    }

    #[test]
    fn handles_windows_path_entries_without_duplicates_across_all_platforms() {
        let existing = r"C:\Tools;C:\Users\Dev\AppData\Local\Settled\;D:\Bin";
        assert!(windows_path_contains_dir(
            existing,
            r"c:\users\dev\appdata\local\settled"
        ));
        assert!(
            append_windows_path_entry(existing, r"C:\Users\Dev\AppData\Local\Settled").is_none()
        );

        let added = append_windows_path_entry(existing, r"C:\Program Files\Settled").unwrap();
        assert_eq!(
            added,
            r"C:\Tools;C:\Users\Dev\AppData\Local\Settled\;D:\Bin;C:\Program Files\Settled"
        );
        assert_eq!(
            append_windows_path_entry("", r"C:\Settled").as_deref(),
            Some(r"C:\Settled")
        );
    }

    #[test]
    fn detects_path_shadowing_when_earlier_entry_takes_precedence() {
        let tmp = TempDir::new().unwrap();
        let dir_first = tmp.path().join("first-in-path");
        let dir_bundled = tmp.path().join("bundled-dir");
        fs::create_dir_all(&dir_first).unwrap();
        fs::create_dir_all(&dir_bundled).unwrap();

        let cli_name = cli_binary_filename();
        let old_cli = dir_first.join(cli_name);
        let bundled_cli = dir_bundled.join(cli_name);
        fs::write(&old_cli, "old").unwrap();
        fs::write(&bundled_cli, "new").unwrap();

        // Earlier PATH entry shadows bundled binary -> ShadowedBy(old_cli)
        let shadowed = resolve_first_settled_in_dirs(
            &[dir_first.clone(), dir_bundled.clone()],
            &[cli_name],
            |p| same_canonical_path(p, &bundled_cli),
        );
        assert_eq!(shadowed, PathHit::ShadowedBy(old_cli));

        // Bundled directory earlier in PATH -> MatchesBundled
        let matched = resolve_first_settled_in_dirs(&[dir_bundled, dir_first], &[cli_name], |p| {
            same_canonical_path(p, &bundled_cli)
        });
        assert_eq!(matched, PathHit::MatchesBundled);
    }

    #[test]
    fn protects_unmanaged_or_newer_local_copy_and_allows_managed_upgrade() {
        let tmp = TempDir::new().unwrap();
        let bundled_v1 = tmp.path().join("bundled-v1");
        let bundled_v2 = tmp.path().join("bundled-v2");
        let target = tmp.path().join("local-bin").join("settled");
        let manifest = tmp.path().join("managed-cli.json");

        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&bundled_v1, "settled-binary-v1").unwrap();
        fs::write(&bundled_v2, "settled-binary-v2").unwrap();

        // Missing target -> Absent (safe to install)
        assert_eq!(
            inspect_managed_copy_target(&target, &bundled_v1, &manifest, "0.1.0"),
            ManagedTargetState::Absent
        );

        // Unmanaged existing file -> Conflict (never silently overwritten!)
        fs::write(&target, "user-custom-script").unwrap();
        assert_eq!(
            inspect_managed_copy_target(&target, &bundled_v1, &manifest, "0.1.0"),
            ManagedTargetState::Conflict(target.clone())
        );

        // Managed v1 copy -> identical returns UpToDate, newer v2 returns ManagedUpdatable
        fs::copy(&bundled_v1, &target).unwrap();
        let hash_v1 = compute_file_fingerprint(&target).unwrap();
        fs::write(
            &manifest,
            serde_json::to_string(&ManagedCliManifest {
                target_path: canonicalize_if_possible(&target)
                    .to_string_lossy()
                    .into_owned(),
                content_hash: hash_v1,
                version: "0.2.0".to_string(),
            })
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            inspect_managed_copy_target(&target, &bundled_v1, &manifest, "0.2.0"),
            ManagedTargetState::UpToDate
        );
        assert_eq!(
            inspect_managed_copy_target(&target, &bundled_v2, &manifest, "0.3.0"),
            ManagedTargetState::ManagedUpdatable
        );
        // Older desktop app (0.1.0) MUST NOT downgrade a newer managed CLI (0.2.0)
        assert_eq!(
            inspect_managed_copy_target(&target, &bundled_v2, &manifest, "0.1.0"),
            ManagedTargetState::Conflict(target.clone())
        );
    }

    #[cfg(unix)]
    #[test]
    fn classifies_symlink_conflicts_distinctly_from_elevation_and_updates_settled_symlinks() {
        let tmp = TempDir::new().unwrap();
        let old_app_bin = tmp.path().join("Old.app/Contents/MacOS/settled");
        let new_app_bin = tmp.path().join("New.app/Contents/MacOS/settled");
        let unrelated_bin = tmp.path().join("homebrew/settled");
        let link = tmp.path().join("bin/settled");

        fs::create_dir_all(old_app_bin.parent().unwrap()).unwrap();
        fs::create_dir_all(new_app_bin.parent().unwrap()).unwrap();
        fs::create_dir_all(unrelated_bin.parent().unwrap()).unwrap();
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        fs::write(&old_app_bin, "v1").unwrap();
        fs::write(&new_app_bin, "v2").unwrap();
        fs::write(&unrelated_bin, "brew").unwrap();

        // Fresh symlink succeeds
        assert_eq!(
            try_direct_symlink_classified(&old_app_bin, &link),
            SymlinkAttempt::Linked
        );
        assert!(same_canonical_path(&link, &old_app_bin));

        // Updating a Settled .app symlink succeeds cleanly
        assert_eq!(
            try_direct_symlink_classified(&new_app_bin, &link),
            SymlinkAttempt::Linked
        );
        assert!(same_canonical_path(&link, &new_app_bin));

        // Existing live symlink to an unrelated tool MUST report Conflict (NOT NeedsElevation!)
        fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&unrelated_bin, &link).unwrap();
        assert_eq!(
            try_direct_symlink_classified(&new_app_bin, &link),
            SymlinkAttempt::Conflict(link.clone())
        );

        // Existing regular file MUST report Conflict (never elevated to `ln -sf`!)
        fs::remove_file(&link).unwrap();
        fs::write(&link, "custom-regular-binary").unwrap();
        assert_eq!(
            try_direct_symlink_classified(&new_app_bin, &link),
            SymlinkAttempt::Conflict(link.clone())
        );
        assert_eq!(fs::read_to_string(&link).unwrap(), "custom-regular-binary");

        // Missing parent directory reports NeedsElevation (e.g. /usr/local/bin missing on Apple Silicon)
        let missing_parent_link = tmp.path().join("nonexistent-dir/settled");
        assert_eq!(
            try_direct_symlink_classified(&new_app_bin, &missing_parent_link),
            SymlinkAttempt::NeedsElevation
        );
    }
}
