use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralConfig {
    pub app_name: String,
    pub language: String,
    pub date_format: String,
    pub launch_page: String,
    pub auto_update: bool,
    /// Set to true after the user completes the first-launch onboarding wizard.
    /// Uses serde(default) so existing configs without this field read as false.
    #[serde(default)]
    pub onboarding_completed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StorageConfig {
    pub root_path: String,
    #[serde(default)]
    pub workspace_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditorConfig {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f32,
    pub tab_size: u32,
    pub auto_save_interval_sec: u32,
    pub vim_mode: bool,
    pub max_versions_per_file: u32,
    pub total_version_storage_limit_mb: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeConfig {
    pub theme_preset: String, // "light" | "dark" | "system"
    pub accent_color: String, // color hex/hsl override
    pub background_override: String,
    pub font_family_ui: String,
    pub font_size_ui: u32,
    pub compact_mode: bool,
    pub reduce_motion: bool,
    // Custom overrides mapping for Editorial and layout properties
    pub nav_layout: String, // "sidebar" | "vertical_pills" | "top_navbar"
    pub nav_sidebar_width: u32, // 200 to 280
    pub nav_show_app_label: bool,
    pub nav_show_status_bar: bool,
    pub nav_separator_line: bool,
    pub nav_separator_color: String,
    pub nav_glass_effect: bool,

    // UI elements custom color settings
    pub ui_overrides: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub general: GeneralConfig,
    pub storage: StorageConfig,
    pub editor: EditorConfig,
    pub theme: ThemeConfig,
}

pub fn get_app_install_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap())
}

pub fn resolve_storage_path(path: &str) -> PathBuf {
    if path.is_empty() {
        let os_dir = get_os_config_dir();
        os_dir.join("storage")
    } else {
        PathBuf::from(path)
    }
}

pub fn create_default_config(_storage_root: &Path) -> AppConfig {
    let mut ui_overrides = std::collections::HashMap::new();

    // Set default Black/White Minimalist colors in the hashmap as default UI overrides
    ui_overrides.insert("nav_background".to_string(), "#000000".to_string());
    ui_overrides.insert("content_background".to_string(), "#000000".to_string());
    ui_overrides.insert("card_background".to_string(), "#0F0F0F".to_string());
    ui_overrides.insert("card_border".to_string(), "rgba(255,255,255,0.12)".to_string());
    ui_overrides.insert("text_color".to_string(), "#FFFFFF".to_string());
    ui_overrides.insert("border_accent".to_string(), "#FFFFFF".to_string());

    AppConfig {
        general: GeneralConfig {
            app_name: "Composer".to_string(),
            language: "en".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            launch_page: "Home".to_string(),
            auto_update: false,
            onboarding_completed: false,
        },
        storage: StorageConfig {
            root_path: get_app_install_dir().to_string_lossy().to_string(),
            workspace_path: "".to_string(),
        },
        editor: EditorConfig {
            font_family: "EB Garamond".to_string(),
            font_size: 17,
            line_height: 1.6,
            tab_size: 4,
            auto_save_interval_sec: 10,
            vim_mode: false,
            max_versions_per_file: 20,
            total_version_storage_limit_mb: 100,
        },
        theme: ThemeConfig {
            theme_preset: "dark".to_string(), // Minimalist B&W default
            accent_color: "#FFFFFF".to_string(),
            background_override: "".to_string(),
            font_family_ui: "modern_sans".to_string(),
            font_size_ui: 14,
            compact_mode: false,
            reduce_motion: false,
            nav_layout: "sidebar".to_string(),
            nav_sidebar_width: 240,
            nav_show_app_label: true,
            nav_show_status_bar: true,
            nav_separator_line: true,
            nav_separator_color: "rgba(255,255,255,0.08)".to_string(),
            nav_glass_effect: false,
            ui_overrides,
        },
    }
}

/// Returns the legacy configuration path (<exe>/storage/config.json).
pub fn get_legacy_config_path() -> PathBuf {
    get_app_install_dir().join("storage").join("config.json")
}

/// Returns the standard OS application configuration directory:
/// - Windows: %APPDATA%\Composer
/// - macOS: ~/Library/Application Support/Composer
/// - Linux: $XDG_CONFIG_HOME/Composer or ~/.config/Composer
pub fn get_os_config_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("Composer");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Composer");
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            return PathBuf::from(xdg).join("Composer");
        } else if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".config").join("Composer");
        }
    }
    // Safe fallback to legacy install dir storage if environment variables are not available
    get_app_install_dir().join("storage")
}

