"use client";
export const dynamic = 'force-dynamic';
// Upload & Transcribe, real Supabase Storage upload to "recordings" bucket.


import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FileAudio, FileVideo, Trash2, Sparkles, CheckCircle2, Loader2, AlertCircle, ExternalLink, Mic, Cpu, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/app/components/WorkspaceContext";

type UploadStatus = "idle" | "uploading" | "processing" | "done" | "error";

interface UploadedFile {
  id:          string;
  name:        string;
  size:        string;
  type:        "audio" | "video" | "transcript";
  status:      UploadStatus;
  progress:    number;
  errorMsg:    string | null;
  storagePath: string | null;
  publicUrl:   string | null;
  meetingId:   string | null;
  aiEnabled:   boolean;
  retry?:      { meetingId: string; storagePath: string | null; workspaceId: string; userId: string } | null;
}


export default function UploadPage() {
  const { activeWorkspace } = useWorkspace();
  const [files,     setFiles]     = useState<UploadedFile[]>([]);
  const [dragging,  setDragging]  = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<{ id: string; title: string | null; started_at: string | null; created_at: string | null; status: string | null }[]>([]);

  // Recent uploads and pasted transcripts in this workspace
  const loadRecent = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) return;
    const wsId = activeWorkspace?.workspace_id ?? (await getFirstWorkspaceId(user.id));
    if (!wsId) return;
    const { data } = await supabase.from("meetings").select("id, title, started_at, created_at, status")
      .eq("workspace_id", wsId).in("platform", ["upload", "other"]).order("created_at", { ascending: false }).limit(5);
    setRecent(data ?? []);
  }, [activeWorkspace?.workspace_id]);
  useEffect(() => { loadRecent(); }, [loadRecent, files.length]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const updateFile = useCallback((id: string, patch: Partial<UploadedFile>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  // Trigger AI pipeline via backend proxy
  const triggerAIPipeline = useCallback(async (
    meetingId: string,
    storagePath: string | null,
    workspaceId: string,
    userId: string,
    fileId: string,
  ) => {
    try {
      const retry = { meetingId, storagePath, workspaceId, userId };
      updateFile(fileId, { status: "processing", errorMsg: null, retry: null });
      const res = await authFetch("/api/backend/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, storagePath, workspaceId }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        // File and meeting are already saved, so nothing is lost: offer a retry.
        updateFile(fileId, { status: "error", aiEnabled: false, errorMsg: "Transcription server is offline. Your file is saved.", retry });
        showToast("Saved, but transcription could not start. Press Retry when the server is on.", false);
        return;
      }

      updateFile(fileId, { aiEnabled: true });
      showToast("Processing started. This takes about a minute for every 10 minutes of audio.");

      // Poll until the meeting is processed or fails. Long recordings can take a while.
      let attempts = 0;
      const poll = async () => {
        attempts++;
        const { data } = await supabase
          .from("meetings")
          .select("status")
          .eq("id", meetingId)
          .single();
        const status = (data as { status: string } | null)?.status;
        if (status === "complete") {
          updateFile(fileId, { status: "done" });
          showToast("Processing complete. Your summary is ready.");
          authFetch("/api/notify/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingId }) }).catch(() => {});
        } else if (status === "failed") {
          const { data: up } = await supabase.from("uploads").select("error_message").eq("meeting_id", meetingId).maybeSingle();
          const reason = (up as { error_message: string | null } | null)?.error_message;
          updateFile(fileId, { status: "error", errorMsg: `${reason ?? "Processing failed."} Your file is saved.`, retry: { meetingId, storagePath, workspaceId, userId } });
          showToast("Processing failed. Press Retry to try again.", false);
        } else if (attempts > 180) {
          updateFile(fileId, { status: "processing", errorMsg: "Still processing. You can leave this page and check Meeting Summary later." });
        } else {
          setTimeout(poll, 5000);
        }
      };
      setTimeout(poll, 5000);
    } catch {
      updateFile(fileId, { status: "error", aiEnabled: false, errorMsg: "Transcription server did not answer. Your file is saved.", retry: { meetingId, storagePath, workspaceId, userId } });
      showToast("Saved, but transcription could not start. Press Retry when the server is on.", false);
    }
  }, [updateFile]);

  // Real upload to Supabase Storage
  const uploadToSupabase = useCallback(async (rawFile: File, fileEntry: UploadedFile) => {
    const user = await getCurrentUser();
    if (!user) {
      updateFile(fileEntry.id, { status: "error", errorMsg: "Not logged in" });
      return;
    }

    const wsId = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!wsId) {
      updateFile(fileEntry.id, { status: "error", errorMsg: "No workspace found" });
      return;
    }

    const storagePath = `${wsId}/${Date.now()}-${rawFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    updateFile(fileEntry.id, { status: "uploading", progress: 10 });

    let fakeProgress = 10;
    const ticker = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.random() * 18, 85);
      updateFile(fileEntry.id, { progress: Math.round(fakeProgress) });
    }, 400);

    const { data: storageData, error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(storagePath, rawFile, { cacheControl: "3600", upsert: false });

    clearInterval(ticker);

    if (uploadError) {
      updateFile(fileEntry.id, { status: "error", errorMsg: uploadError.message, progress: 0 });
      showToast(`Upload failed: ${uploadError.message}`, false);
      return;
    }

    updateFile(fileEntry.id, { progress: 95 });

    // Recordings stay private: the backend downloads the file by its storage
    const publicUrl = null;

    const meetingTitle = rawFile.name.replace(/\.[^/.]+$/, "");

    const { data: meetingRaw, error: meetingErr } = await supabase
      .from("meetings")
      .insert({
        workspace_id: wsId,
        owner_id:     user.id,
        title:        meetingTitle,
        platform:     "upload",
        meeting_url:  null,
        started_at:   new Date().toISOString(),
        status:       "processing",
        audio_path:   storagePath,
      })
      .select("id")
      .single();

    const meetingId = meetingErr ? null : (meetingRaw as { id: string } | null)?.id ?? null;

    await supabase.from("uploads").insert({
      workspace_id: wsId,
      user_id:      user.id,
      meeting_id:   meetingId,
      file_name:    rawFile.name,
      file_path:    storagePath,
      mime_type:    rawFile.type || "application/octet-stream",
      size_bytes:   rawFile.size,
      status:       "processing",
    });

    updateFile(fileEntry.id, {
      status:      "processing",
      progress:    100,
      storagePath,
      publicUrl,
      meetingId,
    });

    // Trigger AI pipeline for the uploaded file
    if (meetingId && storageData?.path) {
      await triggerAIPipeline(meetingId, storageData.path, wsId, user.id, fileEntry.id);
    } else {
      updateFile(fileEntry.id, { status: "done" });
      showToast(`${rawFile.name} uploaded successfully`);
    }
  }, [updateFile, triggerAIPipeline, activeWorkspace?.workspace_id]);

  const addFiles = useCallback((newFiles: File[]) => {
    const entries: UploadedFile[] = newFiles.map(f => ({
      id:          Math.random().toString(36).slice(2),
      name:        f.name,
      size:        f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`,
      type:        f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "transcript",
      status:      "idle" as UploadStatus,
      progress:    0,
      errorMsg:    null,
      storagePath: null,
      publicUrl:   null,
      meetingId:   null,
      aiEnabled:   false,
    }));
    setFiles(prev => [...prev, ...entries]);
    entries.forEach((entry, i) => uploadToSupabase(newFiles[i], entry));
  }, [uploadToSupabase]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  // Paste transcript
  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) return;

    const user = await getCurrentUser();
    const wsId = user ? (activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id)))
      : null;

    const newFile: UploadedFile = {
      id:          Math.random().toString(36).slice(2),
      name:        "Pasted transcript.txt",
      size:        `${(pasteText.length / 1024).toFixed(1)} KB`,
      type:        "transcript",
      status:      "processing",
      progress:    100,
      errorMsg:    null,
      storagePath: null,
      publicUrl:   null,
      meetingId:   null,
      aiEnabled:   false,
    };
    setFiles(prev => [newFile, ...prev]);
    setPasteText("");
    setPasteMode(false);

    if (user && wsId) {
      const { data: meetingRaw } = await supabase
        .from("meetings")
        .insert({
          workspace_id: wsId,
          owner_id:     user.id,
          title:        "Pasted Transcript",
          platform:     "other",
          meeting_url:  "manual://paste",
          started_at:   new Date().toISOString(),
          status:       "processing",
          transcript:   pasteText.trim(),
        })
        .select("id")
        .single();
      const meetingId = (meetingRaw as { id: string } | null)?.id ?? null;
      updateFile(newFile.id, { meetingId });

      if (meetingId) {
        // Trigger AI pipeline (no audio URL, will use transcript already in DB)
        await triggerAIPipeline(meetingId, null, wsId, user.id, newFile.id);
      }
    } else {
      showToast("Transcript submitted");
      setTimeout(() => updateFile(newFile.id, { status: "done" }), 1500);
    }
  };

  const TypeIcon = ({ type }: { type: "audio" | "video" | "transcript" }) => {
    if (type === "video") return <FileVideo size={16} color="#7DD3FC" />;
    if (type === "audio") return <FileAudio size={16} color="#C4B5FD" />;
    return <FileAudio size={16} color="#6EE7B7" />;
  };


  const STAGES = ["Upload", "Transcribe", "Summarise", "Ready"];
  const stageOf = (f: UploadedFile) => f.status === "uploading" || f.status === "idle" ? 0 : f.status === "processing" ? 1 : f.status === "done" ? 3 : -1;

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <style>{UP_CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-header-title">Upload &amp; Transcribe</div>
          <div className="page-header-sub">Turn a recording or transcript into a summary and tasks.</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setPasteMode(!pasteMode)}>{pasteMode ? "Upload a file instead" : "Paste a transcript"}</button>
        <input ref={inputRef} type="file" multiple accept="audio/*,video/*,.txt" style={{ display: "none" }} onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
      </div>

      <div className="page-body up-layout">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {pasteMode ? (
            <div className="data-card up-paste">
              <h3>Paste a transcript</h3>
              <p>Meeting notes or a transcript from Zoom, Teams or Otter. Speaker names help ClarityMeet assign tasks.</p>
              <textarea className="form-textarea" placeholder={"Latif: Let's plan the sprint...\nChris: I'll take the migration."} value={pasteText} onChange={e => setPasteText(e.target.value)} />
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button className="btn btn-primary btn-sm" onClick={handlePasteSubmit} disabled={!pasteText.trim()}><Sparkles size={13} /> Summarise</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setPasteMode(false); setPasteText(""); }}>Cancel</button>
                <span className="up-count">{pasteText.trim() ? `${pasteText.trim().split(/\s+/).length} words` : ""}</span>
              </div>
            </div>
          ) : (
            <div
              className={`up-drop${dragging ? " on" : ""}`}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <div className="up-drop-icon"><Upload size={20} /></div>
              <div>
                <div className="up-drop-title">{dragging ? "Drop to upload" : "Drop a recording here, or click to choose"}</div>
                <div className="up-drop-sub">MP3, M4A, WAV, MP4 or a .txt transcript · up to 50 MB · language is detected automatically</div>
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="data-card">
              <div className="up-head"><h2>This session</h2>
                <span>{files.filter(f => f.status === "done").length} ready · {files.filter(f => f.status === "processing" || f.status === "uploading").length} working{files.some(f => f.status === "error") ? ` · ${files.filter(f => f.status === "error").length} failed` : ""}</span>
              </div>
              <AnimatePresence>
                {files.map(file => {
                  const st = stageOf(file);
                  return (
                    <motion.div key={file.id} className="up-file" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      <div className="up-file-icon"><TypeIcon type={file.type} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="up-file-name">{file.name} <span>{file.size}</span></div>
                        {file.status === "error" ? (
                          <div className="up-error"><AlertCircle size={12} /> {file.errorMsg || "Something went wrong."}
                            {file.retry && <button className="btn btn-secondary btn-sm" onClick={() => { const r = file.retry!; triggerAIPipeline(r.meetingId, r.storagePath, r.workspaceId, r.userId, file.id); }}>Retry</button>}
                          </div>
                        ) : (
                          <>
                            <ol className="up-stages">
                              {STAGES.map((l, i) => <li key={l} className={i < st || st === 3 ? "done" : i === st ? "now" : ""}>{i === st && st < 3 ? <Loader2 size={11} style={{ animation: "spin 1.2s linear infinite" }} /> : i < st || st === 3 ? <CheckCircle2 size={11} /> : null}{l}</li>)}
                            </ol>
                            {file.status === "uploading" && <div className="up-bar"><div style={{ width: `${file.progress}%` }} /></div>}
                            {file.status === "processing" && <div className="up-note">Transcribing and summarising. About 4 minutes for a 15 MB file. You can leave this page.</div>}
                          </>
                        )}
                      </div>
                      {file.status === "done" && file.meetingId && <Link href={`/meeting-summary?id=${file.meetingId}`} className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>Open summary</Link>}
                      {file.status === "done" && file.publicUrl && !file.meetingId && <a href={file.publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}><ExternalLink size={12} /> View file</a>}
                      <button className="btn btn-ghost btn-sm" onClick={() => removeFile(file.id)} aria-label="Remove from list"><Trash2 size={13} /></button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          <div className="data-card">
            <div className="up-head"><h2>Recent uploads</h2><Link href="/meeting-summary">All meetings</Link></div>
            {recent.length === 0 ? <div className="up-empty">Your uploads will show here.</div> : recent.map(r => (
              <Link key={r.id} href={`/meeting-summary?id=${r.id}`} className="up-recent">
                <span className="up-recent-title">{r.title || "Untitled"}</span>
                <span className="up-recent-date">{new Date(r.started_at ?? r.created_at ?? Date.now()).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                <span className={`badge ${r.status === "complete" ? "badge-green" : r.status === "failed" ? "badge-red" : "badge-amber"}`}>{r.status === "complete" ? "Summary ready" : r.status === "failed" ? "Failed" : "Processing"}</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="data-card up-side">
          <h3>What happens</h3>
          <ol>
            <li><Mic size={14} /><div><strong>Transcribed</strong><span>Every word, with who said it.</span></div></li>
            <li><FileText size={14} /><div><strong>Summarised</strong><span>A short summary and key points.</span></div></li>
            <li><Cpu size={14} /><div><strong>Tasks found</strong><span>Action items with an owner, priority and due date.</span></div></li>
          </ol>
          <p>If something fails, the file stays saved and you can press Retry.</p>
        </aside>
      </div>

      {toast && (
        <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.ok ? <CheckCircle2 size={16} color="var(--emerald-pulse)" /> : <AlertCircle size={16} color="var(--crimson)" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const UP_CSS = `
@keyframes spin { to { transform: rotate(360deg); } }
.up-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 18px; padding: 24px 36px; align-items: start; }
@media (max-width: 1000px) { .up-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .up-layout { padding: 16px; } }
.up-drop { display: flex; align-items: center; gap: 16px; padding: 22px 24px; border-radius: 14px; border: 1.5px dashed rgba(14,165,233,0.45); background: rgba(14,165,233,0.04); cursor: pointer; transition: all 150ms; outline: none; }
.up-drop:hover, .up-drop:focus-visible { border-color: #0EA5E9; background: rgba(14,165,233,0.07); }
.up-drop.on { border-style: solid; border-color: #0EA5E9; background: rgba(14,165,233,0.12); transform: scale(1.01); box-shadow: 0 0 0 4px rgba(14,165,233,0.15); }
.up-drop-icon { width: 44px; height: 44px; border-radius: 12px; background: rgba(14,165,233,0.14); color: #38BDF8; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.up-drop-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.up-drop-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
.up-paste { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.up-paste h3 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0; }
.up-paste p { font-size: 13px; color: var(--text-muted); margin: 0; }
.up-paste textarea { min-height: 150px; }
.up-count { margin-left: auto; font-size: 12px; color: var(--text-muted); }
.up-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--glass-border); }
.up-head h2 { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; }
.up-head span { font-size: 12px; color: var(--text-muted); }
.up-head a { font-size: 12px; color: #38BDF8; text-decoration: none; }
.up-file { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-top: 1px solid var(--glass-border); }
.up-file:first-of-type { border-top: 0; }
.up-file-icon { width: 36px; height: 36px; border-radius: 10px; background: var(--bg-raised); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.up-file-name { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-file-name span { font-size: 12px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
.up-stages { display: flex; gap: 14px; list-style: none; padding: 0; margin: 6px 0 0; flex-wrap: wrap; }
.up-stages li { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); }
.up-stages li.now { color: #38BDF8; font-weight: 600; }
.up-stages li.done { color: var(--emerald-pulse); }
.up-bar { height: 4px; border-radius: 3px; background: rgba(127,127,127,0.15); margin-top: 7px; overflow: hidden; max-width: 260px; }
.up-bar div { height: 100%; background: #0EA5E9; transition: width 300ms; }
.up-note { font-size: 11px; color: var(--text-muted); margin-top: 5px; }
.up-error { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--crimson); margin-top: 4px; }
.up-error .btn { padding: 2px 10px; font-size: 11px; }
.up-empty { padding: 20px 18px; font-size: 13px; color: var(--text-muted); }
.up-recent { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 1px solid var(--glass-border); text-decoration: none; transition: background 150ms; }
.up-recent:nth-child(2) { border-top: 0; }
.up-recent:hover { background: rgba(14,165,233,0.05); }
.up-recent-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-recent-date { font-size: 12px; color: var(--text-muted); }
.up-side { padding: 16px 18px; }
.up-side h3 { font-size: 13px; font-weight: 700; color: var(--text-primary); margin: 0 0 12px; }
.up-side ol { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 12px; }
.up-side li { display: flex; gap: 10px; align-items: flex-start; }
.up-side li svg { color: #38BDF8; margin-top: 2px; flex-shrink: 0; }
.up-side li div { display: flex; flex-direction: column; }
.up-side li strong { font-size: 13px; color: var(--text-primary); }
.up-side li span { font-size: 12px; color: var(--text-muted); }
.up-side p { font-size: 12px; color: var(--text-muted); margin: 0; border-top: 1px solid var(--glass-border); padding-top: 10px; }
`;
