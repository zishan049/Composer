import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  HardDrive,
  FolderOpen,
  CheckCircle2,
  ArrowRight,
  FolderCheck,
} from "lucide-react";
import { AppConfig } from "../types";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface OnboardingProps {
  config: AppConfig;
  installPath: string;
  cachePath: string;
  /** Called after user completes all steps — parent updates config & transitions */
  onComplete: (updatedConfig: AppConfig) => void;
}

// ─────────────────────────────────────────────
// Step dots
// ─────────────────────────────────────────────
const TOTAL_STEPS = 4; // Welcome | Storage | Workspace | Done

function StepDots({ current }: { current: number }) {
  return (
    <div className="ob-dots">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
        const cls =
          i < current ? "ob-dot done" : i === current ? "ob-dot active" : "ob-dot";
        return <div key={i} className={cls} />;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Step 0 — Welcome
// ─────────────────────────────────────────────
function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="ob-step">
      <StepDots current={0} />
      <div className="ob-icon ob-icon--app">
        <img src="/icon.ico" alt="Composer" draggable={false} style={{ width: 70, height: 70, objectFit: "contain" }} />
      </div>
      <p className="ob-step-badge">Step 1 of 4</p>
      <h1 className="ob-title">Welcome to Composer</h1>
      <p className="ob-subtitle">
        Your focused workspace for writing, editing, and organising documents.
        Let's take a moment to get everything set up perfectly for you.
      </p>
      <div className="ob-footer">
        <button className="ob-btn-primary" onClick={onNext}>
          Get started <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Step 1 — Storage
// ─────────────────────────────────────────────
function StepStorage({
  installPath,
  cachePath,
  onNext,
}: {
  installPath: string;
  cachePath: string;
  onNext: () => void;
}) {
  return (
    <div className="ob-step">
      <StepDots current={1} />
      <div className="ob-icon">
        <HardDrive size={22} />
      </div>
      <p className="ob-step-badge">Step 2 of 4</p>
      <h1 className="ob-title">Where Composer Lives</h1>
      <p className="ob-subtitle">
        Here's where the app and its files are installed on your system. You can
        always find these paths later in Settings → Storage.
      </p>

      <div className="ob-info-box">
        <div className="ob-info-row">
          <span className="ob-info-label">Application directory</span>
          <span className="ob-info-value">{installPath || "Detecting…"}</span>
        </div>
        <div className="ob-info-row">
          <span className="ob-info-label">Cache &amp; temporary files</span>
          <span className="ob-info-value">{cachePath || "Detecting…"}</span>
        </div>
      </div>

      <div className="ob-footer">
        <button className="ob-btn-primary" onClick={onNext}>
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Step 2 — Workspace
// ─────────────────────────────────────────────
function StepWorkspace({
  onNext,
  onWorkspaceSelected,
}: {
  onNext: (path: string) => void;
  onWorkspaceSelected: (path: string) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    try {
      setPicking(true);
      const chosen: string | null = await invoke("pick_directory");
      if (chosen) {
        setSelectedPath(chosen);
        onWorkspaceSelected(chosen);
      }
    } catch (err) {
      console.error("Failed to pick directory:", err);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="ob-step">
      <StepDots current={2} />
      <div className="ob-icon">
        <FolderOpen size={22} />
      </div>
      <p className="ob-step-badge">Step 3 of 4</p>
      <h1 className="ob-title">Choose Your Workspace</h1>
      <p className="ob-subtitle">
        Select the folder on your PC where Composer will look for your
        documents, projects, and files. You can change this at any time in
        Settings.
      </p>

      <div className="ob-workspace-picker">
        <button className="ob-pick-btn" onClick={handlePick} disabled={picking}>
          <FolderOpen size={16} className="ob-pick-icon" />
          {picking
            ? "Opening folder picker…"
            : selectedPath
            ? "Change workspace folder"
            : "Browse and select a folder"}
        </button>

        {selectedPath && (
          <div className="ob-picked-path">
            <CheckCircle2 size={14} className="ob-picked-check" />
            <span>{selectedPath}</span>
          </div>
        )}
      </div>

      <div className="ob-footer">
        <button
          className="ob-btn-primary"
          onClick={() => onNext(selectedPath)}
          disabled={!selectedPath}
        >
          <FolderCheck size={14} />
          Set workspace
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Step 3 — Done
// ─────────────────────────────────────────────
function StepDone({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="ob-step">
      <StepDots current={3} />
      <div className="ob-done-graphic">
        <CheckCircle2 size={26} />
      </div>
      <p className="ob-step-badge">All done!</p>
      <h1 className="ob-title">You're all set </h1>
      <p className="ob-subtitle">
        Composer is configured and ready to go. Your workspace is saved — dive
        in whenever you're ready.
      </p>
      <div className="ob-footer">
        <button className="ob-btn-primary" onClick={onFinish}>
          Open Composer <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Root Onboarding Component
// ─────────────────────────────────────────────
export function Onboarding({
  config,
  installPath,
  cachePath,
  onComplete,
}: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [workspacePath, setWorkspacePath] = useState("");

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));

  const handleWorkspaceNext = (path: string) => {
    setWorkspacePath(path);
    setStep(3);
  };

  const handleFinish = async () => {
    try {
      const updatedConfig: AppConfig = {
        ...config,
        general: {
          ...config.general,
          onboarding_completed: true,
        },
        storage: {
          ...config.storage,
          workspace_path: workspacePath,
        },
      };
      await invoke("save_app_config", { config: updatedConfig });
      onComplete(updatedConfig);
    } catch (err) {
      console.error("Failed to save onboarding config:", err);
      // Still proceed — don't block the user
      onComplete({
        ...config,
        general: { ...config.general, onboarding_completed: true },
        storage: { ...config.storage, workspace_path: workspacePath },
      });
    }
  };

  return (
    <div className="ob-backdrop">
      <div className="ob-card">
        {step === 0 && <StepWelcome onNext={goNext} />}
        {step === 1 && (
          <StepStorage
            installPath={installPath}
            cachePath={cachePath}
            onNext={goNext}
          />
        )}
        {step === 2 && (
          <StepWorkspace
            onNext={handleWorkspaceNext}
            onWorkspaceSelected={setWorkspacePath}
          />
        )}
        {step === 3 && <StepDone onFinish={handleFinish} />}
      </div>
    </div>
  );
}