/// Canonical configuration file location: <exe_dir>/config.json
/// This ensures the config always lives right beside the installed executable.
pub fn get_canonical_config_path() -> PathBuf {
    let dir = get_app_install_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("config.json")
}

/// Backward compatibility alias for existing code.
pub fn get_default_config_path() -> PathBuf {
    get_canonical_config_path()
}

pub fn get_config_path() -> PathBuf {
    get_canonical_config_path()
}

// -----------------------------------------------------------------
// IN-MEMORY CONFIG CACHE
// -----------------------------------------------------------------

static CONFIG_CACHE: OnceLock<Mutex<Option<AppConfig>>> = OnceLock::new();

fn config_cache() -> &'static Mutex<Option<AppConfig>> {
    CONFIG_CACHE.get_or_init(|| Mutex::new(None))
}

/// Loads the application configuration.
///
/// The parsed configuration is cached in memory for the lifetime of the
/// process so commands do not re-read and re-parse `config.json` on every
/// invocation. The cache is refreshed by [`update_cached_config`] whenever
/// the configuration is saved.
pub fn load_config() -> AppConfig {
    let mut cache = config_cache().lock().unwrap();
    if let Some(cached) = cache.as_ref() {
        return cached.clone();
    }
    let config = load_config_from_disk();
    *cache = Some(config.clone());
    config
}

/// Replaces the cached configuration after a successful save.
pub fn update_cached_config(config: &AppConfig) {
    *config_cache().lock().unwrap() = Some(config.clone());
}

/// Reads, parses, and migrates the configuration from disk (uncached).
/// Performs safe forward-migration from legacy `<exe>/storage/config.json`
/// to the OS-standard configuration directory without deleting or destroying
/// the legacy file.
fn load_config_from_disk() -> AppConfig {
    let canonical_path = get_canonical_config_path();
    let legacy_path = get_legacy_config_path();

    // 1. Try reading existing canonical OS config
    if canonical_path.exists() {
        if let Ok(content) = fs::read_to_string(&canonical_path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
                return finalize_loaded_config(cfg);
            }
        }
    }

    // 2. Safe Migration Path: If canonical doesn't exist, check if legacy config exists
    if legacy_path.exists() {
        if let Ok(content) = fs::read_to_string(&legacy_path) {
            if let Ok(legacy_cfg) = serde_json::from_str::<AppConfig>(&content) {
                // Ensure the OS-standard directory exists
                if let Some(parent) = canonical_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if let Ok(pretty_json) = serde_json::to_string_pretty(&legacy_cfg) {
                    if fs::write(&canonical_path, &pretty_json).is_ok() {
                        // Validate newly written file can be read and parsed accurately
                        if let Ok(verify_str) = fs::read_to_string(&canonical_path) {
                            if serde_json::from_str::<AppConfig>(&verify_str).is_ok() {
                                // Migration verified! Notice: NEVER delete legacy_path.
                                return finalize_loaded_config(legacy_cfg);
                            }
                        }
                    }
                }
                return finalize_loaded_config(legacy_cfg);
            }
        }
    }

    // 3. Migration check for very old TOML config
    let legacy_toml = legacy_path
        .parent()
        .map(|p| p.join("config").join("composer.toml"))
        .unwrap_or_else(|| get_app_install_dir().join("storage").join("config").join("composer.toml"));
    if legacy_toml.exists() {
        if let Ok(content) = fs::read_to_string(&legacy_toml) {
            if let Ok(cfg) = toml::from_str::<AppConfig>(&content) {
                let _ = save_config(&cfg);
                return finalize_loaded_config(cfg);
            }
        }
    }

    // 4. Default initialization: create fresh default configuration
    let default_cfg = create_default_config(canonical_path.parent().unwrap());
    let _ = save_config(&default_cfg);
    finalize_loaded_config(default_cfg)
}

