use serde::Serialize;
use settled_core::{canonicalize_if_possible, paths_equal};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::fs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliPathStatus {
    Ready,
    NotInPath,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NeedsApplicationsMove,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRegistrationInfo {
    pub status: CliPathStatus,
    pub bundled_path: Option<String>,
    pub manual_command: Option<String>,
}

impl CliRegistrationInfo {
    fn unavailable() -> Self {
        Self {
            status: CliPathStatus::Unavailable,
            bundled_path: None,
            manual_command: None,
        }
    }

    fn ready(bundled: &Path) -> Self {
        Self {
            status: CliPathStatus::Ready,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            manual_command: None,
        }
    }
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

fn path_resolves_settled_to(bundled: &Path) -> bool {
    which::which("settled")
        .ok()
        .is_some_and(|found| same_canonical_path(&found, bundled))
}

#[cfg(unix)]
fn try_direct_symlink(bundled: &Path, link_path: &Path) -> std::io::Result<()> {
    let Some(parent) = link_path.parent() else {
        return Err(std::io::Error::other("Missing parent directory for link"));
    };
    if !parent.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Target directory does not exist",
        ));
    }

    match fs::symlink_metadata(link_path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            fs::remove_file(link_path)?;
        }
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "Non-symlink file already exists at target path",
            ));
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }

    std::os::unix::fs::symlink(bundled, link_path)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn split_path_entries(raw: &str, sep: char) -> Vec<String> {
    raw.split(sep)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn windows_path_contains_dir(raw: &str, dir: &str) -> bool {
    split_path_entries(raw, ';')
        .iter()
        .any(|entry| paths_equal(entry, dir))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn append_windows_path_entry(raw: &str, dir: &str) -> Option<String> {
    let mut entries = split_path_entries(raw, ';');
    if entries.iter().any(|entry| paths_equal(entry, dir)) {
        return None;
    }
    entries.push(dir.to_string());
    Some(entries.join(";"))
}

#[cfg(windows)]
fn read_windows_user_path() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = hkcu.open_subkey("Environment").ok()?;
    let val = env.get_raw_value("Path").ok()?;
    Some(decode_windows_reg_string(&val.bytes))
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

#[cfg(all(unix, not(target_os = "macos")))]
fn files_have_identical_contents(a: &Path, b: &Path) -> bool {
    let (Ok(meta_a), Ok(meta_b)) = (fs::metadata(a), fs::metadata(b)) else {
        return false;
    };
    if meta_a.len() != meta_b.len() {
        return false;
    }
    match (fs::read(a), fs::read(b)) {
        (Ok(bytes_a), Ok(bytes_b)) => bytes_a == bytes_b,
        _ => false,
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn env_path_contains_dir(dir: &Path) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path_var).any(|entry| same_canonical_path(&entry, dir))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn install_linux_local_copy(bundled: &Path, target: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create '{}': {e}", parent.display()))?;
    }
    fs::copy(bundled, target)
        .map_err(|e| format!("Failed to copy CLI binary to '{}': {e}", target.display()))?;
    let mut perms = fs::metadata(target)
        .map_err(|e| format!("Failed to inspect '{}': {e}", target.display()))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(target, perms)
        .map_err(|e| format!("Failed to mark '{}' executable: {e}", target.display()))?;
    Ok(())
}

/// Checks bundled CLI registration status on startup.
///
/// When a direct symlink (or AppImage copy into an already-configured `~/.local/bin`)
/// can be created silently without privilege elevation or shell-profile mutation,
/// this performs it immediately so the banner never flashes needlessly.
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
                manual_command: None,
            };
        }

        let link_path = Path::new("/usr/local/bin/settled");
        if same_canonical_path(link_path, bundled) || path_resolves_settled_to(bundled) {
            return CliRegistrationInfo::ready(bundled);
        }

        if try_direct_symlink(bundled, link_path).is_ok() {
            return CliRegistrationInfo::ready(bundled);
        }

        let bundled_str = bundled.to_string_lossy().into_owned();
        CliRegistrationInfo {
            status: CliPathStatus::NotInPath,
            bundled_path: Some(bundled_str.clone()),
            manual_command: Some(format!(
                "sudo mkdir -p /usr/local/bin && sudo ln -sf {} /usr/local/bin/settled",
                shell_single_quote(&bundled_str)
            )),
        }
    }

    #[cfg(windows)]
    {
        let bundled_dir = bundled
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let in_user_path = read_windows_user_path()
            .is_some_and(|raw| windows_path_contains_dir(&raw, &bundled_dir));
        if in_user_path || path_resolves_settled_to(bundled) {
            return CliRegistrationInfo::ready(bundled);
        }

        let escaped_dir = bundled_dir.replace('\'', "''");
        CliRegistrationInfo {
            status: CliPathStatus::NotInPath,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            manual_command: Some(format!(
                "$p=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path', (($p -split ';' | ?{{$_}}) + '{escaped_dir}' | Select-Object -Unique) -join ';', 'User')"
            )),
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let link_path = Path::new("/usr/local/bin/settled");
        if path_resolves_settled_to(bundled) || same_canonical_path(link_path, bundled) {
            return CliRegistrationInfo::ready(bundled);
        }

        let is_appimage = std::env::var_os("APPIMAGE").is_some();
        if is_appimage {
            if let Some(home) = dirs::home_dir() {
                let local_bin = home.join(".local").join("bin");
                let local_target = local_bin.join("settled");
                let local_in_path = env_path_contains_dir(&local_bin);
                if local_in_path && files_have_identical_contents(bundled, &local_target) {
                    return CliRegistrationInfo::ready(bundled);
                }
                if local_in_path && install_linux_local_copy(bundled, &local_target).is_ok() {
                    return CliRegistrationInfo::ready(bundled);
                }
            }
            let bundled_str = bundled.to_string_lossy().into_owned();
            return CliRegistrationInfo {
                status: CliPathStatus::NotInPath,
                bundled_path: Some(bundled_str.clone()),
                manual_command: Some(format!(
                    "mkdir -p \"$HOME/.local/bin\" && cp {} \"$HOME/.local/bin/settled\" && chmod +x \"$HOME/.local/bin/settled\"",
                    shell_single_quote(&bundled_str)
                )),
            };
        }

        if try_direct_symlink(bundled, link_path).is_ok() {
            return CliRegistrationInfo::ready(bundled);
        }

        let bundled_str = bundled.to_string_lossy().into_owned();
        CliRegistrationInfo {
            status: CliPathStatus::NotInPath,
            bundled_path: Some(bundled_str.clone()),
            manual_command: Some(format!(
                "sudo mkdir -p /usr/local/bin && sudo ln -sf {} /usr/local/bin/settled",
                shell_single_quote(&bundled_str)
            )),
        }
    }
}

