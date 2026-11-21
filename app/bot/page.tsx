"use client";
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from "react";
import type React from "react";
import {
  Video, Zap, Clock, Users, Square, CheckCircle2,
  AlertCircle, RefreshCw, Link as LinkIcon, Monitor, Info,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/app/components/WorkspaceContext";

// Backend URL config Always use the Next.js proxy route.
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
  zoom:    { label: "Zoom",        color: "#2D8CFF", icon: Video, live: true,  hint: "Joins straight away in the Zoom app, no sign-in needed." },
  meet:    { label: "Google Meet", color: "#34A853", icon: Monitor, live: true,  hint: "Opens in the browser on the recording computer. Someone there presses Join." },
  teams:   { label: "MS Teams",    color: "#6264A7", icon: Users, live: true,  hint: "Joins as a guest in the Teams app. The organiser may need to admit it." },
  unknown: { label: "Unknown",     color: "#888",   icon: LinkIcon, live: false, hint: "Paste a Zoom, Teams or Google Meet link." },
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
  const [recording, setRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState<string | null>(null);
  const [recordingLink, setRecordingLink] = useState<string>("");
  const [recent, setRecent] = useState<{ id: string; title: string | null; started_at: string | null; duration_secs: number | null; status: string | null }[]>([]);

  // The Calendar's "Send bot" opens this page with ?url=<meeting link>.
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("url");
    if (u) setLink(u);
  }, []);
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
    const { data: rec } = await supabase
      .from("meetings").select("id, title, started_at, duration_secs, status")
      .eq("workspace_id", ws).in("platform", ["zoom", "teams", "google_meet"]).neq("status", "scheduled")
      .order("started_at", { ascending: false }).limit(6);
    setRecent(rec ?? []);
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
    if (!online) { showToast("ClarityMeet is unavailable right now. Please try again shortly.", false); return; }
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
          ? "ClarityMeet is joining now. Recording has started and will stop by itself when the meeting ends."
          : "Recording started. This platform opens in the browser, so press Join there to let ClarityMeet in.",
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
    if (!online) { showToast("ClarityMeet is unavailable right now. Please try again shortly.", false); return; }
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
  void now; // re-render every second so the live timer moves

  const canDeploy = !deploying && !!link.trim() && platform !== "unknown" && !!online && !recording;
  const blockedReason = online === false ? "The recording service is offline."
    : recording ? "A meeting is already being recorded. Stop it first."
    : !link.trim() ? "Paste a meeting link to continue."
    : platform === "unknown" ? "That doesn't look like a Zoom, Teams or Google Meet link."
    : "";

  const LIFECYCLE = ["Joining", "Recording", "Processing", "Summary ready"];
  const stage = (b: ActiveBot) => ["spawning", "launching", "navigating", "joining", "joined"].includes(b.status) ? 0
    : b.status === "recording" ? 1 : ["processing", "stopping", "stopped"].includes(b.status) ? 2 : 3;

  return (
    <div style={{ paddingBottom: "48px" }} className="page-enter">
      <style>{BOT_CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-header-title">Meeting Bots</div>
          <div className="page-header-sub">Send ClarityMeet into a call to record it and write the summary.</div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className={`bot-service ${online === null ? "" : online ? "on" : "off"}`}>
            <i />{online === null ? "Checking service..." : online ? "Recording service online" : "Recording service offline"}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => { offlineCountRef.current = 0; poll(); }} aria-label="Check again"><RefreshCw size={13} /></button>
        </div>
      </div>

      <div className="page-body bot-layout">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {online === false && (
            <div className="bot-alert">
              <AlertCircle size={15} />
              <span>The recording service isn&apos;t responding, so bots can&apos;t join right now. You can still upload a recording.</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { offlineCountRef.current = 0; poll(); }}>Retry</button>
            </div>
          )}

          <div className="data-card bot-deploy">
            <h2>Send a bot to a meeting</h2>
            <p>Paste the invite link. ClarityMeet joins as a participant called &ldquo;ClarityMeet&rdquo;, records the call and stops when it ends.</p>
            <div className="bot-input-row">
              <div className="bot-input">
                <LinkIcon size={14} />
                <input type="url" placeholder="https://zoom.us/j/...  ·  teams.microsoft.com/...  ·  meet.google.com/..."
                  value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === "Enter" && canDeploy && deploy()} aria-label="Meeting link" />
                {platform !== "unknown" && <span className="bot-detected" style={{ color: pc.color, borderColor: `${pc.color}55`, background: `${pc.color}14` }}><pc.icon size={12} /> {pc.label}</span>}
              </div>
              <button className="btn btn-primary" onClick={deploy} disabled={!canDeploy}>
                {deploying ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Sending...</> : <><Zap size={13} /> Deploy bot</>}
              </button>
            </div>
            <div className="bot-hint">
              {blockedReason ? <span>{blockedReason}</span> : <span><Info size={12} /> {pc.hint}</span>}
              <span className="bot-supported">Supported: Zoom · Teams · Google Meet</span>
            </div>
          </div>

          <div className="data-card">
            <div className="bot-card-head">
              <h3>Live now</h3>
              {liveBots.length > 0 && <span className="bot-rec"><i /> Recording</span>}
            </div>
            {liveBots.length === 0 ? (
              <div className="bot-empty">No bot is in a meeting right now.</div>
            ) : liveBots.map(bot => {
              const bp = PLATFORM_CFG[bot.platform as Platform] ?? PLATFORM_CFG.unknown;
              const st = stage(bot);
              return (
                <div key={bot.id} className="bot-live">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="bot-live-title"><bp.icon size={14} /> {bp.label} meeting</div>
                      <div className="bot-live-link">{bot.zoomLink}</div>
                    </div>
                    <div className="bot-timer"><Clock size={13} /> {bot.startTime ? elapsed(bot.startTime) : "-"}</div>
                  </div>
                  <ol className="bot-steps">
                    {LIFECYCLE.map((l, i) => <li key={l} className={i < st ? "done" : i === st ? "now" : ""}><span>{i < st ? <CheckCircle2 size={12} /> : i + 1}</span>{l}</li>)}
                  </ol>
                  <button className="btn btn-danger btn-sm" onClick={() => stopBot(bot.id)} disabled={stoppingBots.has(bot.id) || !online}>
                    {stoppingBots.has(bot.id) ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> Stopping...</> : <><Square size={12} /> Stop and summarise</>}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="data-card">
            <div className="bot-card-head"><h3>Recent recordings</h3><a href="/meeting-summary" className="bot-link">All meetings</a></div>
            {recent.length === 0 ? <div className="bot-empty">Recordings made by the bot will show here.</div> : (
              <table className="data-table">
                <thead><tr><th>Meeting</th><th>When</th><th>Length</th><th>Status</th></tr></thead>
                <tbody>
                  {recent.map(r => (
                    <tr key={r.id} style={{ cursor: r.status === "complete" ? "pointer" : "default" }} onClick={() => { if (r.status === "complete") window.location.href = `/meeting-summary?id=${r.id}`; }}>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.title || "Untitled meeting"}</td>
                      <td style={{ fontSize: "13px" }}>{r.started_at ? new Date(r.started_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-"}</td>
                      <td style={{ fontSize: "13px" }}>{r.duration_secs ? `${Math.round(r.duration_secs / 60)} min` : "-"}</td>
                      <td>
                        <span className={`badge ${r.status === "complete" ? "badge-green" : r.status === "failed" ? "badge-red" : "badge-amber"}`}>
                          {r.status === "complete" ? "Summary ready" : r.status === "failed" ? "Failed" : r.status === "recording" ? "Recording" : "Processing"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="data-card bot-stats">
            <div><strong className="text-gradient">{stats?.total_meetings ?? "-"}</strong><span>Meetings recorded</span></div>
            <div><strong className="text-gradient">{stats?.total_tasks ?? "-"}</strong><span>Tasks extracted</span></div>
            <div><strong className="text-gradient">{liveBots.length}</strong><span>Bots live</span></div>
          </div>

          <div className="data-card bot-side">
            <h3>How it works</h3>
            <ol className="bot-how">
              <li>Paste a Zoom, Teams or Google Meet link</li>
              <li>ClarityMeet joins as a named participant</li>
              <li>The call is recorded while it runs</li>
              <li>When it ends, the summary and tasks appear in Meetings</li>
            </ol>
          </div>

          <div className="data-card bot-side">
            <h3>Platform support</h3>
            {[
              { name: "Zoom", ok: true, note: "Joins in the desktop app" },
              { name: "Microsoft Teams", ok: true, note: "Joins in the desktop app" },
              { name: "Google Meet", ok: true, note: "Opens in the browser, press Join" },
              { name: "Webex", ok: false, note: "Planned" },
            ].map(p => (
              <div key={p.name} className="bot-platform">
                <div><div>{p.name}</div><span>{p.note}</span></div>
                <span className={`badge ${p.ok ? "badge-blue" : "badge-muted"}`}>{p.ok ? "Supported" : "Planned"}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {toast && (
        <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.ok ? <CheckCircle2 size={15} color="var(--emerald-pulse)" /> : <AlertCircle size={15} color="var(--crimson)" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const BOT_CSS = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.bot-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; padding: 24px 36px; align-items: start; }
@media (max-width: 1100px) { .bot-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .bot-layout { padding: 16px; } }
.bot-service { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-muted); border: 1px solid var(--glass-border); }
.bot-service i { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
.bot-service.on { color: var(--emerald-pulse); border-color: rgba(16,185,129,0.35); }
.bot-service.on i { background: var(--emerald-pulse); }
.bot-service.off { color: var(--crimson); border-color: rgba(239,68,68,0.35); }
.bot-service.off i { background: var(--crimson); }
.bot-alert { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; font-size: 13px; color: var(--text-secondary); background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.3); }
.bot-alert svg { color: var(--crimson); flex-shrink: 0; }
.bot-alert span { flex: 1; }
.bot-deploy { padding: 22px; }
.bot-deploy h2 { font-size: 17px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; }
.bot-deploy > p { font-size: 13px; color: var(--text-muted); margin: 0 0 16px; line-height: 1.55; }
.bot-input-row { display: flex; gap: 10px; }
@media (max-width: 640px) { .bot-input-row { flex-direction: column; } }
.bot-input { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 44px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--bg-raised); transition: border-color 150ms, box-shadow 150ms; }
.bot-input:focus-within { border-color: #0EA5E9; box-shadow: 0 0 0 3px rgba(14,165,233,0.18); }
.bot-input svg { color: var(--text-muted); flex-shrink: 0; }
.bot-input input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; }
.bot-detected { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid; font-size: 12px; font-weight: 600; white-space: nowrap; }
.bot-deploy .btn-primary { height: 44px; padding: 0 18px; }
.bot-deploy .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; filter: grayscale(0.4); }
.bot-hint { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--text-muted); }
.bot-hint span { display: inline-flex; align-items: center; gap: 5px; }
.bot-supported { color: var(--text-secondary); }
.bot-card-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--glass-border); }
.bot-card-head h3 { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; }
.bot-link { font-size: 12px; color: #38BDF8; text-decoration: none; }
.bot-rec { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--crimson); }
.bot-rec i { width: 7px; height: 7px; border-radius: 50%; background: var(--crimson); animation: pulse 1.5s ease-in-out infinite; }
.bot-empty { padding: 22px 18px; font-size: 13px; color: var(--text-muted); }
.bot-live { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
.bot-live-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; color: var(--text-primary); }
.bot-live-link { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.bot-timer { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bot-steps { display: flex; gap: 6px; list-style: none; padding: 0; margin: 0; flex-wrap: wrap; }
.bot-steps li { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); padding: 4px 10px 4px 4px; border-radius: 999px; border: 1px solid var(--glass-border); }
.bot-steps li span { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 700; background: rgba(127,127,127,0.15); }
.bot-steps li.done { color: var(--emerald-pulse); }
.bot-steps li.done span { background: rgba(16,185,129,0.15); }
.bot-steps li.now { color: var(--text-primary); border-color: rgba(14,165,233,0.5); }
.bot-steps li.now span { background: #0EA5E9; color: #fff; }
.bot-live .btn-danger { align-self: flex-start; }
.bot-stats { display: grid; grid-template-columns: repeat(3, 1fr); padding: 14px 6px; }
.bot-stats > div { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; border-left: 1px solid var(--glass-border); }
.bot-stats > div:first-child { border-left: 0; }
.bot-stats strong { font-size: 20px; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.bot-stats span { font-size: 11px; color: var(--text-muted); }
.bot-side { padding: 16px 18px; }
.bot-side h3 { font-size: 13px; font-weight: 700; color: var(--text-primary); margin: 0 0 10px; }
.bot-how { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--text-secondary); line-height: 1.45; }
.bot-platform { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--glass-border); font-size: 13px; color: var(--text-primary); }
.bot-platform:first-of-type { border-top: 0; }
.bot-platform span:not(.badge) { font-size: 11px; color: var(--text-muted); }
`;
