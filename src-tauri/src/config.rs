use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralConfig {
    pub app_name: String,
    pub language: String,
    pub date_format: String,
    pub launch_page: String,
    pub auto_update: bool,
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
        let install_dir = get_app_install_dir();
        install_dir.join("storage")
    } else {
        PathBuf::from(path)
    }
}

pub fn create_default_config(storage_root: &Path) -> AppConfig {
    let mut ui_overrides = std::collections::HashMap::new();
    
    // Set default editorial colors in the hashmap as default UI overrides
    ui_overrides.insert("nav_background".to_string(), "#f6f2ea".to_string());
    ui_overrides.insert("content_background".to_string(), "#f6f2ea".to_string());
    ui_overrides.insert("card_background".to_string(), "#ede8dc".to_string());
    ui_overrides.insert("card_border".to_string(), "#c9bfab".to_string());
    ui_overrides.insert("text_color".to_string(), "#18140f".to_string());
    ui_overrides.insert("border_accent".to_string(), "#b8440c".to_string());

    AppConfig {
        general: GeneralConfig {
            app_name: "Composer".to_string(),
            language: "en".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            launch_page: "Explorer".to_string(),
            auto_update: false,
        },
        storage: StorageConfig {
            root_path: storage_root.to_string_lossy().to_string(),
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
            theme_preset: "light".to_string(), // Editorial warm light first
            accent_color: "#b8440c".to_string(),
            background_override: "".to_string(),
            font_family_ui: "Inter".to_string(),
            font_size_ui: 14,
            compact_mode: false,
            reduce_motion: false,
            nav_layout: "sidebar".to_string(),
            nav_sidebar_width: 240,
            nav_show_app_label: true,
            nav_show_status_bar: true,
            nav_separator_line: true,
            nav_separator_color: "#c9bfab".to_string(),
            nav_glass_effect: false,
            ui_overrides,
        },
    }
}

pub fn get_default_config_path() -> PathBuf {
    let install_dir = get_app_install_dir();
    let storage_dir = install_dir.join("storage");
    let _ = fs::create_dir_all(&storage_dir);
    storage_dir.join("config.json")
}

pub fn get_config_path() -> PathBuf {
    get_default_config_path()
}

pub fn load_config() -> AppConfig {
    let default_path = get_default_config_path();
    let mut config = if default_path.exists() {
        if let Ok(content) = fs::read_to_string(&default_path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
                cfg
            } else {
                create_default_config(&default_path.parent().unwrap())
            }
        } else {
            create_default_config(&default_path.parent().unwrap())
        }
    } else {
        // Migration check: if old toml config exists, migrate it
        let old_toml = default_path.parent().unwrap().join("config").join("composer.toml");
        if old_toml.exists() {
            if let Ok(content) = fs::read_to_string(&old_toml) {
                if let Ok(cfg) = toml::from_str::<AppConfig>(&content) {
                    let _ = save_config(&cfg);
                    cfg
                } else {
                    create_default_config(&default_path.parent().unwrap())
                }
            } else {
                create_default_config(&default_path.parent().unwrap())
            }
        } else {
            create_default_config(&default_path.parent().unwrap())
        }
    };

    // If custom root_path is defined, load config from there if it exists
    let root_path_str = config.storage.root_path.trim().to_string();
    if !root_path_str.is_empty() {
        let custom_root = PathBuf::from(&root_path_str);
        let custom_path = custom_root.join("config.json");
        if custom_path != default_path && custom_path.exists() {
            if let Ok(content) = fs::read_to_string(&custom_path) {
                if let Ok(custom_cfg) = serde_json::from_str::<AppConfig>(&content) {
                    config = custom_cfg;
                }
            }
        }
    }

    // Initialize workspace subdirectories in active storage root
    let active_root = resolve_storage_path(&config.storage.root_path);
    let _ = fs::create_dir_all(&active_root.join("workspace"));
    let _ = fs::create_dir_all(&active_root.join("users"));

    config
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let default_path = get_default_config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    
    // Save to default location (bootstrap)
    fs::write(&default_path, &content).map_err(|e| e.to_string())?;

    // Save to custom root_path location if different
    let root_path_str = config.storage.root_path.trim().to_string();
    if !root_path_str.is_empty() {
        let custom_root = PathBuf::from(&root_path_str);
        let custom_path = custom_root.join("config.json");
        if custom_path != default_path {
            let _ = fs::create_dir_all(&custom_root);
            fs::write(custom_path, &content).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_app_config() -> AppConfig {
    load_config()
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    save_config(&config)
}

#[tauri::command]
pub fn export_theme_toml(theme: ThemeConfig, export_path: String) -> Result<(), String> {
    let path = Path::new(&export_path);
    let toml_str = toml::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    fs::write(path, toml_str).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_theme_toml(import_path: String) -> Result<ThemeConfig, String> {
    let path = Path::new(&import_path);
    if !path.exists() {
        return Err("Theme file does not exist".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let theme = toml::from_str::<ThemeConfig>(&content).map_err(|e| e.to_string())?;
    Ok(theme)
}

#[tauri::command]
pub fn get_app_install_path() -> String {
    // Return the user-configured storage root, falling back to exe dir/storage
    let cfg = load_config();
    if !cfg.storage.root_path.is_empty() {
        cfg.storage.root_path
    } else {
        get_app_install_dir().join("storage").to_string_lossy().to_string()
    }
}

#[tauri::command]
pub fn get_workspace_path() -> String {
    let cfg = load_config();
    if !cfg.storage.workspace_path.is_empty() {
        cfg.storage.workspace_path
    } else if !cfg.storage.root_path.is_empty() {
        cfg.storage.root_path
    } else {
        get_app_install_dir().join("storage").to_string_lossy().to_string()
    }
}
