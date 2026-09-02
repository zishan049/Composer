import React, { useState, useEffect } from "react";
import { Plus, ToggleLeft, ToggleRight, Search, FileCode, Check, Save, FileUp, Sparkles, Code, FileText, Trash2, Edit } from "lucide-react";
import Editor from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { SkillDetails } from "../types";
import { useCustomContextMenu } from "./ContextMenu";

export const Skills: React.FC = () => {
  const [skills, setSkills] = useState<SkillDetails[]>([]);
  const [activeSkill, setActiveSkill] = useState<SkillDetails | null>(null);
  
  // Search
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // Editor view modes
  const [isRawTomlView, setIsRawTomlView] = useState<boolean>(false);
  const [tomlContent, setTomlContent] = useState<string>("");
  const [isModified, setIsModified] = useState<boolean>(false);

  const { showContextMenu, ContextMenuComponent } = useCustomContextMenu();

  // Load skills
  const loadSkills = async () => {
    try {
      const res: SkillDetails[] = await invoke("load_skills_list");
      setSkills(res);
      if (res.length > 0 && !activeSkill) {
        setActiveSkill(res[0]);
        syncToml(res[0]);
      }
    } catch(err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const syncToml = (skill: SkillDetails) => {
    const tomlStr = `[skill]
name = "${skill.skill.name}"
description = "${skill.skill.description}"
version = "${skill.skill.version}"
author = "${skill.skill.author}"
enabled = ${skill.skill.enabled}

[scope]
type = "${skill.scope.type}"
file_types = ${JSON.stringify(skill.scope.file_types || [])}

[behavior]
system_prompt = """
${skill.behavior.system_prompt}
"""
temperature = ${skill.behavior.temperature}
max_tokens = ${skill.behavior.max_tokens}
response_format = "${skill.behavior.response_format}"

[memory]
use_long_term = ${skill.memory.use_long_term}
inject_relevant_memories = ${skill.memory.inject_relevant_memories}

[triggers]
auto_activate_on_file_open = ${skill.triggers.auto_activate_on_file_open}
auto_activate_on_chat_start = ${skill.triggers.auto_activate_on_chat_start}`;
    setTomlContent(tomlStr);
    setIsModified(false);
  };

  const handleSelectSkill = (skill: SkillDetails) => {
    setActiveSkill(skill);
    syncToml(skill);
  };

  const toggleSkillEnabled = async (skill: SkillDetails, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = {
      ...skill,
      skill: { ...skill.skill, enabled: !skill.skill.enabled }
    };
    await invoke("save_skill_details", { skill: updated });
    if (activeSkill?.skill.name === skill.skill.name) {
      setActiveSkill(updated);
    }
    loadSkills();
  };

  const createNewSkill = () => {
    const newSkill: SkillDetails = {
      skill: {
        name: "Custom Architect " + (skills.length + 1),
        description: "Applies specialized structural and review prompts.",
        version: "1.0.0",
        author: "user",
        enabled: true,
      },
      scope: {
        type: "global",
        file_types: [],
      },
      behavior: {
        system_prompt: "You are an expert systems architect. Design minimal, high-density workflows with clear hierarchies.",
        temperature: 0.5,
        max_tokens: 1024,
        response_format: "markdown",
      },
      memory: { use_long_term: true, inject_relevant_memories: true },
      triggers: { auto_activate_on_file_open: false, auto_activate_on_chat_start: true }
    };
    
    setActiveSkill(newSkill);
    syncToml(newSkill);
    setSkills([...skills, newSkill]);
  };

  const saveActiveSkill = async () => {
    if (!activeSkill) return;
    try {
      if (isRawTomlView) {
        // Parse from TOML string (mock parsing, just save back parsed representation)
        await invoke("save_skill_details", { skill: activeSkill });
      } else {
        await invoke("save_skill_details", { skill: activeSkill });
      }
      setIsModified(false);
      loadSkills();
      alert("Skill saved successfully.");
    } catch(err) {
      alert("Failed to save skill: " + err);
    }
  };

  const handleFormChange = (section: string, field: string, value: any) => {
    if (!activeSkill) return;
    const updated = {
      ...activeSkill,
      [section]: {
        ...(activeSkill as any)[section],
        [field]: value
      }
    };
    setActiveSkill(updated);
    setIsModified(true);
    // sync back to raw TOML string
    syncToml(updated);
  };

  const handleRawTomlChange = (val: string | undefined) => {
    if (val === undefined) return;
    setTomlContent(val);
    setIsModified(true);
  };

  const deleteActiveSkill = async () => {
    if (!activeSkill || activeSkill.skill.author === "system") return;
    if (confirm(`Delete skill ${activeSkill.skill.name}?`)) {
      try {
        await invoke("delete_skill_details", { name: activeSkill.skill.name });
        setActiveSkill(null);
        loadSkills();
      } catch (err) {
        alert(err);
      }
    }
  };

  const handleCardRightClick = (e: React.MouseEvent, skill: SkillDetails) => {
    showContextMenu(e, [
      { label: `Open ${skill.skill.name}`, icon: <Edit size={13} />, onClick: () => handleSelectSkill(skill) },
      { label: skill.skill.enabled ? "Disable" : "Enable", onClick: () => toggleSkillEnabled(skill, { stopPropagation: () => {} } as any) },
      { label: "", isSeparator: true },
      { label: "Delete Skill", icon: <Trash2 size={13} />, disabled: skill.skill.author === "system", onClick: () => deleteActiveSkill() }
    ]);
  };

  const handleBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "New AI Skill Template", icon: <Plus size={13} />, onClick: createNewSkill },
      { label: "", isSeparator: true },
      { label: "Refresh Template Index", onClick: loadSkills }
    ]);
  };

  return (
    <div 
      onContextMenu={handleBlankRightClick}
      className="flex h-full font-serif-text text-ink bg-paper divide-x divide-rule"
    >
      {/* Skill List Left */}
      <div className="w-64 flex flex-col h-full bg-cream/30 select-none divide-y divide-rule font-sans-meta text-xs">
        <div className="p-3.5 flex items-center justify-between">
          <span className="kicker">AI Skills</span>
          <button 
            onClick={createNewSkill}
            className="p-1 hover:bg-cream text-accent transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Filter Search */}
        <div className="p-2 flex items-center gap-1.5 bg-paper">
          <Search size={12} className="text-muted" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-[11px] outline-none placeholder-muted/60"
          />
        </div>

        {/* Cards container */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
          {skills
            .filter((s) => s.skill.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((s) => (
              <div
                key={s.skill.name}
                onClick={() => handleSelectSkill(s)}
                onContextMenu={(e) => handleCardRightClick(e, s)}
                className={`p-3 rounded-sm border cursor-pointer flex flex-col gap-1 transition-all
                  ${activeSkill?.skill.name === s.skill.name 
                    ? "bg-paper border-accent shadow-sm" 
                    : "bg-cream/45 border-rule/30 hover:border-rule text-ink/75"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold truncate text-[13px]">{s.skill.name}</span>
                  <button 
                    onClick={(e) => toggleSkillEnabled(s, e)}
                    className="text-muted hover:text-accent transition-colors"
                  >
                    {s.skill.enabled ? <ToggleRight size={18} className="text-accent" /> : <ToggleLeft size={18} />}
                  </button>
                </div>
                <p className="text-[10px] text-muted line-clamp-2 leading-relaxed">{s.skill.description}</p>
                <div className="flex justify-between items-center text-[9px] mt-1.5 font-bold uppercase text-accent/90">
                  <span>Scope: {s.scope.type}</span>
                  {s.skill.author === "system" && <span className="bg-muted/15 px-1 py-0.5 text-muted">System</span>}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Editor Panel Right */}
      {activeSkill ? (
        <div className="flex-1 flex flex-col h-full bg-paper divide-y divide-rule">
          {/* Header toolbar */}
          <div className="px-4 py-2 bg-cream/10 border-b border-rule flex items-center justify-between font-sans-meta text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-ink uppercase tracking-wider">{activeSkill.skill.name}</span>
              <span className="text-muted text-[10px]">by {activeSkill.skill.author}</span>
            </div>

            <div className="flex items-center gap-2.5">
              {isModified && (
                <button 
                  onClick={saveActiveSkill}
                  className="px-2.5 py-0.5 bg-accent hover:bg-accent/90 text-paper font-bold uppercase tracking-wider text-[9px] flex items-center gap-1.5 transition-all"
                >
                  <Save size={10} />
                  <span>Save Changes</span>
                </button>
              )}

              {activeSkill.skill.author !== "system" && (
                <button 
                  onClick={deleteActiveSkill}
                  className="p-1 hover:bg-cream text-muted hover:text-red-700 transition-colors"
                  title="Delete Skill"
                >
                  <Trash2 size={13} />
                </button>
              )}

              {/* View Toggle */}
              <div className="flex bg-cream rounded-sm p-0.5 border border-rule/50 font-bold uppercase text-[9px]">
                <button
                  onClick={() => setIsRawTomlView(false)}
                  className={`px-2 py-0.5 rounded-sm transition-all
                    ${!isRawTomlView ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
                >
                  Form
                </button>
                <button
                  onClick={() => setIsRawTomlView(true)}
                  className={`px-2 py-0.5 rounded-sm transition-all
                    ${isRawTomlView ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
                >
                  Raw TOML
                </button>
              </div>
            </div>
          </div>

          {/* Main workspace editor */}
          <div className="flex-1 overflow-hidden select-text">
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
                    fontFamily: "JetBrains Mono, Courier New, monospace",
                    scrollbar: {
                      verticalScrollbarSize: 6,
                      horizontalScrollbarSize: 6
                    }
                  }}
                />
              </div>
            ) : (
              <div className="w-full h-full overflow-y-auto p-6 font-sans-meta text-xs space-y-6 max-w-xl">
                {/* Section: Metadata */}
                <div className="space-y-3.5">
                  <span className="kicker">Metadata parameters</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Skill Name</label>
                      <input 
                        type="text" 
                        value={activeSkill.skill.name} 
                        onChange={(e) => handleFormChange("skill", "name", e.target.value)}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                        disabled={activeSkill.skill.author === "system"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Version</label>
                      <input 
                        type="text" 
                        value={activeSkill.skill.version} 
                        onChange={(e) => handleFormChange("skill", "version", e.target.value)}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                        disabled={activeSkill.skill.author === "system"}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-bold text-[10px] uppercase text-muted">Description</label>
                    <textarea 
                      rows={2}
                      value={activeSkill.skill.description} 
                      onChange={(e) => handleFormChange("skill", "description", e.target.value)}
                      className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent resize-none"
                      disabled={activeSkill.skill.author === "system"}
                    />
                  </div>
                </div>

                {/* Section: Scope */}
                <div className="space-y-3.5 pt-4 border-t border-light-rule">
                  <span className="kicker">Scope Triggers</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Scope Type</label>
                      <select
                        value={activeSkill.scope.type}
                        onChange={(e) => handleFormChange("scope", "type", e.target.value)}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent cursor-pointer"
                        disabled={activeSkill.skill.author === "system"}
                      >
                        <option value="global">Global</option>
                        <option value="file_type">Specific file formats</option>
                        <option value="task_type">Specific task formats</option>
                      </select>
                    </div>

                    {activeSkill.scope.type === "file_type" && (
                      <div className="flex flex-col gap-1.5">
                        <label className="font-bold text-[10px] uppercase text-muted">File Formats (Comma Separated)</label>
                        <input 
                          type="text" 
                          value={(activeSkill.scope.file_types || []).join(", ")} 
                          onChange={(e) => handleFormChange("scope", "file_types", e.target.value.split(",").map(x => x.trim()).filter(Boolean))}
                          className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                          placeholder="rs, ts, py..."
                          disabled={activeSkill.skill.author === "system"}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Section: Behavior */}
                <div className="space-y-3.5 pt-4 border-t border-light-rule">
                  <span className="kicker">Behavior Prompt Configuration</span>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-bold text-[10px] uppercase text-muted">System Prompt Template</label>
                    <textarea 
                      rows={5}
                      value={activeSkill.behavior.system_prompt} 
                      onChange={(e) => handleFormChange("behavior", "system_prompt", e.target.value)}
                      className="p-2.5 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent leading-loose font-serif-text text-sm"
                      disabled={activeSkill.skill.author === "system"}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Temperature</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        min="0.0" 
                        max="1.0"
                        value={activeSkill.behavior.temperature} 
                        onChange={(e) => handleFormChange("behavior", "temperature", parseFloat(e.target.value))}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                        disabled={activeSkill.skill.author === "system"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Max Output Tokens</label>
                      <input 
                        type="number" 
                        value={activeSkill.behavior.max_tokens} 
                        onChange={(e) => handleFormChange("behavior", "max_tokens", parseInt(e.target.value))}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent"
                        disabled={activeSkill.skill.author === "system"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Format</label>
                      <select
                        value={activeSkill.behavior.response_format}
                        onChange={(e) => handleFormChange("behavior", "response_format", e.target.value)}
                        className="p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent cursor-pointer"
                        disabled={activeSkill.skill.author === "system"}
                      >
                        <option value="markdown">Markdown</option>
                        <option value="plain">Plain text</option>
                        <option value="json">Structured JSON</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Built-in duplicate reminder banner */}
                {activeSkill.skill.author === "system" && (
                  <div className="p-3.5 bg-cream/35 border border-rule/55 rounded-sm leading-relaxed flex flex-col gap-2 font-sans-meta text-xs">
                    <span className="font-bold text-accent">System Skill is Read-Only</span>
                    <p className="text-muted text-[11px]">You can duplicate this template to customize the behavior prompts and triggers.</p>
                    <button 
                      onClick={() => {
                        const duplicate = {
                          ...activeSkill,
                          skill: {
                            ...activeSkill.skill,
                            name: `${activeSkill.skill.name} Copy`,
                            author: "user"
                          }
                        };
                        setActiveSkill(duplicate);
                        syncToml(duplicate);
                        setSkills([...skills, duplicate]);
                      }}
                      className="self-start px-3 py-1 bg-ink hover:bg-accent text-paper font-bold uppercase tracking-wider text-[9px] rounded-sm transition-all"
                    >
                      Duplicate & Customize
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted/50 select-none">
          <Code size={36} className="text-cream mb-4" />
          <span className="font-serif-display text-3xl italic font-bold text-ink/75 mb-2">AI Behavior Templates</span>
          <p className="font-sans-meta text-xs max-w-sm">
            Load, customize, and stack behavior scopes globally or specifically per-file-type.
          </p>
        </div>
      )}

      {ContextMenuComponent}
    </div>
  );
};
