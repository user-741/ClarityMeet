"use client";
export const dynamic = 'force-dynamic';
// Upload & Transcribe, real Supabase Storage upload to "recordings" bucket.


import { useState, useRef, useCallback } from "react";
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

const STATUS_CONFIG: Record<UploadStatus, { label: string; badgeClass: string }> = {
  idle:       { label: "Ready",       badgeClass: "badge-muted" },
  uploading:  { label: "Uploading",   badgeClass: "badge-blue" },
  processing: { label: "AI Processing", badgeClass: "badge-amber" },
  done:       { label: "Complete",    badgeClass: "badge-green" },
  error:      { label: "Failed",      badgeClass: "badge-red" },
};

export default function UploadPage() {
  const { activeWorkspace } = useWorkspace();
  const [files,     setFiles]     = useState<UploadedFile[]>([]);
  const [dragging,  setDragging]  = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const StatusIcon = ({ status }: { status: UploadStatus }) => {
    if (status === "done")       return <CheckCircle2 size={15} color="var(--emerald-pulse)" />;
    if (status === "processing") return <Loader2 size={15} color="var(--amber-alert)" style={{ animation: "spin 1.2s linear infinite" }} />;
    if (status === "uploading")  return <Loader2 size={15} color="#7DD3FC" style={{ animation: "spin 1.2s linear infinite" }} />;
    if (status === "error")      return <AlertCircle size={15} color="var(--crimson)" />;
    return null;
  };

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <div className="page-header">
        <div>
          <div className="page-header-title">Upload &amp; Transcribe</div>
          <div className="page-header-sub">Upload Zoom or any meeting recording - Gemini AI transcribes and summarises automatically</div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn btn-secondary" onClick={() => setPasteMode(!pasteMode)}>Paste transcript</button>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()}><Upload size={13} /> Upload files</button>
          <input ref={inputRef} type="file" multiple accept="audio/*,video/*,.txt" style={{ display: "none" }} onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
        </div>
      </div>

      <div style={{ padding: "28px 36px" }}>
        <AnimatePresence>
          {pasteMode && (
            <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="liquid-card" style={{ padding: "24px", marginBottom: "20px" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>Paste a Transcript</h3>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>Paste raw meeting notes or an existing transcript for AI summarisation and task extraction.</p>
              <textarea
                className="form-textarea"
                placeholder="[00:00] Speaker: Text goes here..."
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                style={{ marginBottom: "14px", minHeight: "140px" }}
              />
              <div style={{ display: "flex", gap: "10px" }}>
                <button className="btn btn-primary" onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
                  <Sparkles size={13} /> Process with AI
                </button>
                <button className="btn btn-ghost" onClick={() => { setPasteMode(false); setPasteText(""); }}>Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          style={{ marginBottom: "28px" }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div style={{ width: "52px", height: "52px", background: "rgba(14,165,233,0.1)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Upload size={22} color="#7DD3FC" />
          </div>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
            Drop files here or click to browse
          </p>
          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Supports MP4, MP3, M4A, WAV, and .txt transcripts · AI transcription via Gemini</p>
          <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "16px" }}>
            {["MP4","MP3","WAV","M4A","TXT"].map(f => (
              <span key={f} className="badge badge-muted">{f}</span>
            ))}
          </div>
        </div>

        {files.length > 0 && (
          <div className="data-card">
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                Files ({files.length})
              </h2>
              <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "var(--text-muted)" }}>
                <span className="badge badge-green">{files.filter(f => f.status === "done").length} complete</span>
                <span className="badge badge-amber">{files.filter(f => f.status === "processing" || f.status === "uploading").length} processing</span>
                {files.filter(f => f.status === "error").length > 0 && (
                  <span className="badge badge-red">{files.filter(f => f.status === "error").length} failed</span>
                )}
              </div>
            </div>

            <div>
              <AnimatePresence>
                {files.map((file, i) => (
                  <motion.div
                    key={file.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ delay: i * 0.04 }}
                    style={{
                      display: "flex", alignItems: "center", gap: "14px",
                      padding: "16px 24px",
                      borderBottom: i < files.length - 1 ? "1px solid var(--glass-border)" : "none",
                    }}
                  >
                    <div style={{ width: "38px", height: "38px", background: "var(--bg-raised)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <TypeIcon type={file.type} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "4px" }}>
                        {file.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{file.size}</span>
                        {(file.status === "uploading" || file.status === "processing") && (
                          <div style={{ flex: 1, maxWidth: "120px" }}>
                            <div className="progress-track">
                              <div className={`progress-fill ${file.status === "processing" ? "progress-fill-amber" : ""}`} style={{ width: `${file.progress}%` }} />
                            </div>
                          </div>
                        )}
                        {file.status === "error" && file.errorMsg && (
                          <span style={{ fontSize: "11px", color: "var(--crimson)" }}>{file.errorMsg}</span>
                        )}
                        {file.status === "error" && file.retry && (
                          <button className="btn btn-secondary btn-sm" style={{ padding: "2px 10px", fontSize: "11px" }}
                            onClick={() => { const r = file.retry!; triggerAIPipeline(r.meetingId, r.storagePath, r.workspaceId, r.userId, file.id); }}>
                            Retry
                          </button>
                        )}
                        {file.status === "done" && file.storagePath && (
                          <span style={{ fontSize: "11px", color: "var(--emerald-pulse)" }}>
                            {file.aiEnabled ? "AI transcription complete" : "Saved to cloud storage"}
                          </span>
                        )}
                        {file.status === "processing" && (
                          <span style={{ fontSize: "11px", color: "var(--amber-alert)" }}>Transcribing with Gemini...</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <StatusIcon status={file.status} />
                      <span className={`badge ${STATUS_CONFIG[file.status].badgeClass}`}>
                        {STATUS_CONFIG[file.status].label}
                      </span>
                    </div>

                    {file.status === "done" && file.meetingId && (
                      <Link
                        href={`/meeting-summary?id=${file.meetingId}`}
                        className="btn btn-secondary btn-sm"
                        style={{ textDecoration: "none" }}
                      >
                        <Sparkles size={12} /> View Summary
                      </Link>
                    )}

                    {file.status === "done" && file.publicUrl && !file.meetingId && (
                      <a href={file.publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                        <ExternalLink size={12} /> View file
                      </a>
                    )}

                    <button className="btn btn-ghost btn-sm" onClick={() => removeFile(file.id)} style={{ color: "var(--text-muted)" }}>
                      <Trash2 size={13} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px", marginTop: "24px" }} className="stagger">
          {[
            { icon: Mic, title: "Gemini transcription", desc: "Gemini 2.5 Flash converts your audio to accurate text with speaker detection" },
            { icon: Cpu, title: "AI task extraction", desc: "Automatically pulls out action items, priorities, and assignees" },
            { icon: FileText, title: "Instant summary",         desc: "Get a structured executive summary within minutes of upload" },
          ].map(c => (
            <div key={c.title} className="liquid-card" style={{ padding: "22px" }}>
              <span style={{ width: "36px", height: "36px", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "12px", color: "var(--text-primary)" }}><c.icon size={24} /></span>
              <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px", fontFamily: "var(--font-display)" }}>{c.title}</h3>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.ok
            ? <CheckCircle2 size={16} color="var(--emerald-pulse)" />
            : <AlertCircle size={16} color="var(--crimson)" />}
          {toast.msg}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}