/// Explicitly registers the bundled `settled` CLI on PATH after user action.
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
                manual_command: None,
            });
        }

        let link_path = Path::new("/usr/local/bin/settled");
        if try_direct_symlink(&bundled, link_path).is_ok() {
            return Ok(CliRegistrationInfo::ready(&bundled));
        }

        let bundled_str = bundled.to_string_lossy().into_owned();
        let shell_cmd = format!(
            "mkdir -p /usr/local/bin && ln -sf {} /usr/local/bin/settled",
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
        let link_path = Path::new("/usr/local/bin/settled");
        let is_appimage = std::env::var_os("APPIMAGE").is_some();

        if !is_appimage && try_direct_symlink(&bundled, link_path).is_ok() {
            return Ok(CliRegistrationInfo::ready(&bundled));
        }

        let home =
            dirs::home_dir().ok_or_else(|| "Unable to resolve user home directory".to_string())?;
        let local_bin = home.join(".local").join("bin");
        let local_target = local_bin.join("settled");
        install_linux_local_copy(&bundled, &local_target)?;

        if env_path_contains_dir(&local_bin) {
            return Ok(CliRegistrationInfo::ready(&bundled));
        }

        Ok(CliRegistrationInfo {
            status: CliPathStatus::NotInPath,
            bundled_path: Some(bundled.to_string_lossy().into_owned()),
            manual_command: Some("export PATH=\"$HOME/.local/bin:$PATH\"".to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn handles_windows_path_entries_without_duplicates() {
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

    #[cfg(unix)]
    #[test]
    fn creates_and_updates_direct_symlink_without_overwriting_regular_files() {
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let bin_a = tmp.path().join("settled-v1");
        let bin_b = tmp.path().join("settled-v2");
        let link = tmp.path().join("settled");
        fs::write(&bin_a, "v1").unwrap();
        fs::write(&bin_b, "v2").unwrap();

        try_direct_symlink(&bin_a, &link).unwrap();
        assert!(same_canonical_path(&link, &bin_a));

        // Updating an existing symlink succeeds cleanly
        try_direct_symlink(&bin_b, &link).unwrap();
        assert!(same_canonical_path(&link, &bin_b));

        // Never overwrite an unrelated regular file
        fs::remove_file(&link).unwrap();
        fs::write(&link, "custom-script").unwrap();
        assert!(try_direct_symlink(&bin_b, &link).is_err());
    }
}
