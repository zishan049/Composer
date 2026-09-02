use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelCard {
    pub name: String,
    pub family: String,
    pub repo_id: String,       // HuggingFace repo: "author/repo"
    pub filename: String,      // exact GGUF filename inside repo
    pub size_gb: f32,
    pub quantization: String,
    pub context_length: u32,
    pub estimated_ram_gb: f32,
    pub estimated_vram_gb: f32,
    pub author: String,
    pub downloads: u32,
    pub is_downloaded: bool,
    pub download_progress: f32,
    pub gpu_layers: i32,
    pub gpu_backend: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuDevice {
    pub index: u32,
    pub name: String,
    pub vram_total_mb: u64,
    pub vram_free_mb: u64,
    pub backend: String,
    pub compute_capability: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WhisperModelInfo {
    pub name: String,
    pub size_mb: u32,
    pub is_downloaded: bool,
}

// ── State ─────────────────────────────────────────────────────────────────────

pub struct ActiveModelManager {
    pub loaded_model_path: Arc<Mutex<Option<String>>>,
    pub loaded_model_name: Arc<Mutex<Option<String>>>,
    pub download_tasks: Arc<Mutex<Vec<String>>>,
    pub gpu_layers: Arc<Mutex<i32>>,
    pub gpu_backend: Arc<Mutex<String>>,
    // llama-cpp-2 model stored as raw pointer for Send+Sync storage
    // Safety: we only access it from behind the mutex
    pub llama_model: Arc<Mutex<Option<llama_cpp_2::model::LlamaModel>>>,
    pub llama_backend: Arc<Mutex<Option<llama_cpp_2::llama_backend::LlamaBackend>>>,
}

impl ActiveModelManager {
    pub fn new() -> Self {
        Self {
            loaded_model_path: Arc::new(Mutex::new(None)),
            loaded_model_name: Arc::new(Mutex::new(None)),
            download_tasks: Arc::new(Mutex::new(Vec::new())),
            gpu_layers: Arc::new(Mutex::new(0)),
            gpu_backend: Arc::new(Mutex::new("cpu".into())),
            llama_model: Arc::new(Mutex::new(None)),
            llama_backend: Arc::new(Mutex::new(None)),
        }
    }
}

// ── GPU Detection ─────────────────────────────────────────────────────────────

/// Real detection via nvidia-smi subprocess (Windows/Linux).
#[tauri::command]
pub fn detect_gpu_devices() -> Vec<GpuDevice> {
    let mut devices = Vec::new();

    // ── NVIDIA ────────────────────────────────────────────────────────────────
    let nv = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=index,name,memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ])
        .output();

    if let Ok(out) = nv {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                let p: Vec<&str> = line.split(',').map(str::trim).collect();
                if p.len() >= 4 {
                    let idx: u32 = p[0].parse().unwrap_or(0);
                    let cc = nvidia_compute_cap(idx);
                    devices.push(GpuDevice {
                        index: idx,
                        name: p[1].to_string(),
                        vram_total_mb: p[2].parse().unwrap_or(0),
                        vram_free_mb: p[3].parse().unwrap_or(0),
                        backend: "cuda".into(),
                        compute_capability: cc,
                    });
                }
            }
        }
    }

    // ── AMD ROCm ──────────────────────────────────────────────────────────────
    if devices.is_empty() {
        let rocm = std::process::Command::new("rocm-smi")
            .args(["--showmeminfo", "vram", "--json"])
            .output();
        if let Ok(out) = rocm {
            if out.status.success() {
                // rocm-smi JSON: {"card0": {"VRAM Total Memory (B)": ..., "VRAM Total Used Memory (B)": ...}}
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    if let Some(obj) = json.as_object() {
                        for (i, (card, vals)) in obj.iter().enumerate() {
                            let total = vals["VRAM Total Memory (B)"]
                                .as_u64().unwrap_or(0) / (1024 * 1024);
                            let used  = vals["VRAM Total Used Memory (B)"]
                                .as_u64().unwrap_or(0) / (1024 * 1024);
                            devices.push(GpuDevice {
                                index: i as u32,
                                name: card.clone(),
                                vram_total_mb: total,
                                vram_free_mb: total.saturating_sub(used),
                                backend: "rocm".into(),
                                compute_capability: "gfx".into(),
                            });
                        }
                    }
                }
            }
        }
    }

    devices
}