fn finalize_loaded_config(mut config: AppConfig) -> AppConfig {
    // If custom root_path is defined and has a config.json, merge it
    let root_path_str = config.storage.root_path.trim().to_string();
    if !root_path_str.is_empty() {
        let custom_root = PathBuf::from(&root_path_str);
        let custom_path = custom_root.join("config.json");
        if custom_path != get_canonical_config_path() && custom_path.exists() {
            if let Ok(content) = fs::read_to_string(&custom_path) {
                if let Ok(custom_cfg) = serde_json::from_str::<AppConfig>(&content) {
                    config = custom_cfg;
                }
            }
        }
    }

    // Ensure workspace subdirectories exist
    let _ = get_active_workspace_path_internal(&config);

    // Ensure required storage sub-directories exist in root_path
    let root_str = config.storage.root_path.trim().to_string();
    if !root_str.is_empty() {
        ensure_storage_dirs(&PathBuf::from(&root_str));
    } else {
        ensure_storage_dirs(&get_app_install_dir());
    }

    config
}

/// Returns the active workspace path according to active configuration.
/// 1. Uses `storage.workspace_path` if valid and non-empty.
/// 2. Falls back to `storage.root_path` if valid and non-empty.
/// 3. Falls back to `<os_config_dir>/workspace`.
pub fn get_active_workspace_path() -> PathBuf {
    let cfg = load_config();
    get_active_workspace_path_internal(&cfg)
}

fn get_active_workspace_path_internal(cfg: &AppConfig) -> PathBuf {
    if !cfg.storage.workspace_path.trim().is_empty() {
        let ws = PathBuf::from(&cfg.storage.workspace_path);
        if ws.exists() {
            return ws;
        }
    }
    if !cfg.storage.root_path.trim().is_empty() {
        let root = PathBuf::from(&cfg.storage.root_path);
        if root.exists() {
            return root;
        }
    }
    let default_ws = get_os_config_dir().join("workspace");
    let _ = fs::create_dir_all(&default_ws);
    default_ws
}

/// Atomically writes `content` to `path`: the data is written to a sibling
/// temporary file first and then renamed over the target, so a crash
/// mid-write can never leave a truncated or corrupt file behind.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "Invalid config path".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config.json".to_string());
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{}.{}.tmp-{}", file_name, std::process::id(), unique));

    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let canonical_path = get_canonical_config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;

    write_atomic(&canonical_path, &content)?;

    // Save to custom root_path location if different and configured
    let root_path_str = config.storage.root_path.trim().to_string();
    if !root_path_str.is_empty() {
        let custom_root = PathBuf::from(&root_path_str);
        let custom_path = custom_root.join("config.json");
        if custom_path != canonical_path {
            let _ = write_atomic(&custom_path, &content);
        }
        // Always (re-)create required storage sub-directories when root changes
        ensure_storage_dirs(&custom_root);
    } else {
        ensure_storage_dirs(&get_app_install_dir());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_app_config() -> AppConfig {
    load_config()
}

#[tauri::command]
pub async fn save_app_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    // Storage paths are security-sensitive: a compromised webview must not be
    // able to repoint the storage root or workspace at arbitrary directories.
    // Only the currently configured value or a path the user picked through a
    // native dialog / drag-and-drop in this session is accepted.
    let current = load_config();
    let session_paths = app.state::<crate::session::SessionPaths>();

    let new_root = config.storage.root_path.trim().to_string();
    let root_changed = new_root != current.storage.root_path.trim();
    if root_changed && !new_root.is_empty() && !session_paths.is_allowed(Path::new(&new_root)) {
        return Err(
            "Storage root can only be changed through the native folder picker".to_string(),
        );
    }

    let new_workspace = config.storage.workspace_path.trim().to_string();
    let workspace_changed = new_workspace != current.storage.workspace_path.trim();
    if workspace_changed
        && !new_workspace.is_empty()
        && !session_paths.is_allowed(Path::new(&new_workspace))
    {
        return Err(
            "Workspace path can only be changed through the native folder picker".to_string(),
        );
    }

    let config_to_save = config.clone();
    tauri::async_runtime::spawn_blocking(move || save_config(&config_to_save))
        .await
        .map_err(|e| e.to_string())??;

    // Keep the in-memory cache and the runtime asset protocol scope in sync
    // with what was just written to disk.
    update_cached_config(&config);
    if root_changed || workspace_changed {
        let active = get_active_workspace_path();
        crate::refresh_asset_protocol_scope(&app, &active);
    }
    Ok(())
}

