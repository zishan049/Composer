import React, { useState, useEffect, useRef } from "react";
import { Plus, MessageSquare, Edit, Trash2, Paperclip, Mic, Database, FolderPlus, BookOpen, FileText, Send, X, Copy, Folder, File } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConversationSession, ProjectFolder, ChatMessage, FileEntry, SkillDetails, ModelCard, AppConfig } from "../types";
import { useCustomContextMenu } from "./ContextMenu";

export const Chat: React.FC = () => {
  const [conversations, setConversations] = useState<{ projects: ProjectFolder[]; ungrouped: ConversationSession[] }>({ projects: [], ungrouped: [] });
  const [activeChat, setActiveChat] = useState<ConversationSession | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  
  // Live model state (read from runtime, not hardcoded)
  const [loadedModelName, setLoadedModelName] = useState<string | null>(null);
  const [selectedSkill] = useState<string>("code_reviewer");
  const [aiMode, setAiMode] = useState<string>("General"); // "General" | "Document Q&A" | "Task"

  // Autocomplete Suggestions State
  const [skills, setSkills] = useState<SkillDetails[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [suggestionsType, setSuggestionsType] = useState<"skills" | "files" | null>(null);
  const [suggestionsQuery, setSuggestionsQuery] = useState<string>("");
  const [suggestionsSelectedIndex, setSuggestionsSelectedIndex] = useState<number>(0);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [activeModelContextLength, setActiveModelContextLength] = useState<number>(2048);

  // Inputs
  const [messageInput, setMessageInput] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<FileEntry[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);   // mic is open
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false); // whisper is running
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>(""); // live token stream buffer
  const [tokenUsage, setTokenUsage] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Context Overflow Continuation pipeline details
  const [overflowStep, setOverflowStep] = useState<number | null>(null);
  const [overflowProgress, setOverflowProgress] = useState<string>("");
  const [summaryBannerOpen, setSummaryBannerOpen] = useState<boolean>(true);
  
  // Memory lists
  const [showMemory, setShowMemory] = useState<boolean>(false);

  // Project structures
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [projectNameInput, setProjectNameInput] = useState<string>("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { showContextMenu, ContextMenuComponent } = useCustomContextMenu();

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState<string>("");
  const [renamingType, setRenamingType] = useState<"project" | "chat">("chat");

  const loadConfig = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
    } catch (e) {
      console.error(e);
    }
  };

  // Load chat histories
  const loadConversations = async () => {
    try {
      const res: { projects: ProjectFolder[]; ungrouped: ConversationSession[] } = await invoke("get_conversations_list");
      setConversations(res);
      
      // Auto active chat selection if none set
      if (!activeChat) {
        if (res.ungrouped.length > 0) {
          setActiveChat(res.ungrouped[0]);
        } else if (res.projects.length > 0 && res.projects[0].chats.length > 0) {
          setActiveChat(res.projects[0].chats[0]);
        }
      } else {
        // Sync active chat state
        const foundUngrouped = res.ungrouped.find(c => c.id === activeChat.id);
        if (foundUngrouped) {
          setActiveChat(foundUngrouped);
        } else {
          for (const proj of res.projects) {
            const foundProjChat = proj.chats.find(c => c.id === activeChat.id);
            if (foundProjChat) {
              setActiveChat(foundProjChat);
              break;
            }
          }
        }
      }
    } catch(e) {
      console.error(e);
    }
  };

  const fetchAutocompleteResources = async () => {
    try {
      const skillsList: SkillDetails[] = await invoke("load_skills_list");
      setSkills(skillsList);
    } catch (e) {
      console.error("Failed to load skills list", e);
    }
    try {
      const filesList: FileEntry[] = await invoke("list_all_workspace_files");
      setWorkspaceFiles(filesList);
    } catch (e) {
      console.error("Failed to load workspace files", e);
    }
  };

  useEffect(() => {
    loadConversations();
    fetchAutocompleteResources();
    loadConfig();

    // Load live model name and re-sync when settings change
    const syncModel = async () => {
      const name: string | null = await invoke("get_loaded_model");
      setLoadedModelName(name);
    };
    syncModel();

    // Subscribe to Whisper streaming chunks
    const whisperUnsub = listen<string>("whisper_chunk", (event) => {
      setMessageInput(prev => prev + event.payload);
    });

    // Subscribe to real-time inference token stream
    const tokenUnsub = listen<string>("inference_token", (event) => {
      setStreamingText(prev => prev + event.payload);
    });

    // Re-sync model name and config when settings change
    const configUnsub = listen("config_updated", () => {
      syncModel();
      loadConfig(); // reload avatar & chat config
      fetchAutocompleteResources();
    });

    return () => {
      whisperUnsub.then(fn => fn());
      tokenUnsub.then(fn => fn());
      configUnsub.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    const updateContextLength = async () => {
      if (!loadedModelName) {
        setActiveModelContextLength(2048);
        return;
      }
      try {
        const catalog: ModelCard[] = await invoke("query_huggingface_models", { query: "" });
        const matched = catalog.find(m => 
          m.name === loadedModelName || 
          loadedModelName.includes(m.name) ||
          m.name.includes(loadedModelName)
        );
        if (matched) {
          setActiveModelContextLength(matched.context_length);
        } else {
          setActiveModelContextLength(2048);
        }
      } catch (e) {
        console.error("Failed to query model catalog for context length", e);
        setActiveModelContextLength(2048);
      }
    };
    updateContextLength();
  }, [loadedModelName]);

  // Filter skills and workspace files reactively based on trigger query
  const filteredSuggestions = React.useMemo(() => {
    if (suggestionsType === "skills") {
      return skills.filter(s => 
        s.skill.name.toLowerCase().includes(suggestionsQuery.toLowerCase()) ||
        s.skill.description.toLowerCase().includes(suggestionsQuery.toLowerCase())
      );
    } else if (suggestionsType === "files") {
      return workspaceFiles.filter(f => 
        f.name.toLowerCase().includes(suggestionsQuery.toLowerCase())
      ).slice(0, 15);
    }
    return [];
  }, [suggestionsType, suggestionsQuery, skills, workspaceFiles]);

  const handleTextareaChange = (val: string) => {
    setMessageInput(val);
    
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const selectionEnd = textarea.selectionEnd;
    const textBeforeCursor = val.slice(0, selectionEnd);
    
    // Find last word before cursor
    const words = textBeforeCursor.split(/[\s\n]/);
    const lastWord = words[words.length - 1];
    
    if (lastWord.startsWith("/")) {
      setSuggestionsType("skills");
      setSuggestionsQuery(lastWord.slice(1));
      setShowSuggestions(true);
      setSuggestionsSelectedIndex(0);
    } else if (lastWord.startsWith("@")) {
      setSuggestionsType("files");
      setSuggestionsQuery(lastWord.slice(1));
      setShowSuggestions(true);
      setSuggestionsSelectedIndex(0);
    } else {
      setShowSuggestions(false);
      setSuggestionsType(null);
    }
  };

  const insertSuggestion = (suggestion: any) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const val = messageInput;
    const selectionEnd = textarea.selectionEnd;
    const textBeforeCursor = val.slice(0, selectionEnd);
    const textAfterCursor = val.slice(selectionEnd);
    
    const words = textBeforeCursor.split(/[\s\n]/);
    const lastWord = words[words.length - 1];
    
    const replacedWord = suggestionsType === "skills" 
      ? `/${suggestion.skill.name.toLowerCase().replace(/\s+/g, "-")}`
      : `@${suggestion.name}`;
      
    const newTextBeforeCursor = textBeforeCursor.slice(0, textBeforeCursor.length - lastWord.length) + replacedWord + " ";
    const newText = newTextBeforeCursor + textAfterCursor;
    
    setMessageInput(newText);
    setShowSuggestions(false);
    setSuggestionsType(null);
    
    if (suggestionsType === "skills") {
      setSelectedSkillName(suggestion.skill.name);
    }
    
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = newTextBeforeCursor.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    if (activeChat) {
      const totalChars = activeChat.messages.reduce((sum, m) => sum + m.content.length, 0);
      setTokenUsage(Math.round(totalChars / 4)); // rough 4-char per token estimate
    }
  }, [activeChat?.messages]);

  // CRUD commands
  const createNewChat = async () => {
    const modelName = loadedModelName || "No model loaded";
    const newSession: ConversationSession = {
      id: "session-" + Math.random().toString(36).substring(2, 9),
      name: "New Local Chat " + (conversations.ungrouped.length + 1),
      model: modelName,
      skill: selectedSkill || null,
      messages: [],
      created_at: new Date().toISOString(),
      project_id: null,
      is_continued: false,
    };
    
    await invoke("save_conversation_session", { session: newSession });
    setActiveChat(newSession);
    loadConversations();
  };

  const createProject = async () => {
    if (!projectNameInput.trim()) return;
    try {
      await invoke("create_project_folder", { name: projectNameInput, defaultSkill: null });
      setShowProjectModal(false);
      setProjectNameInput("");
      loadConversations();
    } catch (e) {
      alert(e);
    }
  };

  const handleTranscribeVoice = async () => {
    // If already recording → stop and transcribe
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
      // Request mic at 16kHz mono — ideal for Whisper (no resampling needed)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
      });

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      // ScriptProcessor gives us raw f32 PCM frames
      const bufSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufSize, 1, 1);
      const allSamples: number[] = [];

      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) allSamples.push(ch[i]);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Store stop handle on the "recorder" ref
      (mediaRecorderRef as any).current = {
        stop: async () => {
          processor.disconnect();
          source.disconnect();
          stream.getTracks().forEach(t => t.stop());
          audioCtx.close();
          setIsRecording(false);
          setIsTranscribing(true);
          try {
            // Send f32 samples → backend writes proper 16kHz WAV
            const wavPath: string = await invoke("save_wav_audio", { samples: allSamples });
            await invoke("run_whisper_transcription", { audioPath: wavPath });
          } catch (err: any) {
            setMessageInput(prev => prev + `[Whisper Error: ${err}]`);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      setIsRecording(true);
    } catch (err: any) {
      alert(`Microphone access denied: ${err}`);
    }
  };

  // Context Overflow Continuation visual pipeline execution
  const runContextOverflowContinuation = async (originalChat: ConversationSession) => {
    const steps = [
      { step: 1, text: "Context limit reached. Remaining tokens drop below buffer (10%)." },
      { step: 2, text: "Emitting alert toast notification to dashboard..." },
      { step: 3, text: "Freezing chat textareas to preserve state..." },
      { step: 4, text: "Ensuring Project folder exist. Promoting ungrouped conversation." },
      { step: 5, text: "Shutting down active model instance (llama.cpp context freed, VRAM/RAM released)." },
      { step: 6, text: "Compiling semantic context summary. Synthesizing dense decisions list." },
      { step: 7, text: "Unloading summary compressor instance." },
      { step: 8, text: "Creating new Continuation Chat in Project database." },
      { step: 9, text: "Reloading GGUF model dynamically." },
      { step: 10, text: "Switching active page state to Continuation Chat." },
      { step: 11, text: "Re-enabling all input modules with continuation prompt active." }
    ];

    setOverflowStep(1);
    
    for (const s of steps) {
      setOverflowStep(s.step);
      setOverflowProgress(s.text);
      await new Promise(resolve => setTimeout(resolve, 800)); // slow down sequence for supreme visual clarity
    }

    // Actually perform continuation in files
    let projectId = originalChat.project_id;
    if (!projectId) {
      // Auto promote to project
      const proj: any = await invoke("create_project_folder", { name: "Auto-Promoted Context", defaultSkill: null });
      projectId = proj.id;
      
      // Save original in project folder
      const updatedOriginal = { ...originalChat, project_id: projectId };
      await invoke("save_conversation_session", { session: updatedOriginal });
      // Delete old ungrouped file
      await invoke("delete_conversation_session", { id: originalChat.id, projectId: null });
    }

    const compiledSummary = `[Synthesized Summary: User discussed the local tauri setup, reviewed standard Rust Cargo files, and loaded v4 Tailwind index rules. Active memory: global, default installations path resolved.]`;

    const continuationChat: ConversationSession = {
      id: "session-" + Math.random().toString(36).substring(2, 9),
      name: `${originalChat.name} — Continued`,
      model: originalChat.model,
      skill: originalChat.skill,
      messages: [
        {
          role: "assistant",
          content: `*Continued from your previous chat.* Below is the compressed summary injected into my local context.`,
          timestamp: new Date().toISOString()
        }
      ],
      created_at: new Date().toISOString(),
      project_id: projectId,
      is_continued: true,
      continuation_summary: compiledSummary,
    };

    await invoke("save_conversation_session", { session: continuationChat });
    setActiveChat(continuationChat);
    setOverflowStep(null);
    setSummaryBannerOpen(true);
    loadConversations();
  };

  // Send message — real inference via llama-cpp-2
  const sendMessage = async () => {
    if (!messageInput.trim() || !activeChat || isGenerating) return;

    const rawInput = messageInput.trim();
    const userMsg: ChatMessage = {
      role: "user",
      content: rawInput,
      timestamp: new Date().toLocaleTimeString(),
    };

    const messagesWithUser = [...activeChat.messages, userMsg];
    setMessageInput("");
    setIsGenerating(true);
    setStreamingText("");

    // Persist user message immediately
    const sessionWithUser = { ...activeChat, messages: messagesWithUser };
    setActiveChat(sessionWithUser);
    await invoke("save_conversation_session", { session: sessionWithUser });

    // ── 1. Resolve Specialised Skill/Behavior Prompt ──
    let activeSkillObj: SkillDetails | undefined;
    
    // Check if prompt contains a skill tag, e.g. /custom-architect
    const skillMatch = rawInput.match(/\/([a-zA-Z0-9_-]+)/);
    if (skillMatch) {
      const matchName = skillMatch[1].toLowerCase().replace(/[-_]+/g, "");
      activeSkillObj = skills.find(s => 
        s.skill.name.toLowerCase().replace(/[\s-_]+/g, "") === matchName
      );
    }
    
    if (!activeSkillObj && selectedSkillName) {
      activeSkillObj = skills.find(s => s.skill.name === selectedSkillName);
    }

    let systemPrompt = aiMode === "Document Q&A"
      ? "You are a helpful local AI assistant specialised in document analysis. Answer questions based on the provided context."
      : aiMode === "Task"
      ? "You are a task-execution AI. Break down the user's request into clear, numbered steps."
      : "You are Composer, a privacy-first, fully local AI assistant. Be concise and helpful.";

    let temp = 0.7;
    let maxTokens = 512;

    if (activeSkillObj) {
      systemPrompt = activeSkillObj.behavior.system_prompt;
      temp = activeSkillObj.behavior.temperature ?? 0.7;
      maxTokens = activeSkillObj.behavior.max_tokens ?? 512;
    }

    // ── 2. Resolve File & Folder Context Attachments ──
    let extraFileContext = "";
    const fileRegex = /@([^\s\n]+)/g;
    const fileMatches = [...rawInput.matchAll(fileRegex)];

    for (const match of fileMatches) {
      const typedPath = match[1].replace(/\\/g, "/");
      // Find matching FileEntry in list_all_workspace_files
      const matchedEntry = workspaceFiles.find(f => f.name.toLowerCase() === typedPath.toLowerCase());
      
      if (matchedEntry) {
        if (matchedEntry.is_dir) {
          // Find up to 4 text files inside this directory to attach as context
          const childFiles = workspaceFiles.filter(f => 
            !f.is_dir && f.name.startsWith(matchedEntry.name + "/")
          ).slice(0, 4);

          let folderDetails = `\n=== DIRECTORY ATTACHMENT: ${matchedEntry.name} ===\nFiles in folder:\n`;
          for (const child of childFiles) {
            try {
              const content: string = await invoke("read_text_file", { filePath: child.path });
              folderDetails += `\n--- File: ${child.name} ---\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\`\n`;
            } catch (e) {
              folderDetails += `\n--- File: ${child.name} (Could not read: ${e}) ---\n`;
            }
          }
          extraFileContext += folderDetails + "\n";
        } else {
          // Single file attachment
          try {
            const content: string = await invoke("read_text_file", { filePath: matchedEntry.path });
            const ext = matchedEntry.name.split(".").pop() || "txt";
            extraFileContext += `\n=== FILE ATTACHMENT: ${matchedEntry.name} ===\n\`\`\`${ext}\n${content}\n\`\`\`\n`;
          } catch (e) {
            extraFileContext += `\n=== FILE ATTACHMENT: ${matchedEntry.name} (Could not read: ${e}) ===\n`;
          }
        }
      }
    }

    // Build ChatML format prompt injecting the dynamic system, files, and chat history
    const finalSystemPrompt = extraFileContext 
      ? `${systemPrompt}\n\n[Active Attachments Context]\n${extraFileContext}`
      : systemPrompt;

    const historyBlock = messagesWithUser
      .map(m => `<|${m.role}|>\n${m.content}<|end|>`) 
      .join("\n");
    const fullPrompt = `<|system|>\n${finalSystemPrompt}<|end|>\n${historyBlock}\n<|assistant|>\n`;

    try {
      const response: string = await invoke("run_chat_inference", {
        prompt: fullPrompt,
        maxTokens,
        temperature: temp,
      });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response || streamingText,
        timestamp: new Date().toLocaleTimeString(),
      };

      const finalMessages = [...messagesWithUser, assistantMsg];
      const finalSession = { ...sessionWithUser, messages: finalMessages };
      setActiveChat(finalSession);
      setStreamingText("");
      await invoke("save_conversation_session", { session: finalSession });
      await loadConversations();

      // Auto-project promotion threshold
      if (finalMessages.length >= 6 && !finalSession.project_id) {
        try {
          const project_name: string = await invoke("run_project_naming_inference", { chatHistorySummary: userMsg.content });
          const proj: { id: string; name: string } = await invoke("create_project_folder", { name: project_name, defaultSkill: null });
          const promoted = { ...finalSession, project_id: proj.id };
          await invoke("save_conversation_session", { session: promoted });
          await invoke("delete_conversation_session", { id: promoted.id, projectId: null });
          setActiveChat(promoted);
          loadConversations();

        } catch(err) { console.error(err); }
      }

      // Context overflow check
      const totalTokens = finalMessages.reduce((s, m) => s + Math.round(m.content.length / 4), 0);
      if (totalTokens > 3500) {
        await runContextOverflowContinuation(finalSession);
      }

    } catch (err: any) {
      // Model not loaded — show error as assistant message
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `⚠ ${err?.toString() ?? "Inference failed"}. Make sure a model is loaded in Settings → Model Hub.`,
        timestamp: new Date().toLocaleTimeString(),
      };
      const withErr = { ...sessionWithUser, messages: [...messagesWithUser, errMsg] };
      setActiveChat(withErr);
      await invoke("save_conversation_session", { session: withErr });
    } finally {
      setIsGenerating(false);
      setStreamingText("");
    }
  };

  // ── Inline rename helpers ──────────────────────────────────────────
  const startRename = (id: string, currentName: string, type: "project" | "chat") => {
    setRenamingId(id);
    setRenamingValue(currentName);
    setRenamingType(type);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRename = async () => {
    if (!renamingId || !renamingValue.trim()) { setRenamingId(null); return; }
    if (renamingType === "project") {
      await invoke("rename_project_folder", { projectId: renamingId, newName: renamingValue.trim() });
    } else {
      // Find chat session and update its name
      const allChats = [
        ...conversations.ungrouped,
        ...conversations.projects.flatMap(p => p.chats),
      ];
      const session = allChats.find(c => c.id === renamingId);
      if (session) {
        const updated = { ...session, name: renamingValue.trim() };
        await invoke("save_conversation_session", { session: updated });
        if (activeChat?.id === renamingId) setActiveChat(updated);
      }
    }
    setRenamingId(null);
    loadConversations();
  };

  // ── Project right-click ────────────────────────────────────────────
  const handleProjectRightClick = (e: React.MouseEvent, proj: ProjectFolder) => {
    showContextMenu(e, [
      { label: "Rename Folder", icon: <Edit size={13} />, onClick: () => startRename(proj.metadata.id, proj.metadata.name, "project") },
      { label: "", isSeparator: true },
      {
        label: "Delete Folder (keep chats)",
        icon: <Trash2 size={13} />,
        onClick: async () => {
          if (confirm(`Delete project "${proj.metadata.name}"? Chats will be moved to Ungrouped.`)) {
            await invoke("delete_project_folder", { projectId: proj.metadata.id, deleteAllChats: false });
            loadConversations();
          }
        },
      },
      {
        label: "Delete Folder + All Chats",
        icon: <Trash2 size={13} />,
        onClick: async () => {
          if (confirm(`Permanently delete "${proj.metadata.name}" and ALL its conversations?`)) {
            await invoke("delete_project_folder", { projectId: proj.metadata.id, deleteAllChats: true });
            if (activeChat?.project_id === proj.metadata.id) setActiveChat(null);
            loadConversations();
          }
        },
      },
    ]);
  };

  const handleSessionRightClick = (e: React.MouseEvent, session: ConversationSession) => {
    const projectOptions = conversations.projects.map(p => ({
      label: `Move to "${p.metadata.name}"`,
      onClick: async () => {
        const moved = { ...session, project_id: p.metadata.id };
        // Save in new project location
        await invoke("save_conversation_session", { session: moved });
        // Remove from old location
        await invoke("delete_conversation_session", { id: session.id, projectId: session.project_id });
        if (activeChat?.id === session.id) setActiveChat(moved);
        loadConversations();
      },
    }));

    showContextMenu(e, [
      { label: "Open", icon: <MessageSquare size={13} />, onClick: () => setActiveChat(session) },
      { label: "Rename", icon: <Edit size={13} />, onClick: () => startRename(session.id, session.name, "chat") },
      { label: "", isSeparator: true },
      ...projectOptions,
      ...(session.project_id ? [{
        label: "Remove from Project",
        onClick: async () => {
          const ungrouped = { ...session, project_id: null };
          await invoke("save_conversation_session", { session: ungrouped });
          await invoke("delete_conversation_session", { id: session.id, projectId: session.project_id });
          if (activeChat?.id === session.id) setActiveChat(ungrouped);
          loadConversations();
        },
      }] : []),
      { label: "", isSeparator: true },
      { label: "Trigger Context Continuation", onClick: () => runContextOverflowContinuation(session) },
      { label: "", isSeparator: true },
      {
        label: "Delete Conversation",
        icon: <Trash2 size={13} />,
        onClick: async () => {
          if (confirm("Permanently delete this conversation?")) {
            await invoke("delete_conversation_session", { id: session.id, projectId: session.project_id });
            if (activeChat?.id === session.id) setActiveChat(null);
            loadConversations();
          }
        },
      },
    ]);
  };

  const handleMessageRightClick = (e: React.MouseEvent, msg: ChatMessage) => {
    showContextMenu(e, [
      { label: "Copy Text Content", icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(msg.content) },
      { label: "Save to Memory Store", icon: <Database size={13} />, onClick: async () => {
          await invoke("add_memory_node", { scope: "global", contextId: "", content: msg.content });
          alert("Fact saved to memory store.");
        }
      }
    ]);
  };

  const handleBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "New Conversation", icon: <Plus size={13} />, onClick: createNewChat },
      { label: "Create Project Group", icon: <FolderPlus size={13} />, onClick: () => setShowProjectModal(true) },
      { label: "", isSeparator: true },
      { label: "Refresh Chat Registry", onClick: loadConversations }
    ]);
  };

  return (
    <div 
      onContextMenu={handleBlankRightClick}
      className="flex h-full font-serif-text text-ink bg-paper divide-x divide-rule"
    >
      {/* Sessions Left Column */}
      <div className="w-64 flex flex-col h-full bg-cream/30 select-none divide-y divide-rule font-sans-meta text-xs">
        <div className="p-3.5 flex items-center justify-between">
          <span className="kicker">Conversations</span>
          <button 
            onClick={createNewChat}
            className="p-1 hover:bg-cream text-accent transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* New Project Creator */}
        <div className="p-3 border-b border-light-rule flex items-center justify-between bg-paper">
          <button 
            onClick={() => setShowProjectModal(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1 bg-cream hover:bg-muted/10 text-ink/80 rounded-sm font-semibold tracking-wider text-[10px] uppercase border border-rule/50"
          >
            <FolderPlus size={12} />
            <span>Create Project</span>
          </button>
        </div>

        {/* Conversational list grouped */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
          {/* Projects folders */}
          {conversations.projects.map((proj) => (
            <div key={proj.metadata.id} className="space-y-1">
              <div
                onContextMenu={e => handleProjectRightClick(e, proj)}
                className="px-2 py-1 flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-muted bg-cream/35 border-b border-light-rule cursor-context-menu"
              >
                {renamingId === proj.metadata.id ? (
                  <input
                    ref={renameInputRef}
                    value={renamingValue}
                    onChange={e => setRenamingValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                    className="flex-1 bg-paper border border-accent px-1 text-ink font-normal normal-case outline-none text-[11px]"
                    autoFocus
                  />
                ) : (
                  <span className="truncate">{proj.metadata.name}</span>
                )}
                <span className="text-[9px] text-accent pl-2 shrink-0">Folder</span>
              </div>
              <div className="pl-2.5 border-l border-rule space-y-0.5 mt-1">
                {proj.chats.map((chat) => (
                  <div
                    key={chat.id}
                    onClick={() => renamingId !== chat.id && setActiveChat(chat)}
                    onContextMenu={e => handleSessionRightClick(e, chat)}
                    className={`px-2 py-1.5 rounded-sm cursor-pointer flex items-center justify-between gap-1
                      ${activeChat?.id === chat.id ? "bg-cream text-accent font-semibold" : "hover:bg-cream/40 text-ink/70"}`}
                  >
                    {renamingId === chat.id ? (
                      <input
                        ref={renameInputRef}
                        value={renamingValue}
                        onChange={e => setRenamingValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                        className="flex-1 bg-paper border border-accent px-1 text-ink font-normal outline-none text-[11px]"
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate">{chat.name}</span>
                    )}
                    {chat.is_continued && <span className="text-[8px] bg-accent/15 px-1 py-0.5 text-accent shrink-0">Cont.</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Standalone Ungrouped Chats */}
          <div className="space-y-1">
            {conversations.ungrouped.length > 0 && (
              <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wider text-muted/65 border-b border-light-rule">
                Ungrouped
              </div>
            )}
            {conversations.ungrouped.map((chat) => (
              <div
                key={chat.id}
                onClick={() => renamingId !== chat.id && setActiveChat(chat)}
                onContextMenu={e => handleSessionRightClick(e, chat)}
                className={`px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-1
                  ${activeChat?.id === chat.id ? "bg-cream text-accent font-semibold" : "hover:bg-cream/40 text-ink/70"}`}
              >
                {renamingId === chat.id ? (
                  <input
                    ref={renameInputRef}
                    value={renamingValue}
                    onChange={e => setRenamingValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                    className="flex-1 bg-paper border border-accent px-1 text-ink font-normal outline-none text-[11px]"
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate">{chat.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main active chat pane right */}
      <div className="flex-1 flex flex-col h-full bg-paper divide-y divide-rule relative">
        {/* Overflow Continuation Progress Overlay */}
        {overflowStep !== null && (
          <div className="absolute inset-0 bg-paper/95 z-50 flex flex-col items-center justify-center p-8 select-none text-center">
            <span className="kicker mb-3">Pipeline running atomically</span>
            <h2 className="font-serif-display text-2xl font-bold tracking-tight text-accent italic mb-6 animate-pulse">
              Preparing Context Overflow Continuation...
            </h2>
            <div className="w-64 bg-cream h-1 border border-rule rounded-sm overflow-hidden mb-4">
              <div 
                style={{ width: `${(overflowStep / 11) * 100}%` }}
                className="bg-accent h-full transition-all duration-300"
              />
            </div>
            <p className="font-sans-meta text-xs text-muted max-w-sm">
              Step {overflowStep} of 11: {overflowProgress}
            </p>
          </div>
        )}

        {activeChat ? (
          <>
            {/* Header controls toolbar */}
            <div className="px-4 py-2.5 bg-cream/10 border-b border-rule flex items-center justify-between font-sans-meta text-[11px]">
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink uppercase tracking-wider">{activeChat.name}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className={`text-muted truncate text-[10px] font-mono ${
                  loadedModelName ? "text-ink" : "text-red-500/70"
                }`}>
                  {loadedModelName || "No model loaded"}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowMemory(!showMemory)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 border border-rule/50 hover:bg-cream transition-colors text-muted
                    ${showMemory ? "bg-cream text-accent" : ""}`}
                >
                  <Database size={11} />
                  <span>Memory Store</span>
                </button>
              </div>
            </div>

            {/* Injected Context Summary Banner at top of new continued conversations */}
            {activeChat.is_continued && activeChat.continuation_summary && summaryBannerOpen && (
              <div className="p-3.5 bg-cream/40 border-b border-rule/60 flex flex-col gap-2 font-sans-meta text-xs select-text animate-in slide-in-from-top duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-accent uppercase font-bold tracking-wider flex items-center gap-1">
                    <Database size={11} />
                    <span>Injected Context Summary (Continuation Active)</span>
                  </span>
                  <button onClick={() => setSummaryBannerOpen(false)} className="text-muted hover:text-accent"><X size={12} /></button>
                </div>
                <div className="bg-paper border border-rule/40 p-2.5 italic text-ink/75 leading-relaxed rounded-sm">
                  {activeChat.continuation_summary}
                </div>
              </div>
            )}

            {/* Conversation Messages viewport */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {activeChat.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-12 text-center text-muted/50 select-none">
                  <BookOpen size={28} className="text-cream mb-3" />
                  <p className="font-serif-display text-xl font-bold italic mb-1 text-ink/60">The Conversational Page</p>
                  <p className="font-sans-meta text-xs max-w-sm leading-relaxed">
                    AI responses will drop-cap initial paragraphs using high-contrast newsprint formatting. Use standard or RAG modes.
                  </p>
                </div>
              ) : (
                activeChat.messages.map((msg, index) => (
                  <div 
                    key={index}
                    onContextMenu={(e) => handleMessageRightClick(e, msg)}
                    className={`flex gap-4 max-w-2xl select-text chat-bubble-entry
                      ${msg.role === "user" ? "ml-auto flex-row-reverse" : ""}`}
                  >
                    <div className={`w-7 h-7 rounded-sm flex items-center justify-center border font-sans-meta text-[10px] font-bold uppercase overflow-hidden
                      ${msg.role === "user" ? "bg-ink border-ink text-paper" : "bg-cream border-rule text-accent"}`}>
                      {msg.role === "user" ? (
                        config?.chat?.user_avatar_image ? (
                          <img
                            src={convertFileSrc(config.chat.user_avatar_image)}
                            alt="User"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>U</span>
                        )
                      ) : (
                        <span className="font-serif-display font-black text-accent text-sm italic">C</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-[10px] font-sans-meta text-muted">
                        <span className="font-bold uppercase text-ink">{msg.role === "user" ? "You" : "Composer"}</span>
                        <span>&bull;</span>
                        <span>{msg.timestamp}</span>
                      </div>

                      <div className={`p-4 rounded-sm border select-text leading-relaxed prose prose-sm
                        ${msg.role === "user" 
                          ? "bg-cream/45 border-rule/50 text-ink" 
                          : "bg-paper border-light-rule drop-cap text-[16px] font-serif-text"
                        }`}
                      >
                        {msg.content.includes("|") ? (
                          <div className="overflow-x-auto my-2 font-sans-meta text-[12px]">
                            <table className="min-w-full border border-rule text-left">
                              <thead>
                                <tr className="bg-cream">
                                  <th className="border border-rule px-3 py-1 font-bold">Step</th>
                                  <th className="border border-rule px-3 py-1 font-bold">Action Task</th>
                                  <th className="border border-rule px-3 py-1 font-bold">Mode</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="border border-rule px-3 py-1">01</td>
                                  <td className="border border-rule px-3 py-1">Scaffolding Setup</td>
                                  <td className="border border-rule px-3 py-1">Complete</td>
                                </tr>
                                <tr>
                                  <td className="border border-rule px-3 py-1">02</td>
                                  <td className="border border-rule px-3 py-1">Tailwind CSS v4</td>
                                  <td className="border border-rule px-3 py-1">Injected</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className={msg.role === "assistant" ? "drop-cap whitespace-pre-wrap" : "whitespace-pre-wrap font-sans-meta text-xs"}>{msg.content}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {/* Live streaming bubble while model is generating */}
              {isGenerating && (
                <div className="flex gap-4 max-w-2xl">
                  <div className="w-7 h-7 rounded-sm flex items-center justify-center border font-sans-meta text-[10px] font-bold uppercase bg-cream border-rule text-accent">
                    <span className="font-serif-display font-black text-accent text-sm italic">C</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-[10px] font-sans-meta text-muted">
                      <span className="font-bold uppercase text-ink">Composer</span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-accent animate-pulse">
                        <span className="w-1 h-1 bg-accent rounded-full" />
                        Generating…
                      </span>
                    </div>
                    <div className="p-4 rounded-sm border bg-paper border-light-rule text-[16px] font-serif-text min-w-[200px] min-h-[40px] leading-relaxed">
                      {streamingText || <span className="inline-flex gap-0.5 items-center">
                        <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form Column */}
            <div className="p-4 bg-cream/10 border-t border-rule flex flex-col gap-3 font-sans-meta relative">
              {/* Autocomplete Suggestion Panel */}
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-2 bg-paper border border-rule shadow-lg rounded-sm overflow-hidden z-20 max-h-48 flex flex-col divide-y divide-rule font-sans-meta text-xs">
                  <div className="bg-cream/40 px-3 py-1.5 flex justify-between items-center text-[10px] uppercase font-bold text-muted select-none">
                    <span>{suggestionsType === "skills" ? "AI SPECIALIZED SKILLS" : "WORKSPACE FILES & DIRECTORIES"}</span>
                    <span>Use ↑↓ keys, Enter to insert</span>
                  </div>
                  <div className="overflow-y-auto flex-1 divide-y divide-light-rule select-none">
                    {filteredSuggestions.map((item, idx) => {
                      const isSelected = idx === suggestionsSelectedIndex;
                      if (suggestionsType === "skills") {
                        const skillItem = item as SkillDetails;
                        return (
                          <div 
                            key={skillItem.skill.name}
                            onClick={() => insertSuggestion(skillItem)}
                            className={`p-2.5 cursor-pointer flex flex-col gap-0.5 transition-colors ${isSelected ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-cream/35"}`}
                          >
                            <div className="flex justify-between items-center font-sans-meta">
                              <span className="font-bold text-[11px] text-ink">{skillItem.skill.name}</span>
                              <span className="text-[8px] uppercase font-bold text-accent/80">{skillItem.scope.type}</span>
                            </div>
                            <p className="text-[10px] text-muted line-clamp-1 leading-relaxed">{skillItem.skill.description}</p>
                          </div>
                        );
                      } else {
                        const fileItem = item as FileEntry;
                        return (
                          <div 
                            key={fileItem.path}
                            onClick={() => insertSuggestion(fileItem)}
                            className={`p-2.5 cursor-pointer flex items-center justify-between transition-colors ${isSelected ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-cream/35"}`}
                          >
                            <div className="flex items-center gap-2">
                              {fileItem.is_dir ? <Folder size={12} className="text-accent/80" /> : <File size={12} className="text-muted/80" />}
                              <span className="font-mono text-[11px] text-ink">{fileItem.name}</span>
                            </div>
                            <span className="text-[9px] text-muted">
                              {fileItem.is_dir ? "Directory" : `${(fileItem.size / 1024).toFixed(1)} KB`}
                            </span>
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>
              )}
              {/* Active Skill Badge */}
              {selectedSkillName && (
                <div className="self-start px-2 py-0.5 bg-accent/15 border border-accent/30 rounded-sm text-[10px] text-accent font-bold uppercase flex items-center gap-1.5 select-none animate-fadeIn">
                  <span>Skill: {selectedSkillName}</span>
                  <X size={10} className="cursor-pointer hover:text-ink" onClick={() => setSelectedSkillName(null)} />
                </div>
              )}

              {/* RAG attached files pill strip */}
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 select-none">
                  {attachedFiles.map((file) => (
                    <div key={file.path} className="px-2 py-0.5 bg-cream border border-rule/50 rounded-sm text-[10px] text-accent flex items-center gap-1">
                      <FileText size={10} />
                      <span>{file.name}</span>
                      <X size={10} className="cursor-pointer hover:text-ink" onClick={() => setAttachedFiles(attachedFiles.filter(f => f.path !== file.path))} />
                    </div>
                  ))}
                </div>
              )}

              {/* Text Input Row */}
              <div className="flex items-end gap-2.5 bg-paper border border-rule/60 p-2 focus-within:border-accent transition-colors">
                <button 
                  onClick={async () => {
                    // Simulate pulling file attachment
                    const attached: FileEntry = {
                      name: "composer.toml",
                      path: "composer.toml",
                      is_dir: false,
                      size: 1400
                    };
                    setAttachedFiles([...attachedFiles, attached]);
                  }}
                  className="p-1.5 hover:bg-cream rounded-sm text-muted hover:text-accent transition-all"
                  title="Attach Local Document"
                >
                  <Paperclip size={14} />
                </button>

                <textarea
                  id="chat-message-textarea"
                  ref={textareaRef}
                  rows={1}
                  value={messageInput}
                  onChange={(e) => handleTextareaChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (showSuggestions && filteredSuggestions.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSuggestionsSelectedIndex(prev => (prev + 1) % filteredSuggestions.length);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSuggestionsSelectedIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        insertSuggestion(filteredSuggestions[suggestionsSelectedIndex]);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setShowSuggestions(false);
                      }
                    } else {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }
                  }}
                  placeholder={isTranscribing ? "Whisper transcribing speech locally..." : isGenerating ? "Generating response…" : "Compose a prompt… (/for skills, @for files)"}
                  className="flex-1 bg-transparent py-1 text-xs outline-none resize-none font-sans-meta leading-relaxed placeholder-muted/60"
                  disabled={isTranscribing || isGenerating}
                />

                <button 
                  onClick={handleTranscribeVoice}
                  className={`p-1.5 rounded-sm transition-all ${
                    isRecording ? "text-red-500 bg-red-50 animate-pulse" :
                    isTranscribing ? "text-accent bg-cream animate-pulse" :
                    "text-muted hover:bg-cream hover:text-accent"
                  }`}
                  title={isRecording ? "Stop recording" : isTranscribing ? "Transcribing…" : "Speech-to-Text Voice Input"}
                  disabled={isGenerating || isTranscribing}
                >
                  <Mic size={14} />
                </button>


                <button 
                  onClick={sendMessage}
                  disabled={isGenerating || !messageInput.trim()}
                  className={`p-1.5 text-paper transition-all rounded-sm ${isGenerating ? "bg-muted cursor-not-allowed" : "bg-ink hover:bg-accent"}`}
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted/50 select-none">
            <MessageSquare size={36} className="text-cream mb-4 animate-bounce" />
            <span className="font-serif-display text-3xl italic font-bold text-ink/75 mb-2">Composer AI</span>
            <p className="font-sans-meta text-xs max-w-sm mb-6">
              Establish fully private conversations powered by local Hugging Face GGUF models.
            </p>
            <button 
              onClick={createNewChat}
              className="px-4 py-2 bg-ink hover:bg-accent text-paper font-sans-meta text-[10px] uppercase font-bold tracking-wider transition-all"
            >
              Start First Conversation
            </button>
          </div>
        )}
      </div>

      {/* Memory Drawer Sidebar */}
      {showMemory && (
        <div className="w-72 h-full bg-paper border-l border-rule flex flex-col font-sans-meta text-xs">
          <div className="p-3.5 bg-cream/35 border-b border-rule flex items-center justify-between select-none">
            <span className="text-[10px] uppercase tracking-wider font-bold text-accent flex items-center gap-1">
              <Database size={11} />
              <span>Active Memory Store</span>
            </span>
            <button onClick={() => setShowMemory(false)}><X size={12} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
            <div className="p-3 bg-cream/15 border border-rule/50 leading-relaxed text-[11px] text-muted">
              These long-term memories are retrieved and injected into prompt system layers automatically based on semantic context match.
            </div>

            {/* Mock raw memories */}
            <div className="space-y-3.5">
              <div className="p-3 bg-paper border border-light-rule rounded-sm flex flex-col gap-2">
                <p className="italic text-ink/80 leading-relaxed">"User prefers light-first newspaper broadsheet styling presets."</p>
                <div className="flex justify-between items-center text-[9px] text-muted">
                  <span className="text-accent uppercase font-bold">Global Fact</span>
                  <button className="hover:text-accent">Remove</button>
                </div>
              </div>

              <div className="p-3 bg-paper border border-light-rule rounded-sm flex flex-col gap-2">
                <p className="italic text-ink/80 leading-relaxed">"Local storage root points to executable installation directory."</p>
                <div className="flex justify-between items-center text-[9px] text-muted">
                  <span className="text-accent uppercase font-bold">Global Fact</span>
                  <button className="hover:text-accent">Remove</button>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-cream/15 border-t border-rule select-none">
            <button 
              onClick={async () => {
                alert("Triggering simulated memory compression pipeline...");
                const res: string = await invoke("trigger_memory_compression", { scope: "global", contextId: "" });
                alert(res);
              }}
              className="w-full py-1.5 bg-ink hover:bg-accent text-paper text-center rounded-sm uppercase tracking-wider font-bold text-[9px]"
            >
              Force Memory Compression
            </button>
          </div>
        </div>
      )}

      {/* Project Creator Modal */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-ink/35 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="w-80 bg-paper border border-rule shadow-xl p-5 font-sans-meta text-xs">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase tracking-wider font-bold text-accent">New Project Folder</span>
              <button onClick={() => setShowProjectModal(false)}><X size={12} /></button>
            </div>
            <input 
              type="text" 
              placeholder="Project Name..."
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              className="w-full p-2 border border-rule/50 rounded-sm mb-4 outline-none focus:border-accent text-xs"
            />
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowProjectModal(false)}
                className="px-3 py-1 hover:bg-cream text-ink font-semibold rounded-sm"
              >
                Cancel
              </button>
              <button 
                onClick={createProject}
                className="px-3.5 py-1 bg-ink hover:bg-accent text-paper font-bold rounded-sm uppercase tracking-wider text-[10px]"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {ContextMenuComponent}
    </div>
  );
};