fn nvidia_compute_cap(idx: u32) -> String {
    let out = std::process::Command::new("nvidia-smi")
        .args([
            &format!("-i={}", idx),
            "--query-gpu=compute_cap",
            "--format=csv,noheader",
        ])
        .output();
    if let Ok(o) = out {
        if o.status.success() {
            return String::from_utf8_lossy(&o.stdout).trim().to_string();
        }
    }
    "unknown".into()
}

// ── Model Catalogue ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn query_huggingface_models(query: String) -> Vec<ModelCard> {
    let all = model_catalogue();
    if query.is_empty() { return all; }
    let q = query.to_lowercase();
    all.into_iter()
        .filter(|m| m.name.to_lowercase().contains(&q) || m.family.to_lowercase().contains(&q))
        .collect()
}

fn mc(
    family: &str, repo_id: &str, filename: &str,
    size_gb: f32, quant: &str, ctx: u32,
    ram: f32, vram: f32, author: &str, dl: u32,
) -> ModelCard {
    ModelCard {
        name: filename.to_string(),
        family: family.to_string(),
        repo_id: repo_id.to_string(),
        filename: filename.to_string(),
        size_gb, quantization: quant.into(),
        context_length: ctx, estimated_ram_gb: ram, estimated_vram_gb: vram,
        author: author.into(), downloads: dl,
        is_downloaded: false, download_progress: 0.0,
        gpu_layers: 0, gpu_backend: "cpu".into(),
    }
}

fn model_catalogue() -> Vec<ModelCard> {
    vec![
        // Llama 3
        mc("llama","bartowski/Meta-Llama-3-8B-Instruct-GGUF","Meta-Llama-3-8B-Instruct-Q4_K_M.gguf",4.8,"Q4_K_M",8192,8.0,6.0,"bartowski",142000),
        mc("llama","bartowski/Meta-Llama-3.1-70B-Instruct-GGUF","Meta-Llama-3.1-70B-Instruct-Q3_K_M.gguf",28.9,"Q3_K_M",131072,40.0,24.0,"bartowski",87000),
        // Gemma 3
        mc("gemma","unsloth/gemma-3-4b-it-GGUF","gemma-3-4b-it-Q4_K_M.gguf",2.5,"Q4_K_M",131072,4.0,3.0,"unsloth",98000),
        mc("gemma","unsloth/gemma-3-12b-it-GGUF","gemma-3-12b-it-Q4_K_M.gguf",7.4,"Q4_K_M",131072,12.0,8.0,"unsloth",74000),
        mc("gemma","unsloth/gemma-3-27b-it-GGUF","gemma-3-27b-it-Q4_K_M.gguf",16.5,"Q4_K_M",131072,24.0,18.0,"unsloth",52000),
        // Mistral / NeMo
        mc("mistral","TheBloke/Mistral-7B-Instruct-v0.3-GGUF","Mistral-7B-Instruct-v0.3.Q6_K.gguf",5.9,"Q6_K",32768,10.5,7.0,"TheBloke",89000),
        mc("mistral","bartowski/Mistral-Nemo-Instruct-2407-GGUF","Mistral-Nemo-Instruct-2407-Q5_K_M.gguf",7.9,"Q5_K_M",131072,14.0,9.0,"bartowski",61000),
        // Phi 4
        mc("phi","bartowski/Phi-3-mini-128k-instruct-GGUF","Phi-3-mini-128k-instruct-Q8_0.gguf",4.0,"Q8_0",131072,6.5,4.0,"bartowski",64000),
        mc("phi","bartowski/Phi-4-GGUF","Phi-4-Q4_K_M.gguf",8.1,"Q4_K_M",16384,10.0,8.0,"microsoft",110000),
        // DeepSeek R1
        mc("deepseek","bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF","DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",4.4,"Q4_K_M",32768,8.0,5.5,"deepseek-ai",195000),
        mc("deepseek","bartowski/DeepSeek-R1-Distill-Llama-70B-GGUF","DeepSeek-R1-Distill-Llama-70B-Q3_K_M.gguf",29.2,"Q3_K_M",32768,44.0,24.0,"deepseek-ai",88000),
        // Qwen 2.5
        mc("qwen","Qwen/Qwen2.5-7B-Instruct-GGUF","qwen2.5-7b-instruct-q5_k_m.gguf",5.1,"Q5_K_M",131072,8.5,6.0,"Qwen",112000),
        mc("qwen","Qwen/Qwen2.5-Coder-14B-Instruct-GGUF","qwen2.5-coder-14b-instruct-q4_k_m.gguf",8.7,"Q4_K_M",131072,14.0,10.0,"Qwen",67000),
        // Falcon 3
        mc("falcon","tiiuae/Falcon3-7B-Instruct-GGUF","falcon3-7b-instruct-q4_k_m.gguf",4.7,"Q4_K_M",32768,8.0,5.5,"tiiuae",29000),
    ]
}

