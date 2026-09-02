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
pub struct ModelsConfig {
    pub default_llm: String,
    pub hf_token: String,
    pub default_whisper: String,
    #[serde(default)]
    pub gpu_layers: i32,       // -1=all GPU, 0=CPU only, n=partial
    #[serde(default = "default_gpu_backend")]
    pub gpu_backend: String,   // "cpu" | "cuda" | "rocm" | "metal" | "vulkan"
}

fn default_gpu_backend() -> String { "cpu".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryConfig {
    pub enabled: bool,
    pub size_limit_mb: u32,
    pub compression_ratio_target: f32,
    pub compression_model: String,
    pub default_scope: String,
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
pub struct VoiceConfig {
    pub enabled: bool,
    pub active_whisper_model: String,
    pub microphone_device: String,
    pub language_hint: String,
    pub display_type: String, // "inline" | "popup"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatConfig {
    pub auto_project_promotion_threshold: u32,
    pub auto_project_promotion_enabled: bool,
    pub project_naming_model: String,
    pub default_sort: String,
    pub default_ai_mode: String,
    pub context_overflow_enabled: bool,
    pub context_overflow_buffer_percent: u32, // 5-25%
    pub continuation_summary_model: String,
    pub auto_switch_to_continuation: bool,
    pub show_context_summary_banner: String, // "always" | "collapsed" | "never"
    #[serde(default)]
    pub user_avatar_image: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SchedulerConfig {
    pub enabled: bool,
    pub max_concurrent_inferences: u32,
    pub default_notification_behavior: String, // "complete" | "fail_only" | "silent"
    pub log_retention_runs: u32,
    pub retry_default: String, // "none" | "once" | "3_times"
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
    pub models: ModelsConfig,
    pub memory: MemoryConfig,
    pub editor: EditorConfig,
    pub voice: VoiceConfig,
    pub chat: ChatConfig,
    pub scheduler: SchedulerConfig,
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

    let gpus = crate::models::detect_gpu_devices();
    let (default_gpu_layers, default_gpu_backend) = if !gpus.is_empty() {
        (-1, gpus[0].backend.clone())
    } else {
        (0, "cpu".to_string())
    };

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
        models: ModelsConfig {
            default_llm: "".to_string(),
            hf_token: "".to_string(),
            default_whisper: "base".to_string(),
            gpu_layers: default_gpu_layers,
            gpu_backend: default_gpu_backend,
        },
        memory: MemoryConfig {
            enabled: true,
            size_limit_mb: 256,
            compression_ratio_target: 0.2,
            compression_model: "active".to_string(),
            default_scope: "global".to_string(),
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
        voice: VoiceConfig {
            enabled: true,
            active_whisper_model: "base".to_string(),
            microphone_device: "Default".to_string(),
            language_hint: "en".to_string(),
            display_type: "inline".to_string(),
        },
        chat: ChatConfig {
            auto_project_promotion_threshold: 20,
            auto_project_promotion_enabled: true,
            project_naming_model: "active".to_string(),
            default_sort: "date".to_string(),
            default_ai_mode: "General".to_string(),
            context_overflow_enabled: true,
            context_overflow_buffer_percent: 10,
            continuation_summary_model: "active".to_string(),
            auto_switch_to_continuation: true,
            show_context_summary_banner: "collapsed".to_string(),
            user_avatar_image: None,
        },
        scheduler: SchedulerConfig {
            enabled: true,
            max_concurrent_inferences: 1,
            default_notification_behavior: "fail_only".to_string(),
            log_retention_runs: 10,
            retry_default: "none".to_string(),
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
    let _ = fs::create_dir_all(&active_root.join("documents"));
    let _ = fs::create_dir_all(&active_root.join("conversations"));
    let _ = fs::create_dir_all(&active_root.join("conversations").join("projects"));
    let _ = fs::create_dir_all(&active_root.join("memory"));
    let _ = fs::create_dir_all(&active_root.join("memory").join("archive"));
    let _ = fs::create_dir_all(&active_root.join("skills"));
    let _ = fs::create_dir_all(&active_root.join("scheduler"));
    let _ = fs::create_dir_all(&active_root.join("scheduler").join("logs"));
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
