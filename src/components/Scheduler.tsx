// @ts-nocheck
import React, { useState, useEffect } from "react";
import { Plus, ToggleLeft, ToggleRight, Search, Play, Save, History, Check, AlertCircle, Terminal, ChevronDown, Edit } from "lucide-react";
import Editor from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ScheduledTask } from "../types";
import { useCustomContextMenu } from "./ContextMenu";

export const Scheduler: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [activeTask, setActiveTask] = useState<ScheduledTask | null>(null);
  
  // View states
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isRawTomlView, setIsRawTomlView] = useState<boolean>(false);
  const [tomlContent, setTomlContent] = useState<string>("");
  const [isModified, setIsModified] = useState<boolean>(false);
  
  // Execution logs drawer
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);
  const [taskLogs, setTaskLogs] = useState<string>("Select a task and click Run Now to check execution logs...");

  const { showContextMenu, ContextMenuComponent } = useCustomContextMenu();

  // Load scheduler tasks
  const loadTasks = async () => {
    try {
      const res: ScheduledTask[] = await invoke("load_scheduler_tasks");
      setTasks(res);
      if (res.length > 0 && !activeTask) {
        setActiveTask(res[0]);
        syncToml(res[0]);
        loadTaskLogs(res[0].task.id);
      }
    } catch(err) {
      console.error(err);
    }
  };

  const loadTaskLogs = async (id: string) => {
    try {
      const logs: string = await invoke("get_task_run_logs", { id });
      setTaskLogs(logs);
    } catch(e) {
      setTaskLogs("No logs available yet for this task.");
    }
  };

  const activeTaskRef = React.useRef(activeTask);
  useEffect(() => {
    activeTaskRef.current = activeTask;
  }, [activeTask]);

  useEffect(() => {
    loadTasks();

    // Listen to background scheduler hot reloads
    const unsub = listen("tasks_updated", () => {
      loadTasks();
      if (activeTaskRef.current) {
        loadTaskLogs(activeTaskRef.current.task.id);
      }
    });

    return () => {
      unsub.then(fn => fn());
    };
  }, []);

  const syncToml = (task: ScheduledTask) => {
    const tomlStr = `[task]
id = "${task.task.id}"
name = "${task.task.name}"
description = "${task.task.description}"
type = "app"
enabled = ${task.task.enabled}
created_at = "${task.task.created_at}"
last_run = "${task.task.last_run}"
last_status = "${task.task.last_status}"

[schedule]
frequency = "${task.schedule.frequency}"
run_at = "${task.schedule.run_at}"
cron = "${task.schedule.cron}"
human_readable = "${task.schedule.human_readable}"
event = "${task.schedule.event}"

[action]
operation = "${task.action.operation || "backup"}"
source_path = "${task.action.source_path || ""}"
destination_path = "${task.action.destination_path || ""}"

[notifications]
on_start = ${task.notifications.on_start}
on_complete = ${task.notifications.on_complete}
on_fail = ${task.notifications.on_fail}
include_result_preview = ${task.notifications.include_result_preview}`;
    setTomlContent(tomlStr);
    setIsModified(false);
  };

  const handleSelectTask = (task: ScheduledTask) => {
    setActiveTask(task);
    syncToml(task);
    loadTaskLogs(task.task.id);
  };

  const handleToggleTaskEnabled = async (task: ScheduledTask, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = {
      ...task,
      task: { ...task.task, enabled: !task.task.enabled }
    };
    await invoke("save_scheduler_task", { task: updated });
    loadTasks();
  };

  const createNewTask = () => {
    const newTask: ScheduledTask = {
      task: {
        id: "task-" + Math.random().toString(36).substring(2, 9),
        name: "Workspace Backup " + (tasks.length + 1),
        description: "Executes automated workspace backup inside destination folder.",
        type: "app",
        enabled: true,
        created_at: new Date().toISOString(),
        last_run: "",
        last_status: "never",
      },
      schedule: {
        frequency: "recurring",
        run_at: "",
        cron: "0 9 * * 1",
        human_readable: "Every Monday at 09:00",
        event: "app_launch",
      },
      action: {
        operation: "backup",
        source_path: "",
        destination_path: "",
      },
      notifications: {
        on_start: false,
        on_complete: true,
        on_fail: true,
        include_result_preview: true,
      }
    };
    setActiveTask(newTask);
    syncToml(newTask);
    setTasks([...tasks, newTask]);
  };

  const saveActiveTask = async () => {
    if (!activeTask) return;
    try {
      await invoke("save_scheduler_task", { task: activeTask });
      setIsModified(false);
      loadTasks();
      alert("Task saved successfully.");
    } catch(err) {
      alert(err);
    }
  };

  const handleFormChange = (section: string, field: string, value: any) => {
    if (!activeTask) return;
    const updated = {
      ...activeTask,
      [section]: {
        ...(activeTask as any)[section],
        [field]: value
      }
    };
    setActiveTask(updated);
    setIsModified(true);
    syncToml(updated);
  };

  const handleRawTomlChange = (val: string | undefined) => {
    if (val === undefined) return;
    setTomlContent(val);
    setIsModified(true);
  };

  const triggerTaskNow = async () => {
    if (!activeTask) return;
    try {
      setShowLogsDrawer(true);
      setTaskLogs("Triggering background scheduler execution stream...\n");
      await invoke("run_task_now", { id: activeTask.task.id });
      setTimeout(() => loadTaskLogs(activeTask.task.id), 1500);
    } catch (e) {
      alert(e);
    }
  };

  const deleteActiveTask = async () => {
    if (!activeTask) return;
    if (confirm(`Delete automated task ${activeTask.task.name}?`)) {
      try {
        await invoke("delete_scheduler_task", { id: activeTask.task.id });
        setActiveTask(null);
        loadTasks();
      } catch (err) {
        alert(err);
      }
    }
  };

  const handleCardRightClick = (e: React.MouseEvent, t: ScheduledTask) => {
    showContextMenu(e, [
      { label: `Open Config`, icon: <Edit size={13} />, onClick: () => handleSelectTask(t) },
      { label: `Run Instantly`, icon: <Play size={13} />, onClick: () => {
          setActiveTask(t);
          triggerTaskNow();
        }
      },
      { label: t.task.enabled ? "Disable" : "Enable", onClick: () => handleToggleTaskEnabled(t, { stopPropagation: () => {} } as any) },
      { label: "", isSeparator: true },
      { label: "Delete automation", onClick: () => deleteActiveTask() }
    ]);
  };

  const handleBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "New Automation Task", icon: <Plus size={13} />, onClick: createNewTask },
      { label: "", isSeparator: true },
      { label: "Refresh Triggers", onClick: loadTasks }
    ]);
  };

  return (
    <div 
      onContextMenu={handleBlankRightClick}
      className="flex h-full font-serif-text text-ink bg-paper divide-x divide-rule"
    >
      {/* Automations List Left */}
      <div className="w-64 flex flex-col h-full bg-cream/30 select-none divide-y divide-rule font-sans-meta text-xs">
        <div className="p-3.5 flex items-center justify-between">
          <span className="kicker">Scheduler</span>
          <button 
            onClick={createNewTask}
            className="p-1 hover:bg-cream text-accent transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="p-2 flex items-center gap-1.5 bg-paper">
          <Search size={12} className="text-muted" />
          <input
            type="text"
            placeholder="Search triggers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-[11px] outline-none placeholder-muted/60"
          />
        </div>

        {/* Task Cards */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
          {tasks
            .filter((t) => t.task.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((t) => (
              <div
                key={t.task.id}
                onClick={() => handleSelectTask(t)}
                onContextMenu={(e) => handleCardRightClick(e, t)}
                className={`p-3 rounded-sm border cursor-pointer flex flex-col gap-1 transition-all
                  ${activeTask?.task.id === t.task.id 
                    ? "bg-paper border-accent shadow-sm animate-in fade-in duration-100" 
                    : "bg-cream/45 border-rule/30 hover:border-rule text-ink/75"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold truncate text-[13px]">{t.task.name}</span>
                  <button 
                    onClick={(e) => handleToggleTaskEnabled(t, e)}
                    className="text-muted hover:text-accent transition-colors"
                  >
                    {t.task.enabled ? <ToggleRight size={18} className="text-accent" /> : <ToggleLeft size={18} />}
                  </button>
                </div>
                <p className="text-[10px] text-muted line-clamp-2 leading-relaxed">{t.task.description}</p>
                
                <div className="flex justify-between items-center text-[9px] mt-2 font-bold uppercase text-muted">
                  <span className="flex items-center gap-1">
                    {t.task.last_status === "success" ? (
                      <Check size={11} className="text-accent" />
                    ) : t.task.last_status === "failed" ? (
                      <AlertCircle size={11} className="text-red-700" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-muted/60" />
                    )}
                    <span>{t.task.last_status}</span>
                  </span>
                  <span>{t.schedule.frequency}</span>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Configuration Right panel */}
      {activeTask ? (
        <div className="flex-1 flex flex-col h-full bg-paper divide-y divide-rule overflow-hidden">
          {/* Header controls toolbar */}
          <div className="px-4 py-2 bg-cream/10 border-b border-rule flex items-center justify-between font-sans-meta text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-ink uppercase tracking-wider">{activeTask.task.name}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="text-muted text-[10px] uppercase">{activeTask.action.operation || "operation"}</span>
            </div>

            <div className="flex items-center gap-2.5">
              <button 
                onClick={triggerTaskNow}
                className="px-2.5 py-0.5 bg-ink hover:bg-accent text-paper font-bold uppercase tracking-wider text-[9px] flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Play size={10} />
                <span>Run Now</span>
              </button>

              {isModified && (
                <button 
                  onClick={saveActiveTask}
                  className="px-2.5 py-0.5 bg-accent hover:bg-accent/90 text-paper font-bold uppercase tracking-wider text-[9px] flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Save size={10} />
                  <span>Save Task</span>
                </button>
              )}

              {/* View Toggle */}
              <div className="flex bg-cream rounded-sm p-0.5 border border-rule/50 font-bold uppercase text-[9px]">
                <button
                  onClick={() => setIsRawTomlView(false)}
                  className={`px-2 py-0.5 rounded-sm transition-all cursor-pointer
                    ${!isRawTomlView ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
                >
                  Form
                </button>
                <button
                  onClick={() => setIsRawTomlView(true)}
                  className={`px-2 py-0.5 rounded-sm transition-all cursor-pointer
                    ${isRawTomlView ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
                >
                  Raw TOML
                </button>
              </div>
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex-1 overflow-hidden flex flex-col relative select-text">
            <div className="flex-1 overflow-y-auto">
              {isRawTomlView ? (
                <div className="w-full h-full relative font-mono text-xs select-text">
                  <Editor
                    height="100%"
                    defaultLanguage="ini"
                    theme="vs-light"
                    value={tomlContent}
                    onChange={handleRawTomlChange}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: "JetBrains Mono, monospace",
                      scrollbar: {
                        verticalScrollbarSize: 6,
                        horizontalScrollbarSize: 6
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="w-full p-6 font-sans-meta text-xs space-y-6 max-w-xl">
                  {/* Task Metadata */}
                  <div className="space-y-3.5">
                    <span className="kicker">General definition</span>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="font-bold text-[10px] uppercase text-muted">Task Name</label>
                        <input 
                          type="text" 
                          value={activeTask.task.name} 
                          onChange={(e) => handleFormChange("task", "name", e.target.value)}
                          className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="font-bold text-[10px] uppercase text-muted">Operation Type</label>
                        <select
                          value={activeTask.action.operation || "backup"}
                          onChange={(e) => handleFormChange("action", "operation", e.target.value)}
                          className="p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none focus:border-accent cursor-pointer"
                        >
                          <option value="backup">Workspace Backup</option>
                          <option value="cleanup">Temporary Files Cleanup</option>
                          <option value="export">Workspace Export</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Description</label>
                      <textarea 
                        rows={2}
                        value={activeTask.task.description} 
                        onChange={(e) => handleFormChange("task", "description", e.target.value)}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent resize-none"
                      />
                    </div>
                  </div>

                  {/* Schedule rules */}
                  <div className="space-y-3.5 pt-4 border-t border-light-rule">
                    <span className="kicker">Schedule triggers</span>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="font-bold text-[10px] uppercase text-muted">Trigger Frequency</label>
                        <select
                          value={activeTask.schedule.frequency}
                          onChange={(e) => handleFormChange("schedule", "frequency", e.target.value)}
                          className="p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none focus:border-accent cursor-pointer"
                        >
                          <option value="recurring">Recurring Cron Job</option>
                          <option value="once">Run Once</option>
                          <option value="on_event">On System Event</option>
                        </select>
                      </div>

                      {activeTask.schedule.frequency === "recurring" && (
                        <div className="flex flex-col gap-1.5">
                          <label className="font-bold text-[10px] uppercase text-muted">Cron string (evaluated locally)</label>
                          <input 
                            type="text" 
                            value={activeTask.schedule.cron} 
                            onChange={(e) => handleFormChange("schedule", "cron", e.target.value)}
                            className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent font-mono text-[11px]"
                            placeholder="0 9 * * 1"
                          />
                        </div>
                      )}

                      {activeTask.schedule.frequency === "once" && (
                        <div className="flex flex-col gap-1.5">
                          <label className="font-bold text-[10px] uppercase text-muted">Execution DateTime (ISO format)</label>
                          <input 
                            type="text" 
                            value={activeTask.schedule.run_at} 
                            onChange={(e) => handleFormChange("schedule", "run_at", e.target.value)}
                            className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                            placeholder="2026-06-01T14:30:00"
                          />
                        </div>
                      )}

                      {activeTask.schedule.frequency === "on_event" && (
                        <div className="flex flex-col gap-1.5">
                          <label className="font-bold text-[10px] uppercase text-muted">System Event Type</label>
                          <select
                            value={activeTask.schedule.event}
                            onChange={(e) => handleFormChange("schedule", "event", e.target.value)}
                            className="p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none focus:border-accent cursor-pointer"
                          >
                            <option value="app_launch">Application Startup</option>
                            <option value="file_created">New Workspace File created</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-3.5 pt-4 border-t border-light-rule">
                    <span className="kicker">Action destination</span>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Backup Destination Folder (Optional)</label>
                      <input 
                        type="text" 
                        value={activeTask.action.destination_path || ""} 
                        onChange={(e) => handleFormChange("action", "destination_path", e.target.value)}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent font-mono text-[10.5px]"
                        placeholder="Default: storage_backup in app root"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Execution logs bottom drawer */}
            <div className="bg-cream/15 border-t border-rule flex flex-col font-sans-meta">
              <div 
                onClick={() => setShowLogsDrawer(!showLogsDrawer)}
                className="px-4 py-2 bg-cream/35 flex items-center justify-between cursor-pointer hover:bg-cream/50 select-none text-[10px] font-bold uppercase tracking-wider text-accent"
              >
                <span className="flex items-center gap-1.5">
                  <Terminal size={11} />
                  <span>Daemon Console execution logs</span>
                </span>
                <ChevronDown size={12} className={`transition-all ${showLogsDrawer ? "" : "rotate-180"}`} />
              </div>
              
              {showLogsDrawer && (
                <div className="h-44 overflow-y-auto bg-ink p-4 font-mono text-[10px] text-green-500 whitespace-pre-wrap select-text leading-relaxed">
                  {taskLogs}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted/50 select-none">
          <History size={36} className="text-cream mb-4" />
          <span className="font-serif-display text-3xl italic font-bold text-ink/75 mb-2">Automated Tasks</span>
          <p className="font-sans-meta text-xs max-w-sm">
            Schedule recurring cron backups and workspace maintenance operations to run locally.
          </p>
        </div>
      )}

      {ContextMenuComponent}
    </div>
  );
};