// ── Check if a model is downloaded ───────────────────────────────────────────

pub fn models_dir() -> PathBuf {
    let cfg = crate::config::load_config();
    if !cfg.storage.root_path.is_empty() {
        PathBuf::from(&cfg.storage.root_path).join("models")
    } else {
        crate::config::get_app_install_dir().join("storage").join("models")
    }
}

#[tauri::command]
pub fn list_downloaded_models() -> Vec<String> {
    let dir = models_dir();
    if !dir.exists() { return Vec::new(); }
    std::fs::read_dir(&dir)
        .into_iter().flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |x| x == "gguf"))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect()
}

// ── Real download via reqwest ─────────────────────────────────────────────────

#[tauri::command]
pub async fn start_model_download(
    app: AppHandle,
    model_name: String,
    repo_id: String,
    filename: String,
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<(), String> {
    {
        let mut tasks = manager.download_tasks.lock().unwrap();
        if tasks.contains(&model_name) { return Err("Download already in progress".into()); }
        tasks.push(model_name.clone());
    }

    let dest = models_dir().join(&filename);
    std::fs::create_dir_all(models_dir()).map_err(|e| e.to_string())?;

    // HuggingFace direct download URL
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        repo_id, filename
    );

    let tasks_ref = Arc::clone(&manager.download_tasks);
    let name = model_name.clone();

    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3600))
            .redirect(reqwest::redirect::Policy::none()) // Disable auto redirects!
            .build()
            .unwrap();

        let cfg = crate::config::load_config();
        let token = cfg.models.hf_token.clone();

        let mut req = client.get(&url).header("User-Agent", "Composer/1.0");
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let mut resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit("download_error", (&name, e.to_string()));
                tasks_ref.lock().unwrap().retain(|x| x != &name);
                return;
            }
        };

        // Follow up to 3 redirects manually to support Hugging Face CDN redirection securely
        let mut redirect_count = 0;
        while resp.status().is_redirection() && redirect_count < 3 {
            if let Some(loc) = resp.headers().get("location") {
                if let Ok(loc_str) = loc.to_str() {
                    redirect_count += 1;
                    // Make request to redirected URL. Crucially: DO NOT include the Authorization header!
                    let next_req = client.get(loc_str).header("User-Agent", "Composer/1.0");
                    resp = match next_req.send().await {
                        Ok(r) => r,
                        Err(e) => {
                            let _ = app.emit("download_error", (&name, e.to_string()));
                            tasks_ref.lock().unwrap().retain(|x| x != &name);
                            return;
                        }
                    };
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        if !resp.status().is_success() {
            let _ = app.emit("download_error", (&name, format!("HTTP {}", resp.status())));
            tasks_ref.lock().unwrap().retain(|x| x != &name);
            return;
        }

        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        let mut file = match tokio::fs::File::create(&dest).await {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit("download_error", (&name, e.to_string()));
                return;
            }
        };

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_result) = stream.next().await {
            // Cancelled?
            if !tasks_ref.lock().unwrap().contains(&name) {
                let _ = tokio::fs::remove_file(&dest).await;
                return;
            }
            match chunk_result {
                Ok(data) => {
                    if let Err(e) = file.write_all(&data).await {
                        let _ = app.emit("download_error", (&name, e.to_string()));
                        return;
                    }
                    downloaded += data.len() as u64;
                    // Throttle progress events to ~4/s
                    if last_emit.elapsed() > Duration::from_millis(250) {
                        let pct = if total > 0 {
                            (downloaded as f64 / total as f64 * 100.0) as f32
                        } else { 0.0 };
                        let _ = app.emit("download_progress", (&name, pct));
                        last_emit = std::time::Instant::now();
                    }
                }
                Err(e) => {
                    let _ = app.emit("download_error", (&name, e.to_string()));
                    return;
                }
            }
        }

        tasks_ref.lock().unwrap().retain(|x| x != &name);
        let _ = app.emit("download_complete", &name);
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_model_download(
    model_name: String,
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<(), String> {
    manager.download_tasks.lock().unwrap().retain(|x| x != &model_name);
    Ok(())
}

// ── GPU Config ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_model_gpu_config(
    gpu_layers: i32,
    gpu_backend: String,
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<(), String> {
    *manager.gpu_layers.lock().unwrap() = gpu_layers;
    *manager.gpu_backend.lock().unwrap() = gpu_backend.clone();

    // Persist to config file so it survives restart
    let mut cfg = crate::config::load_config();
    cfg.models.gpu_layers = gpu_layers;
    cfg.models.gpu_backend = gpu_backend;
    crate::config::save_config(&cfg).ok();

    Ok(())
}

#[tauri::command]
pub fn get_model_gpu_config(manager: tauri::State<'_, ActiveModelManager>) -> (i32, String) {
    (
        *manager.gpu_layers.lock().unwrap(),
        manager.gpu_backend.lock().unwrap().clone(),
    )
}

/// Call this once at startup to restore saved GPU config into runtime state.
#[tauri::command]
pub fn init_gpu_from_config(
    manager: tauri::State<'_, ActiveModelManager>,
) -> (i32, String) {
    let cfg = crate::config::load_config();
    let layers = cfg.models.gpu_layers;
    let backend = cfg.models.gpu_backend.clone();
    *manager.gpu_layers.lock().unwrap() = layers;
    *manager.gpu_backend.lock().unwrap() = backend.clone();
    (layers, backend)
}

/// Returns the recommended number of GPU layers for a GGUF model given its size in GB.
/// Logic: estimates ~0.13 GB/layer (rough average for 7B-class models) and fits as many
/// layers as possible into free VRAM, capped at 80. Returns -1 if whole model fits.
/// Returns 0 if no GPU or not enough VRAM (CPU fallback).
#[tauri::command]
pub fn get_vram_recommendation(model_size_gb: f32) -> serde_json::Value {
    let devices = detect_gpu_devices();
    if devices.is_empty() {
        return serde_json::json!({
            "recommended_layers": 0,
            "backend": "cpu",
            "reason": "No GPU detected — running on CPU",
            "fits_fully": false,
        });
    }

    let gpu = &devices[0]; // pick primary GPU
    let free_gb = gpu.vram_free_mb as f32 / 1024.0;
    let total_gb = gpu.vram_total_mb as f32 / 1024.0;

    if free_gb >= model_size_gb {
        // Whole model fits
        return serde_json::json!({
            "recommended_layers": -1,
            "backend": gpu.backend,
            "reason": format!("{} free VRAM — full GPU offload", format!("{:.1} GB", free_gb)),
            "fits_fully": true,
            "vram_free_gb": free_gb,
            "vram_total_gb": total_gb,
        });
    }

    // Partial offload: ~0.13 GB per layer
    let bytes_per_layer_gb: f32 = 0.13;
    let layers_that_fit = (free_gb / bytes_per_layer_gb).floor() as i32;
    let layers = layers_that_fit.clamp(0, 80);

    serde_json::json!({
        "recommended_layers": layers,
        "backend": if layers > 0 { &gpu.backend } else { "cpu" },
        "reason": if layers > 0 {
            format!("Partial offload — {:.1} GB free / {:.1} GB total", free_gb, total_gb)
        } else {
            format!("Only {:.1} GB free VRAM — CPU fallback", free_gb)
        },
        "fits_fully": false,
        "vram_free_gb": free_gb,
        "vram_total_gb": total_gb,
    })
}

/// Returns true if the GPU has at least `required_gb` of free VRAM.
/// Used by Whisper to decide CPU vs GPU.
#[tauri::command]
pub fn check_vram_available(required_gb: f32) -> bool {
    let devices = detect_gpu_devices();
    if devices.is_empty() { return false; }
    let free_gb = devices[0].vram_free_mb as f32 / 1024.0;
    free_gb >= required_gb
}

/// Live GPU status — re-runs nvidia-smi/rocm-smi. Called by frontend poll.
#[tauri::command]
pub fn refresh_gpu_status() -> Vec<GpuDevice> {
    detect_gpu_devices()
}

// ── Real Model Load / Unload via llama-cpp-2 ─────────────────────────────────

#[tauri::command]
pub fn load_active_model(
    model_name: String,
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<(), String> {
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::LlamaModel;

    let model_path = models_dir().join(&model_name);
    if !model_path.exists() {
        return Err(format!("Model file not found: {:?}", model_path));
    }

    let gpu_layers = *manager.gpu_layers.lock().unwrap();

    // Initialise (or reuse) the global llama backend
    {
        let mut backend_lock = manager.llama_backend.lock().unwrap();
        if backend_lock.is_none() {
            let b = LlamaBackend::init().map_err(|e| e.to_string())?;
            *backend_lock = Some(b);
        }
    }

    let backend_lock = manager.llama_backend.lock().unwrap();
    let backend = backend_lock.as_ref().unwrap();

    // GPU layers: -1 means all layers on GPU
    let n_gpu: u32 = if gpu_layers < 0 { u32::MAX } else { gpu_layers as u32 };
    let model_params = LlamaModelParams::default().with_n_gpu_layers(n_gpu);

    let model = LlamaModel::load_from_file(backend, &model_path, &model_params)
        .map_err(|e| e.to_string())?;

    drop(backend_lock);

    *manager.llama_model.lock().unwrap() = Some(model);
    *manager.loaded_model_name.lock().unwrap() = Some(model_name.clone());
    *manager.loaded_model_path.lock().unwrap() = Some(model_path.to_string_lossy().to_string());

    Ok(())
}

#[tauri::command]
pub fn unload_active_model(manager: tauri::State<'_, ActiveModelManager>) -> Result<(), String> {
    *manager.llama_model.lock().unwrap() = None;
    *manager.loaded_model_name.lock().unwrap() = None;
    *manager.loaded_model_path.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn get_loaded_model(manager: tauri::State<'_, ActiveModelManager>) -> Option<String> {
    manager.loaded_model_name.lock().unwrap().clone()
}

// ── Real Text Inference ───────────────────────────────────────────────────────

#[tauri::command]
pub fn run_chat_inference(
    app: AppHandle,
    prompt: String,
    max_tokens: u32,
    temperature: f32,
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<String, String> {
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::model::AddBos;
    use llama_cpp_2::sampling::LlamaSampler;

    let model_lock = manager.llama_model.lock().unwrap();
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let backend_lock = manager.llama_backend.lock().unwrap();
    let backend = backend_lock.as_ref().unwrap();

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(std::num::NonZeroU32::new(4096).unwrap()));

    let mut ctx = model.new_context(backend, ctx_params).map_err(|e| e.to_string())?;

    let tokens = model.str_to_token(&prompt, AddBos::Always).map_err(|e| e.to_string())?;

    let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);
    let last_idx = (tokens.len() - 1) as i32;
    for (i, tok) in tokens.iter().enumerate() {
        batch.add(*tok, i as i32, &[0], i as i32 == last_idx).map_err(|e| e.to_string())?;
    }
    ctx.decode(&mut batch).map_err(|e| e.to_string())?;

    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(temperature),
        LlamaSampler::greedy(),
    ]);

    let mut output = String::new();
    let mut n_cur = tokens.len() as i32;
    // UTF-8 decoder reused across tokens for proper multi-byte character handling
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    loop {
        let token = sampler.sample(&ctx, n_cur - 1);
        sampler.accept(token);

        if model.is_eog_token(token)
            || (max_tokens > 0 && output.split_whitespace().count() >= max_tokens as usize)
        {
            break;
        }

        let piece = model
            .token_to_piece(token, &mut decoder, false, None)
            .map_err(|e| e.to_string())?;
        output.push_str(&piece);

        // Stream each token to the frontend
        let _ = app.emit("inference_token", &piece);

        batch.clear();
        batch.add(token, n_cur, &[0], true).map_err(|e| e.to_string())?;
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        n_cur += 1;
    }

    Ok(output)
}

// ── Whisper STT ───────────────────────────────────────────────────────────────

pub fn whisper_dir() -> PathBuf {
    let cfg = crate::config::load_config();
    if !cfg.storage.root_path.is_empty() {
        PathBuf::from(&cfg.storage.root_path).join("whisper")
    } else {
        crate::config::get_app_install_dir().join("storage").join("whisper")
    }
}

#[tauri::command]
pub fn list_whisper_models() -> Vec<WhisperModelInfo> {
    let dir = whisper_dir();
    let downloaded: std::collections::HashSet<String> = if dir.exists() {
        std::fs::read_dir(&dir).into_iter().flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |x| x == "bin"))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect()
    } else {
        Default::default()
    };

    [("tiny", 75u32), ("base", 145), ("small", 460), ("medium", 1500), ("large-v3", 2900)]
        .iter()
        .map(|(name, size_mb)| WhisperModelInfo {
            name: name.to_string(),
            size_mb: *size_mb,
            is_downloaded: downloaded.contains(&format!("ggml-{}.bin", name)),
        })
        .collect()
}

