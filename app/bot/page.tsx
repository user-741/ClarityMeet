"use client";
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from "react";
import type React from "react";
import {
  Video, Zap, Clock, Users, Square, CheckCircle2,
  AlertCircle, RefreshCw, Link as LinkIcon, Music,
  ExternalLink, Settings, Monitor, Info,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/app/components/WorkspaceContext";

// Backend URL config
// Always use the Next.js proxy route. Never call the tunnel directly from the
// browser (avoids CORS + ngrok interstitial issues entirely).
// NEXT_PUBLIC_BACKEND_URL is read server-side by /api/backend/[...path]/route.ts
const BACKEND_URL = "/api/backend";

type Platform = "zoom" | "meet" | "teams" | "unknown";
type BotStatus =
  | "spawning" | "launching" | "navigating" | "joining"
  | "joined" | "recording" | "processing" | "stopping"
  | "stopped" | "completed" | "error";

const ACTIVE_STATUSES: BotStatus[] = [
  "spawning", "launching", "navigating", "joining",
  "joined", "recording", "processing", "stopping",
];

const STATUS_CFG: Record<BotStatus, { label: string; badge: string; spin?: boolean }> = {
  spawning:   { label: "Starting...",        badge: "badge-amber", spin: true },
  launching:  { label: "Launching browser", badge: "badge-amber", spin: true },
  navigating: { label: "Opening meeting...",  badge: "badge-amber", spin: true },
  joining:    { label: "Joining meeting...", badge: "badge-blue",  spin: true },
  joined:     { label: "Confirming access...",   badge: "badge-blue",  spin: true },
  recording:  { label: "Bot in meeting",    badge: "badge-red"              },
  processing: { label: "Processing...",       badge: "badge-amber", spin: true },
  stopping:   { label: "Stopping...",         badge: "badge-amber", spin: true },
  stopped:    { label: "Meeting ended",     badge: "badge-amber"            },
  completed:  { label: "Completed",         badge: "badge-green"            },
  error:      { label: "Error",             badge: "badge-red"              },
};

// All 3 platforms are now LIVE (backend handles them all)
const PLATFORM_CFG: Record<Platform, {
  label: string; color: string; icon: React.ComponentType<{ size?: number | string }>;
  live: boolean; hint: string;
}> = {
  zoom:    { label: "Zoom",        color: "#2D8CFF", icon: Video, live: true,  hint: "Works out of the box, no login needed" },
  meet:    { label: "Google Meet", color: "#34A853", icon: Monitor, live: true,  hint: "Guest join works; set GOOGLE_EMAIL in backend .env for smoother joins" },
  teams:   { label: "MS Teams",    color: "#6264A7", icon: Users, live: true,  hint: "Guest join works; set TEAMS_EMAIL in backend .env for org meetings" },
  unknown: { label: "Unknown",     color: "#888",   icon: LinkIcon, live: false, hint: "Paste a Zoom, Google Meet, or Teams link" },
};

interface ActiveBot {
  id: string;
  botName: string;
  zoomLink: string;
  platform: string;
  status: BotStatus;
  startTime: string;
  endTime: string | null;
  userId: string;
  meetingId: string | null;
  recordingUrl: string | null;
  recordingStatus: string;
}

function detectPlatform(url: string): Platform {
  if (!url) return "unknown";
  if (url.includes("zoom.us"))                                                return "zoom";
  if (url.includes("meet.google.com"))                                        return "meet";
  if (url.includes("teams.microsoft.com") || url.includes("teams.live.com")) return "teams";
  return "unknown";
}

function elapsed(startIso: string, endIso?: string | null) {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const s = Math.floor((end - new Date(startIso).getTime()) / 1000);
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m ${s % 60}s`;
}

export default function BotPage() {
  const { activeWorkspace } = useWorkspace();
  const [link,        setLink]        = useState("");
  const [platform,    setPlatform]    = useState<Platform>("unknown");
  const [activeBots,  setActiveBots]  = useState<ActiveBot[]>([]);
  const [online,      setOnline]      = useState<boolean | null>(null);
  const [stats,       setStats]       = useState<{ total_meetings: number; total_tasks: number } | null>(null);
  const [deploying,   setDeploying]   = useState(false);
  const [now,         setNow]         = useState(() => Date.now());
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [showConfig,  setShowConfig]  = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState<string | null>(null);
  const [recordingLink, setRecordingLink] = useState<string>("");
  const userIdRef   = useRef<string | null>(null);
  const workspaceRef = useRef<string | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    setPlatform(link.trim() ? detectPlatform(link) : "unknown");
  }, [link]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Track consecutive offline count for backoff
  const offlineCountRef = useRef(0);

  const poll = useCallback(async () => {
    try {
      const r = await authFetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        offlineCountRef.current = 0;
        setOnline(true);
        const s = await authFetch(`${BACKEND_URL}/record/status`, { signal: AbortSignal.timeout(8000) });
        if (s.ok) {
          const { recording: isRecording, startTime: serverStart, zoomLink: serverLink } = await s.json();
          setRecording(isRecording);
          // After a page refresh local state is empty, so fall back to what the
          // backend reports - otherwise the Stop button disappears mid-recording.
          const start = recordingStart ?? serverStart ?? null;
          const activeLink = recordingLink || serverLink || "";
          if (isRecording && start) {
            setActiveBots([{
              id: "local-recording",
              botName: "Local Recorder",
              zoomLink: activeLink,
              platform: detectPlatform(activeLink),
              status: "recording",
              startTime: start,
              endTime: null,
              userId: userIdRef.current ?? "anonymous",
              meetingId: null,
              recordingUrl: null,
              recordingStatus: "recording",
            }]);
          } else {
            setActiveBots([]);
          }
        }
      } else {
        offlineCountRef.current += 1;
        setOnline(false);
      }
    } catch {
      offlineCountRef.current += 1;
      setOnline(false);
    }
  }, [recordingStart, recordingLink]);

  const loadStats = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) return;
    userIdRef.current = user.id;
    const ws = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!ws) return;
    workspaceRef.current = ws;
    const { data } = await supabase
      .from("workspace_stats").select("total_meetings,total_tasks")
      .eq("workspace_id", ws).single();
    if (data) setStats({ total_meetings: data.total_meetings ?? 0, total_tasks: data.total_tasks ?? 0 });
  }, [activeWorkspace]);

  useEffect(() => {
    poll(); loadStats();
    // Adaptive polling: 5 s when online, back off to 30 s after 3 failures, 60 s after 6+
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const count = offlineCountRef.current;
      const delay = count === 0 ? 5000 : count < 3 ? 10000 : count < 6 ? 30000 : 60000;
      id = setTimeout(async () => { await poll(); schedule(); }, delay);
    };
    schedule();
    return () => clearTimeout(id);
  }, [poll, loadStats]);

  const deploy = async () => {
    if (!link.trim()) { showToast("Paste a meeting link first", false); return; }
    if (platform === "unknown") { showToast("Unrecognised link. Paste a Zoom, Meet, or Teams URL.", false); return; }
    if (!online) { showToast("Backend server is offline. Start the local service first.", false); return; }
    if (recording) { showToast("A recording is already in progress. Stop it before starting another one.", false); return; }

    setDeploying(true);
    const user = await getCurrentUser();
    try {
      const res = await authFetch(`${BACKEND_URL}/record/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoomLink: link,
          userId:   user?.id ?? "anonymous",
          workspaceId: activeWorkspace?.workspace_id ?? workspaceRef.current,
        }),
      });
      const json = await res.json();
      if (res.status === 409) { showToast("Already recording", false); setDeploying(false); return; }
      if (!res.ok) throw new Error(json.error ?? "Unknown error");
      showToast(
        json.joinMode === "auto"
          ? "Joining automatically on the host laptop. Recording has started and will stop by itself when the meeting ends."
          : "Recording started. This platform opens in the browser - click Join there on the host laptop.",
        true,
      );
      setRecording(true);
      setRecordingStart(new Date().toISOString());
      setRecordingLink(link);
      setLink("");
      await poll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to start recording", false);
    }
    setDeploying(false);
  };

  const [stoppingBots, setStoppingBots] = useState<Set<string>>(new Set());

  const stopBot = async (id: string) => {
    if (!online) { showToast("Backend is offline. Restart the local service first.", false); return; }
    setStoppingBots(prev => new Set(prev).add(id));
    try {
      const res = await authFetch(`${BACKEND_URL}/record/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json.warning) {
        showToast("Recording stopped. Transcription is now in progress. Check Meeting Summary shortly.", true);
      } else if (json.warning) {
        showToast(json.warning, false);
      } else {
        showToast(json.error ?? `Stop failed (${res.status})`, false);
      }
      setRecording(false);
      setRecordingStart(null);
      setRecordingLink("");
    } catch (e: unknown) {
      showToast(e instanceof Error && e.name === "TimeoutError"
        ? "Request timed out. The backend may be unavailable."
        : "Could not reach the backend. Confirm the service is running.", false);
    } finally {
      setStoppingBots(prev => { const s = new Set(prev); s.delete(id); return s; });
      await poll();
    }
  };

  const pc = PLATFORM_CFG[platform];
  const liveBots = activeBots.filter(b => ACTIVE_STATUSES.includes(b.status as BotStatus));
  const doneBots = activeBots.filter(b => !ACTIVE_STATUSES.includes(b.status as BotStatus));

  // Memoize elapsed so `now` re-renders the time only
  const _ = now; // reference to trigger re-render

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-header-title">Meeting Bots</div>
          <div className="page-header-sub">Deploy meeting bots to Zoom, Google Meet, or Teams.</div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* Server status */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 14px", background: "var(--glass-white)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-md)" }}>
            {online === null
              ? <RefreshCw size={13} color="var(--text-muted)" style={{ animation: "spin 1s linear infinite" }} />
              : <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: online ? "var(--emerald-pulse)" : "var(--crimson)", boxShadow: online ? "0 0 6px var(--emerald-pulse)" : undefined }} />}
            <span style={{ fontSize: "13px", fontWeight: 600, color: online === null ? "var(--text-muted)" : online ? "var(--emerald-pulse)" : "var(--crimson)" }}>
              {online === null ? "Checking..." : online ? "Server online" : "Server offline"}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowConfig(s => !s)} title="Configure backend URL">
            <Settings size={13} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={poll}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      <div style={{ padding: "28px 36px" }}>
        {/* Backend status panel */}
        <AnimatePresence>
          {showConfig && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="liquid-card" style={{ padding: "20px 24px", marginBottom: "20px" }}>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "10px" }}>
                Service Status
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className={`status-dot ${online ? 'status-online' : 'status-offline'}`} />
                <span style={{ fontSize: "13px", color: online ? "var(--success)" : "var(--crimson)" }}>
                  {online === null ? "Checking..." : online ? "Connected. Service is available." : "Offline. Service is unavailable."}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => { offlineCountRef.current = 0; poll(); }} style={{ marginLeft: "auto" }}>Refresh</button>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                If the service is unavailable, please contact your administrator.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Offline banner shown when the backend is unreachable */}
        {online === false && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{
              display: "flex", alignItems: "flex-start", gap: "14px",
              padding: "16px 20px", marginBottom: "20px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <AlertCircle size={18} color="var(--crimson)" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--crimson)", marginBottom: "4px" }}>
                Bot server is offline
              </p>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: "10px" }}>
                The backend server isn&apos;t running. Please contact your administrator or try again shortly.
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => { offlineCountRef.current = 0; poll(); }}
                style={{ whiteSpace: "nowrap" }}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </motion.div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px" }}>

          {/* Left */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* Platform pills, all live */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {(["zoom","meet","teams"] as const).map(p => {
                const cfg = PLATFORM_CFG[p];
                const PlatformIcon = cfg.icon;
                return (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "var(--radius-pill)", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px" }}><PlatformIcon size={16} /></span>
                    <div className="status-dot status-online" />
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--emerald-pulse)" }}>{cfg.label}</span>
                    <span style={{ fontSize: "10px", background: "rgba(16,185,129,0.15)", color: "var(--emerald-pulse)", padding: "1px 7px", borderRadius: "4px", fontWeight: 700 }}>LIVE</span>
                  </div>
                );
              })}
            </div>

            {/* Deploy panel */}
            <div className="liquid-card" style={{ padding: "28px" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
                Deploy Bot to a Meeting
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px", lineHeight: 1.6 }}>
                Paste any meeting link from Zoom, Google Meet, or Teams. The platform is detected automatically. The bot records audio and generates a meeting summary when the session ends.
              </p>

              {/* Link input */}
              <div style={{ position: "relative", marginBottom: "14px" }}>
                <LinkIcon size={13} color="var(--text-muted)" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://zoom.us/j/...  or  https://meet.google.com/...  or  https://teams.microsoft.com/..."
                  value={link}
                  onChange={e => setLink(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && deploy()}
                  style={{ paddingLeft: "36px", paddingRight: platform !== "unknown" ? "150px" : "14px" }}
                />
                {platform !== "unknown" && (
                  <div style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "6px", padding: "3px 10px", borderRadius: "var(--radius-pill)", background: `${pc.color}18`, border: `1px solid ${pc.color}40` }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><pc.icon size={14} /> {pc.label}</span>
                    <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--emerald-pulse)", boxShadow: "0 0 5px var(--emerald-pulse)" }} />
                    <span style={{ fontSize: "11px", fontWeight: 700, color: pc.color }}>{pc.label}</span>
                  </div>
                )}
              </div>

              {/* Platform hint */}
              {platform !== "unknown" && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px", padding: "8px 12px", background: "var(--glass-white)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)" }}>
                  <Info size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} /> {pc.hint}
                </motion.p>
              )}

              <button
                className="btn btn-primary"
                onClick={deploy}
                disabled={deploying || !link.trim() || !online}
                style={{ opacity: (deploying || !link.trim() || !online) ? 0.6 : 1 }}
              >
                {deploying
                  ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Deploying...</>
                  : <><Zap size={13} /> Deploy Bot</>}
              </button>

              {!online && (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "10px" }}>
                  Server offline. Please contact your administrator.
                </p>
              )}
            </div>

            {/* Active bots table */}
            <div className="data-card">
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                  Active Bots ({liveBots.length})
                </h2>
                {liveBots.some(b => b.status === "recording") && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "3px 10px", borderRadius: "var(--radius-pill)", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--crimson)", animation: "pulse 1.5s ease-in-out infinite" }} />
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--crimson)" }}>LIVE</span>
                  </div>
                )}
              </div>

              {liveBots.length === 0 && doneBots.length === 0 ? (
                <div className="empty-state">
                  <Video size={30} color="var(--text-disabled)" />
                  <p style={{ marginTop: "12px", fontSize: "14px" }}>No active bots</p>
                  <p style={{ fontSize: "12px", marginTop: "4px" }}>Deploy a bot above to start recording</p>
                </div>
              ) : (
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {[...liveBots, ...doneBots].map(bot => {
                    const sc = STATUS_CFG[bot.status as BotStatus] ?? STATUS_CFG.spawning;
                    const botPlatform = PLATFORM_CFG[bot.platform as Platform] ?? PLATFORM_CFG.unknown;
                    const BotIcon = botPlatform.icon;
                    const isActive = ACTIVE_STATUSES.includes(bot.status as BotStatus);
                    return (
                      <motion.div key={bot.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="liquid-card" style={{ padding: "18px 22px", opacity: isActive ? 1 : 0.82 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px" }}><BotIcon size={16} /></span>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>{bot.botName || bot.id}</span>
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace", marginBottom: "3px" }}>{bot.id}</div>
                            <div style={{ fontSize: "12px", color: "var(--text-secondary)", wordBreak: "break-all" }}>{bot.zoomLink}</div>
                          </div>
                          <span className={`badge ${sc.badge}`} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                            {sc.spin ? <RefreshCw size={10} style={{ animation: "spin 1s linear infinite" }} /> : <span className="badge-dot" />}
                            {sc.label}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "16px", marginBottom: "14px" }}>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "5px" }}>
                            <Clock size={12} />{bot.startTime ? elapsed(bot.startTime, ACTIVE_STATUSES.includes(bot.status as BotStatus) ? null : bot.endTime) : "N/A"}
                          </span>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "5px" }}>
                            <Users size={12} />{bot.userId}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          {isActive && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => stopBot(bot.id)}
                              disabled={stoppingBots.has(bot.id) || !online}
                              style={{ opacity: stoppingBots.has(bot.id) || !online ? 0.6 : 1 }}
                            >
                              {stoppingBots.has(bot.id)
                                ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> Stopping...</>
                                : <><Square size={12} /> Stop Bot</>}
                            </button>
                          )}
                          {bot.recordingUrl && (
                            <a href={bot.recordingUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                              <Music size={12} /> Recording <ExternalLink size={10} />
                            </a>
                          )}
                          {!isActive && bot.status === "completed" && bot.meetingId && (
                            <a
                              href={`/meeting-summary?id=${bot.meetingId}`}
                              className="btn btn-secondary btn-sm"
                              style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "6px" }}
                            >
                              <CheckCircle2 size={12} color="var(--emerald-pulse)" /> View Summary
                            </a>
                          )}
                          {!isActive && bot.status === "completed" && !bot.meetingId && (
                            <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "5px" }}>
                              <CheckCircle2 size={13} color="var(--emerald-pulse)" /> Session ended
                            </span>
                          )}
                          {!isActive && bot.status === "error" && (
                            <span style={{ fontSize: "12px", color: "var(--crimson)", display: "flex", alignItems: "center", gap: "5px" }}>
                              <AlertCircle size={13} /> Session ended with error
                            </span>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="stat-card">
              <div style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 800, color: "#0EA5E9", marginBottom: "5px" }}>
                {stats?.total_meetings ?? "N/A"}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Meetings recorded</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>All time</div>
            </div>
            <div className="stat-card">
              <div style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 800, color: "#10B981", marginBottom: "5px" }}>
                {activeBots.length}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Bots deployed</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>This session</div>
            </div>
            <div className="stat-card">
              <div style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 800, color: "#A78BFA", marginBottom: "5px" }}>
                {stats?.total_tasks ?? "N/A"}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Tasks extracted</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>Auto-assigned</div>
            </div>

            {/* How it works */}
            <div className="liquid-card" style={{ padding: "20px" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px" }}>How it works</h3>
              {[
                "Paste a Zoom, Teams, or Meet link from any device",
                "The host laptop opens the Zoom/Teams app and joins automatically as \"ClarityMeet Notetaker\"",
                "Meeting audio is recorded on the host laptop",
                "When the meeting window closes, recording stops by itself and the summary + tasks appear in your dashboard",
              ].map((text, i) => (
                <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "13px" }}>
                  <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "11px", fontWeight: 800, color: "#7DD3FC", fontFamily: "var(--font-display)" }}>{i + 1}</div>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Platform status */}
            <div className="liquid-card" style={{ padding: "20px" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "14px" }}>Platform status</h3>
              {[
                { name: "Zoom",          icon: Video, live: true,  note: "Auto-joins in the desktop app" },
                { name: "MS Teams",      icon: Users, live: true,  note: "Auto-joins in the desktop app" },
                { name: "Google Meet",   icon: Monitor, live: true,  note: "Opens in browser - click Join" },
                { name: "Webex",         icon: LinkIcon, live: false, note: "Planned" },
                { name: "Whereby",       icon: LinkIcon, live: false, note: "Planned" },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--glass-border)" }}>
                    <div>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)" }}><Icon size={14} /> {item.name}</span>
                      <div style={{ fontSize: "11px", color: "var(--text-disabled)", marginTop: "1px" }}>{item.note}</div>
                    </div>
                    {item.live
                      ? <span className="badge badge-green">Live</span>
                      : <span className="badge badge-muted">Soon</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.ok
            ? <CheckCircle2 size={15} color="var(--emerald-pulse)" />
            : <AlertCircle size={15} color="var(--crimson)" />}
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        .now-hidden { display:none; }
      `}</style>
      {/* Force tick re-render */}
      <span className="now-hidden">{_}</span>
    </div>
  );
}