#[tauri::command]
pub async fn export_theme_toml(
    app: tauri::AppHandle,
    theme: ThemeConfig,
    export_path: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    let path = PathBuf::from(&export_path);

    // The destination must be user-confirmed: either strictly inside the
    // active workspace or produced by a native save dialog this session.
    let workspace_root = get_active_workspace_path();
    let dest = match crate::file_ops::validate_path_in_workspace(&path, &workspace_root) {
        Ok(validated) => validated,
        Err(_) => {
            if app.state::<crate::session::SessionPaths>().is_allowed(&path) {
                path
            } else {
                return Err(
                    "Export destination must be inside the active workspace or chosen through the native save dialog"
                        .to_string(),
                );
            }
        }
    };

    // Never silently clobber an existing file unless explicitly confirmed.
    if dest.exists() && !overwrite.unwrap_or(false) {
        return Err(format!(
            "'{}' already exists; pass overwrite: true to replace it",
            dest.to_string_lossy()
        ));
    }

    let toml_str = toml::to_string_pretty(&theme)
        .map_err(|_| "Failed to serialize theme".to_string())?;

    tauri::async_runtime::spawn_blocking(move || fs::write(&dest, toml_str).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_theme_toml(
    app: tauri::AppHandle,
    import_path: String,
) -> Result<ThemeConfig, String> {
    let path = PathBuf::from(&import_path);

    // The source must be user-confirmed: either strictly inside the active
    // workspace or produced by a native file picker this session.
    let workspace_root = get_active_workspace_path();
    let allowed = crate::file_ops::validate_path_in_workspace(&path, &workspace_root).is_ok()
        || app.state::<crate::session::SessionPaths>().is_allowed(&path);
    if !allowed {
        return Err(
            "Theme file must be inside the active workspace or chosen through the native file picker"
                .to_string(),
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        let content = fs::read_to_string(&path).map_err(|_| "Failed to read theme file".to_string())?;
        // Deliberately generic error: raw parser errors echo file contents
        // back to the caller and turn this into a content-disclosure oracle.
        toml::from_str::<ThemeConfig>(&content)
            .map_err(|_| "Theme file is not a valid Composer theme".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_app_install_path() -> String {
    let cfg = load_config();
    if !cfg.storage.root_path.is_empty() {
        cfg.storage.root_path
    } else {
        get_app_install_dir().to_string_lossy().to_string()
    }
}

#[tauri::command]
pub async fn get_workspace_path() -> String {
    get_active_workspace_path().to_string_lossy().to_string()
}

// -----------------------------------------------------------------
// STORAGE DIRECTORY MANAGEMENT
// -----------------------------------------------------------------

/// Creates the required sub-directories inside the storage root.
/// Currently creates: Cache
/// Call this whenever the storage root is set or changed.
pub fn ensure_storage_dirs(root: &PathBuf) {
    let dirs = ["Cache"];
    for dir in &dirs {
        let path = root.join(dir);
        let _ = fs::create_dir_all(&path);
    }
}

/// Returns the active Cache directory path.
/// Priority:
///   1. <storage.root_path>/Cache
///   2. <exe_dir>/Cache (fallback)
pub fn get_cache_dir() -> PathBuf {
    let cfg = load_config();
    let root = if !cfg.storage.root_path.trim().is_empty() {
        PathBuf::from(&cfg.storage.root_path)
    } else {
        get_app_install_dir()
    };
    let cache = root.join("Cache");
    let _ = fs::create_dir_all(&cache);
    cache
}

#[tauri::command]
pub async fn get_cache_path() -> String {
    get_cache_dir().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_os_config_dir_is_not_empty() {
        let dir = get_os_config_dir();
        assert!(!dir.to_string_lossy().is_empty());
    }

    #[test]
    fn test_create_default_config_has_all_sections() {
        let dir = std::env::temp_dir();
        let cfg = create_default_config(&dir);
        assert_eq!(cfg.general.app_name, "Composer");
        assert_eq!(cfg.editor.font_family, "EB Garamond");
        assert_eq!(cfg.theme.theme_preset, "dark");
    }

    #[test]
    fn test_write_atomic_replaces_existing_file_and_leaves_no_temp_files() {
        let dir = std::env::temp_dir().join("composer_test_atomic_write");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("config.json");

        write_atomic(&target, "old").expect("first write failed");
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");

        write_atomic(&target, "new").expect("second write failed");
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");

        let leftovers: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(leftovers, vec!["config.json".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }
}