/// Download a Whisper model from HuggingFace (ggerganov/whisper.cpp).
/// Emits: whisper_download_progress([name, pct]), whisper_download_complete(name),
///        whisper_download_error([name, msg])
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    model_name: String,                           // e.g. "base"
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<(), String> {
    // Guard: don't double-download
    {
        let mut tasks = manager.download_tasks.lock().unwrap();
        let key = format!("whisper-{}", model_name);
        if tasks.contains(&key) { return Err("Download already in progress".into()); }
        tasks.push(key);
    }

    let filename = format!("ggml-{}.bin", model_name);
    let dir = whisper_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&filename);

    // HuggingFace direct URL
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        filename
    );

    let tasks_ref = Arc::clone(&manager.download_tasks);
    let name = model_name.clone();

    tauri::async_runtime::spawn(async move {
        let key = format!("whisper-{}", name);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(7200))
            .build()
            .unwrap();

        let resp = match client.get(&url).header("User-Agent", "Composer/1.0").send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let _ = app.emit("whisper_download_error", (&name, format!("HTTP {}", r.status())));
                tasks_ref.lock().unwrap().retain(|x| x != &key);
                return;
            }
            Err(e) => {
                let _ = app.emit("whisper_download_error", (&name, e.to_string()));
                tasks_ref.lock().unwrap().retain(|x| x != &key);
                return;
            }
        };

        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        let mut file = match tokio::fs::File::create(&dest).await {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit("whisper_download_error", (&name, e.to_string()));
                tasks_ref.lock().unwrap().retain(|x| x != &key);
                return;
            }
        };

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_result) = stream.next().await {
            // Cancelled?
            if !tasks_ref.lock().unwrap().contains(&key) {
                let _ = tokio::fs::remove_file(&dest).await;
                return;
            }
            match chunk_result {
                Ok(data) => {
                    if let Err(e) = file.write_all(&data).await {
                        let _ = app.emit("whisper_download_error", (&name, e.to_string()));
                        tasks_ref.lock().unwrap().retain(|x| x != &key);
                        return;
                    }
                    downloaded += data.len() as u64;
                    if last_emit.elapsed() > Duration::from_millis(250) {
                        let pct = if total > 0 {
                            (downloaded as f64 / total as f64 * 100.0) as f32
                        } else { 0.0 };
                        let _ = app.emit("whisper_download_progress", (&name, pct));
                        last_emit = std::time::Instant::now();
                    }
                }
                Err(e) => {
                    let _ = app.emit("whisper_download_error", (&name, e.to_string()));
                    tasks_ref.lock().unwrap().retain(|x| x != &key);
                    return;
                }
            }
        }

        tasks_ref.lock().unwrap().retain(|x| x != &key);
        let _ = app.emit("whisper_download_complete", &name);
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_whisper_download(
    model_name: String,
    manager: tauri::State<'_, ActiveModelManager>,
) -> Result<(), String> {
    let key = format!("whisper-{}", model_name);
    manager.download_tasks.lock().unwrap().retain(|x| x != &key);
    Ok(())
}

// ── Whisper CLI binary helpers ────────────────────────────────────────────────

fn whisper_binary_path() -> std::path::PathBuf {
    whisper_dir().join("whisper-cli.exe")
}

/// Fast synchronous check — no network, just file system.
#[tauri::command]
pub fn check_whisper_binary() -> bool {
    whisper_binary_path().exists()
}

/// Download and extract the whisper.cpp CLI binary from GitHub releases.
/// Returns immediately with the path if binary is already present.
/// Emits `whisper_engine_status` events: "downloading" | "ready" | "error".
#[tauri::command]
pub async fn download_whisper_binary(app: AppHandle) -> Result<String, String> {
    let bin_path = whisper_binary_path();
    if bin_path.exists() {
        let _ = app.emit("whisper_engine_status", "ready");
        return Ok(bin_path.to_string_lossy().to_string());
    }

    // Try multiple release URLs newest-first
    let urls = [
        "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip",
        "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.3/whisper-bin-x64.zip",
        "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.2/whisper-bin-x64.zip",
        "https://github.com/ggerganov/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip",
    ];

    let _ = app.emit("whisper_engine_status", "downloading");

    let out_dir = whisper_dir();
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let mut last_err = String::from("No URL succeeded");

    for url in &urls {
        let _ = app.emit("whisper_chunk",
            format!("[Engine] Trying {}…", url));

        let resp = match reqwest::get(*url).await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => { last_err = format!("HTTP {}", r.status()); continue; }
            Err(e) => { last_err = e.to_string(); continue; }
        };

        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => { last_err = e.to_string(); continue; }
        };

        // IMPORTANT: use .to_vec() so the Cursor owns the data and implements Seek
        let cursor = std::io::Cursor::new(bytes.to_vec());
        let mut archive = match zip::ZipArchive::new(cursor) {
            Ok(a) => a,
            Err(e) => { last_err = format!("ZIP: {}", e); continue; }
        };

        let mut found_cli = false;
        for i in 0..archive.len() {
            let mut entry = match archive.by_index(i) {
                Ok(e) => e,
                Err(_) => continue,
            };

            // Get just the filename (ignore directory prefix inside the zip)
            let raw_name = entry.name().to_string();
            let fname_lower = std::path::Path::new(&raw_name)
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            // Accept: whisper-cli.exe (new) or main.exe (old) as the CLI binary; any .dll
            let is_cli = fname_lower == "whisper-cli.exe" || fname_lower == "main.exe";
            let is_dll = fname_lower.ends_with(".dll");

            if !is_cli && !is_dll { continue; }

            // Always save as whisper-cli.exe so the rest of the code finds it
            let dest_name = if is_cli { "whisper-cli.exe".to_string() } else { fname_lower.clone() };
            let dest = out_dir.join(&dest_name);
            match std::fs::File::create(&dest) {
                Ok(mut f) => { std::io::copy(&mut entry, &mut f).ok(); }
                Err(e) => { last_err = format!("Write error: {}", e); continue; }
            }
            if is_cli { found_cli = true; }
        }

        if found_cli {
            let _ = app.emit("whisper_engine_status", "ready");
            let _ = app.emit("whisper_chunk", "[Engine] whisper-cli.exe ready ✓");
            return Ok(bin_path.to_string_lossy().to_string());
        }

        last_err = "No CLI executable found in archive".to_string();
    }

    let err = format!("[Engine] Download failed: {}", last_err);
    let _ = app.emit("whisper_engine_status", "error");
    let _ = app.emit("whisper_chunk", &err);
    Err(err)
}

/// Pure-Rust WAV writer — no external crate needed.
/// Accepts f32 PCM samples already at 16kHz mono (from Web Audio API).
#[tauri::command]
pub fn save_wav_audio(samples: Vec<f32>) -> Result<String, String> {
    use std::io::Write;
    let path = std::env::temp_dir().join("composer_audio_16k.wav");
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;

    let sample_rate: u32 = 16000;
    let channels: u16 = 1;
    let bits: u16 = 16;
    let data_size = (samples.len() * 2) as u32;
    let byte_rate = sample_rate * channels as u32 * bits as u32 / 8;

    // RIFF header
    f.write_all(b"RIFF").ok();
    f.write_all(&(36 + data_size).to_le_bytes()).ok();
    f.write_all(b"WAVE").ok();
    // fmt chunk
    f.write_all(b"fmt ").ok();
    f.write_all(&16u32.to_le_bytes()).ok();   // chunk size
    f.write_all(&1u16.to_le_bytes()).ok();    // PCM
    f.write_all(&channels.to_le_bytes()).ok();
    f.write_all(&sample_rate.to_le_bytes()).ok();
    f.write_all(&byte_rate.to_le_bytes()).ok();
    f.write_all(&(channels * bits / 8).to_le_bytes()).ok(); // block align
    f.write_all(&bits.to_le_bytes()).ok();
    // data chunk
    f.write_all(b"data").ok();
    f.write_all(&data_size.to_le_bytes()).ok();
    for &s in &samples {
        let s16 = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        f.write_all(&s16.to_le_bytes()).ok();
    }

    Ok(path.to_string_lossy().to_string())
}

/// Transcribe a WAV file using the whisper.cpp CLI binary.
/// Streams text back via whisper_chunk events so the textarea fills in real time.
#[tauri::command]
pub fn run_whisper_transcription(
    app: AppHandle,
    audio_path: String,
) -> Result<String, String> {
    let bin = whisper_binary_path();
    if !bin.exists() {
        let msg = format!(
            "[Whisper] Binary not found at {}. Click 'Download Whisper Engine' in System → Whisper STT.",
            bin.display()
        );
        let _ = app.emit("whisper_chunk", &msg);
        return Err(msg);
    }

    let cfg = crate::config::load_config();
    let model_file = format!("ggml-{}.bin", cfg.voice.active_whisper_model);
    let model_path = whisper_dir().join(&model_file);

    if !model_path.exists() {
        let msg = format!(
            "[Whisper] Model not found: {}. Download whisper-{} in System settings.",
            model_path.display(), cfg.voice.active_whisper_model
        );
        let _ = app.emit("whisper_chunk", &msg);
        return Err(msg);
    }

    if !std::path::Path::new(&audio_path).exists() {
        let _ = app.emit("whisper_chunk", "[Whisper Error] Audio file not found.");
        return Err("Audio file not found".to_string());
    }

    // Run whisper-cli.exe -m {model} -f {wav} --no-timestamps -l en
    let output = std::process::Command::new(&bin)
        .args([
            "-m", &model_path.to_string_lossy(),
            "-f", &audio_path,
            "--no-timestamps",
            "-l", "en",
            "--output-txt",
        ])
        .output()
        .map_err(|e| format!("Failed to run whisper binary: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err = format!("[Whisper Error] {}", stderr.trim());
        let _ = app.emit("whisper_chunk", &err);
        return Err(err);
    }

    // Split on newlines and emit each segment separately for streaming feel
    let mut full_text = String::new();
    for line in stdout.lines() {
        let line = line.trim();
        // Skip blank lines and whisper's own log output (starts with '[')
        if line.is_empty() || line.starts_with('[') { continue; }
        let chunk = if full_text.is_empty() { line.to_string() } else { format!(" {}", line) };
        let _ = app.emit("whisper_chunk", &chunk);
        full_text.push_str(&chunk);
    }

    Ok(full_text)
}
