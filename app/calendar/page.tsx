"use client";
export const dynamic = 'force-dynamic';


import { useState, useEffect, useCallback } from "react";
import { useRouter }  from "next/navigation";
import Link from "next/link";
import {
  CalendarDays, Video, Clock, Users, ChevronLeft, ChevronRight,
  Plus, RefreshCw, X, Check, AlertCircle, Link2, Wifi,
  Smartphone, Monitor, Upload, Globe,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase }  from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";
import { getFirstWorkspaceId } from "@/lib/workspace";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/app/components/WorkspaceContext";
import type { Database } from "@/lib/database.types";
import { GOOGLE_CLIENT_ID, getGoogleToken, cachedGoogleToken, clearGoogleToken } from "@/lib/google-calendar";

const GOOGLE_FLAG = "cm_gcal_connected";
function googleRemembered() { try { return localStorage.getItem(GOOGLE_FLAG) === "1"; } catch { return false; } }
function rememberGoogle(on: boolean) { try { if (on) localStorage.setItem(GOOGLE_FLAG, "1"); else localStorage.removeItem(GOOGLE_FLAG); } catch { /* ignore */ } }

// Constants
const HOURS  = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00"];
const DAYS   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const COLORS = ["#0EA5E9","#10B981","#A78BFA","#F59E0B","#EC4899","#14B8A6","#F97316"];

type ViewMode = "week" | "month" | "list";
type Platform = "zoom" | "google_meet" | "teams" | "webex" | "upload" | "other";

const PLATFORM_ICONS: Record<Platform, JSX.Element> = {
  zoom: <Video size={14} />,
  google_meet: <Monitor size={14} />,
  teams: <Users size={14} />,
  webex: <Globe size={14} />,
  upload: <Upload size={14} />,
  other: <Link2 size={14} />,
};
const PLATFORM_COLORS: Record<Platform, string> = {
  zoom: "#2D8CFF", google_meet: "#34A853", teams: "#6264A7", webex: "#00B0C3", upload: "#A78BFA", other: "#6B7280",
};

function strColor(s: string) {
  return COLORS[s.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
}
// Day key (YYYY-MM-DD) in the timezone chosen in Profile, so a 9am meeting never lands on the day before.
function toDateStr(iso: string | Date) { return new Date(iso).toLocaleDateString("en-CA"); }
function hourOf(iso: string) { return Number(new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", hourCycle: "h23" }).slice(0, 2)); }
function timeOf(iso: string) { return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); }
function agoText(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
function fmtDuration(secs: number | null) {
  if (!secs) return "-";
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
}
function weekStart(anchor: Date) {
  const d = new Date(anchor);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekDays(anchor: Date) {
  const mon = weekStart(anchor);
  const todayStr = toDateStr(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      label: DAYS[i],
      date: d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
      dateStr: ds,
      isToday: ds === todayStr,
    };
  });
}

// Calendar feed type
type FeedProvider = "google" | "icloud" | "outlook" | "other";
interface CalFeed {
  id:          string;
  name:        string;
  feed_url:    string;
  provider:    FeedProvider;
  last_synced: string | null;
  event_count: number | null;
}

// Add Feed Modal
const PROVIDER_HELP: Record<FeedProvider, { label: string; icon: JSX.Element; steps: string }> = {
  google: {
    label: "Google Calendar",
    icon: <CalendarDays size={18} />,
    steps: "Google Calendar > Settings > [your calendar] > 'Secret address in iCal format' > copy the URL.",
  },
  icloud: {
    label: "iPhone / iCloud",
    icon: <Smartphone size={18} />,
    steps: "iPhone: Calendar app > Calendars > tap the (i) next to the calendar > turn on Public Calendar > Share Link > copy. Or iCloud.com > Calendar > share icon > Public Calendar > copy the link.",
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    icon: <Monitor size={18} />,
    steps: "Outlook on the web > Settings > Calendar > Shared calendars > Publish a calendar > choose calendar and 'Can view all details' > Publish > copy the ICS link.",
  },
  other: {
    label: "Other (.ics feed URL)",
    icon: <Link2 size={18} />,
    steps: "Paste any publicly accessible .ics or webcal:// feed URL.",
  },
};

const FEED_ICONS: Record<FeedProvider, JSX.Element> = {
  google: <CalendarDays size={16} />,
  icloud: <Smartphone size={16} />,
  outlook: <Monitor size={16} />,
  other: <Link2 size={16} />,
};

interface AddFeedModalProps {
  workspaceId: string;
  userId: string;
  onClose: () => void;
  onAdded: (feed: CalFeed) => void;
  onGoogle: () => Promise<void>;
}
function AddFeedModal({ workspaceId, userId, onClose, onAdded, onGoogle }: AddFeedModalProps) {
  const [gBusy, setGBusy] = useState(false);
  const [provider, setProvider] = useState<FeedProvider>("google");
  const [name,     setName]     = useState("");
  const [url,      setUrl]      = useState("");
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  const help = PROVIDER_HELP[provider];
  const handleSave = async () => {
    if (!url.trim()) { setErr("Paste your calendar feed URL"); return; }
    if (!name.trim()) { setErr("Give this calendar a name"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("calendar_feeds").insert({
      user_id:      userId,
      workspace_id: workspaceId,
      name:         name.trim(),
      feed_url:     url.trim(),
      provider,
    }).select("*").single();
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onAdded(data as CalFeed);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="liquid-card" style={{ width: "100%", maxWidth: "500px", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>Connect Live Calendar</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Provider selector */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "20px" }} className="rg-4">
          {(Object.keys(PROVIDER_HELP) as FeedProvider[]).map(p => (
            <button key={p} onClick={() => setProvider(p)}
              style={{ padding: "10px 6px", borderRadius: "var(--radius-sm)", border: `1px solid ${provider === p ? "#0EA5E9" : "var(--glass-border)"}`,
                background: provider === p ? "rgba(14,165,233,0.12)" : "var(--glass-surface)", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", fontSize: "11px",
                fontWeight: provider === p ? 700 : 500, color: provider === p ? "#7DD3FC" : "var(--text-secondary)",
              }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px" }}>{PROVIDER_HELP[p].icon}</span>
              {PROVIDER_HELP[p].label.split(" ")[0]}
            </button>
          ))}
        </div>

        {provider === "google" && GOOGLE_CLIENT_ID && (
          <div style={{ marginBottom: "18px" }}>
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={gBusy}
              onClick={async () => { setGBusy(true); setErr(""); try { await onGoogle(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Google sign-in failed"); } finally { setGBusy(false); } }}>
              {gBusy ? "Connecting..." : <><CalendarDays size={14} /> Sign in with Google</>}
            </button>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px", textAlign: "center" }}>
              Imports your Google Calendar and lets you create Google Meet meetings. Or paste a secret iCal link below.
            </p>
          </div>
        )}

        {/* Instructions */}
        <div style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)", marginBottom: "18px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: "8px" }}>{help.icon} How to get your {help.label} URL:</strong><br />
          {help.steps}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label className="form-label">Calendar name</label>
            <input className="form-input" placeholder={`e.g. My ${help.label}`} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Feed URL (webcal:// or https://)</label>
            <input className="form-input" placeholder="https://calendar.google.com/calendar/ical/..." value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          {err && <p style={{ fontSize: "12px", color: "var(--crimson)" }}>{err}</p>}
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
              {saving ? "Connecting..." : <><Link2 size={13} /> Connect calendar</>}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}


// Schedule Meeting Modal
interface ScheduleModalProps {
  workspaceId: string;
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}
function ScheduleModal({ workspaceId, userId, onClose, onCreated }: ScheduleModalProps) {
  const [addToGoogle, setAddToGoogle] = useState(!!GOOGLE_CLIENT_ID && googleRemembered());
  const [title,    setTitle]    = useState("");
  const [platform, setPlatform] = useState<Platform>("zoom");
  const [meetUrl,  setMeetUrl]  = useState("");
  const [date,     setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [time,     setTime]     = useState("09:00");
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  const handleSave = async () => {
    if (!title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    setErr("");
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();

    const wantsMeet = platform === "google_meet" && !meetUrl.trim();
    if (GOOGLE_CLIENT_ID && (addToGoogle || wantsMeet)) {
      try {
        const token = await getGoogleToken();
        const res = await authFetch("/api/calendar/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", accessToken: token, workspaceId, title: title.trim(), start: scheduledAt, addMeet: wantsMeet }),
        });
        const json = await res.json();
        if (!res.ok) { if (json.reconnect) clearGoogleToken(); throw new Error(json.error || "Could not add to Google Calendar"); }
        rememberGoogle(true);
        setSaving(false);
        onCreated();
        onClose();
        return;
      } catch (e) {
        setSaving(false);
        setErr(e instanceof Error ? e.message : "Could not add to Google Calendar");
        return;
      }
    }

    const { error } = await supabase.from("meetings").insert({
      workspace_id: workspaceId,
      owner_id:     userId,
      title:        title.trim(),
      platform,
      meeting_url:  meetUrl.trim() || null,
      status:       "scheduled",
      started_at:   scheduledAt,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onCreated();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2 }} className="liquid-card" style={{ width: "100%", maxWidth: "440px", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "22px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>Schedule Meeting</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: "6px" }}><X size={15} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label className="form-label">Title *</label>
            <input className="form-input" placeholder="e.g. Q2 Planning" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }} className="rg-2">
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Time</label>
              <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="form-label">Platform</label>
            <select className="form-select" value={platform} onChange={e => setPlatform(e.target.value as Platform)}>
              <option value="zoom">Zoom</option>
              <option value="google_meet">Google Meet</option>
              <option value="teams">Microsoft Teams</option>
              <option value="webex">Webex</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Meeting link (optional)</label>
            <input className="form-input" placeholder={platform === "google_meet" && GOOGLE_CLIENT_ID ? "Leave empty to create a Google Meet link" : "https://zoom.us/j/..."} value={meetUrl} onChange={e => setMeetUrl(e.target.value)} />
          </div>
          {GOOGLE_CLIENT_ID && (
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={addToGoogle || (platform === "google_meet" && !meetUrl.trim())} disabled={platform === "google_meet" && !meetUrl.trim()} onChange={e => setAddToGoogle(e.target.checked)} />
              Also add to my Google Calendar
            </label>
          )}
          {err && <p style={{ fontSize: "12px", color: "var(--crimson)" }}>{err}</p>}
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
              {saving ? "Saving..." : <><Check size={13} /> Save meeting</>}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function SubscribeModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [links, setLinks] = useState<{ https: string; webcal: string } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authFetch("/api/calendar/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not create link"); setLinks(j); })
      .catch(e => setErr(e instanceof Error ? e.message : "Could not create link"));
  }, [workspaceId]);

  const copy = async () => {
    if (!links) return;
    try { await navigator.clipboard.writeText(links.https); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const steps = [
    { icon: <Smartphone size={15} />, name: "iPhone", text: "Open this page on your iPhone and tap Add to iPhone. Or go to Settings > Apps > Calendar > Calendar Accounts > Add Account > Other > Add Subscribed Calendar and paste the link." },
    { icon: <CalendarDays size={15} />, name: "Google Calendar", text: "Other calendars > + > From URL, paste the link. Shows on any phone signed in to that Google account." },
    { icon: <Monitor size={15} />, name: "Outlook", text: "Add calendar > Subscribe from web, paste the link." },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="liquid-card" style={{ width: "100%", maxWidth: "520px", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 800, color: "var(--text-primary)" }}>Show meetings on your phone</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} /></button>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px", lineHeight: 1.6 }}>
          Subscribe to this link and every ClarityMeet meeting in this workspace appears in your calendar app, with the join link and a link to the summary. It updates by itself.
        </p>
        {err && <p style={{ fontSize: "12px", color: "var(--crimson)", marginBottom: "12px" }}>{err}</p>}
        <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
          <input className="form-input" readOnly value={links?.https ?? "Creating link..."} onFocus={e => e.target.select()} style={{ fontSize: "12px" }} />
          <button className="btn btn-secondary btn-sm" onClick={copy} disabled={!links}>{copied ? <><Check size={13} /> Copied</> : "Copy"}</button>
        </div>
        {links && (
          <a className="btn btn-primary" href={links.webcal} style={{ width: "100%", justifyContent: "center", marginBottom: "18px" }}>
            <Smartphone size={14} /> Add to iPhone / Mac Calendar
          </a>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {steps.map(s => (
            <div key={s.name} style={{ display: "flex", gap: "10px", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              <span style={{ marginTop: "2px", color: "var(--text-primary)" }}>{s.icon}</span>
              <span><strong style={{ color: "var(--text-primary)" }}>{s.name}:</strong> {s.text}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "16px" }}>Keep this link private. Anyone with it can see this workspace&apos;s meeting times.</p>
      </motion.div>
    </div>
  );
}

// Main Page
type CalMeeting = Database["public"]["Views"]["meetings_summary"]["Row"] & { color: string; platform: Platform; meeting_url?: string | null };

const CAL_CSS = `
@keyframes spin { to { transform: rotate(360deg); } }
.cal-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; padding: 20px 36px; align-items: start; }
@media (max-width: 1100px) { .cal-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .cal-layout { padding: 16px; } }
.cal-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.cal-range { font-family: var(--font-display); font-size: 17px; font-weight: 800; color: var(--text-primary); margin: 0 6px; }
.cal-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--glass-surface); border: 1px solid var(--glass-border); }
.cal-seg button { border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 7px; cursor: pointer; }
.cal-seg button.on { background: var(--grad-neural); color: #fff; }
.cal-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-surface); color: var(--text-secondary); cursor: pointer; flex-shrink: 0; }
.cal-icon-btn:hover { color: var(--text-primary); border-color: rgba(14,165,233,0.45); }
.cal-icon-btn:disabled { opacity: 0.6; cursor: default; }
.cal-icon-danger:hover { color: var(--crimson); border-color: rgba(239,68,68,0.45); }

.cal-month-head, .cal-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cal-month-head div { padding: 10px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--glass-border); }
.cal-day { min-height: 108px; padding: 6px; border-right: 1px solid var(--glass-border); border-bottom: 1px solid var(--glass-border); min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cal-day:nth-child(7n) { border-right: 0; }
.cal-day.out { background: rgba(127,127,127,0.04); }
.cal-day.out .cal-day-num, .cal-day.out .cal-chip { opacity: 0.45; }
.cal-day-num { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
.cal-day-num span { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border-radius: 12px; }
.cal-day.today .cal-day-num span { background: var(--grad-neural); color: #fff; font-weight: 800; }
.cal-chip { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; text-align: left; border: 0; border-left: 3px solid; border-radius: 6px; padding: 4px 7px; cursor: pointer; font: inherit; color: var(--text-primary); }
.cal-chip:hover { filter: brightness(1.15); }
.cal-chip-time { font-size: 10px; font-family: var(--font-mono); color: var(--text-muted); flex-shrink: 0; }
.cal-chip-title { font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.cal-chip-meta { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
.cal-more { border: 0; background: none; color: #38BDF8; font-size: 11px; font-weight: 600; text-align: left; padding: 2px 4px; cursor: pointer; }

.cal-week-row { display: grid; grid-template-columns: 56px repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--glass-border); }
.cal-week-row:last-child { border-bottom: 0; }
.cal-week-head > div { padding: 10px 6px; text-align: center; }
.cal-week-dow { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.cal-week-date span { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px; margin-top: 4px; font-size: 13px; color: var(--text-primary); }
.cal-week-head .today .cal-week-date span { background: var(--grad-neural); color: #fff; font-weight: 800; }
.cal-week-hour { padding: 8px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.cal-week-cell { border-left: 1px solid var(--glass-border); padding: 4px; min-height: 58px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cal-week-cell.today { background: rgba(14,165,233,0.04); }
.cal-week .cal-chip { flex-direction: column; align-items: flex-start; gap: 1px; }
.cal-week .cal-chip-title { width: 100%; }

.cal-side { display: flex; flex-direction: column; gap: 14px; }
.cal-card { padding: 16px; }
.cal-card-title { font-size: 13px; font-weight: 800; color: var(--text-primary); margin-bottom: 10px; font-family: var(--font-display); }
.cal-empty { font-size: 12px; color: var(--text-muted); line-height: 1.55; margin: 0; }
.cal-hint { font-size: 11px; color: var(--text-muted); margin: 10px 0 0; line-height: 1.5; }
.cal-next { display: flex; gap: 10px; align-items: center; width: 100%; padding: 8px; border-radius: 10px; border: 0; background: transparent; cursor: pointer; font: inherit; color: inherit; }
.cal-next:hover { background: rgba(14,165,233,0.07); }
.cal-next-date { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 54px; padding: 5px 4px; border-radius: 8px; border-left: 3px solid; background: var(--glass-surface); }
.cal-next-date span { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.cal-next-date strong { font-size: 12px; color: var(--text-primary); white-space: nowrap; }
.cal-next-title { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-next-meta { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.cal-conn { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--glass-border); }
.cal-conn:first-of-type { border-top: 0; }
.cal-conn-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: rgba(14,165,233,0.1); color: #38BDF8; flex-shrink: 0; }
.cal-conn-name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-conn-detail { font-size: 11px; color: var(--text-muted); }
.cal-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 0 4px; font-size: 11px; color: var(--text-muted); }
.cal-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cal-legend i { width: 8px; height: 8px; border-radius: 4px; display: inline-block; }

.cal-toast { position: fixed; right: 24px; bottom: 24px; z-index: 950; display: flex; align-items: center; gap: 10px; max-width: 420px; padding: 12px 14px; border-radius: 12px; font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); background: var(--glass-surface); backdrop-filter: blur(12px); border: 1px solid var(--glass-border); color: var(--text-primary); }
.cal-toast.ok { border-color: rgba(16,185,129,0.4); }
.cal-toast.ok svg:first-child { color: var(--emerald-pulse); }
.cal-toast.err { border-color: rgba(239,68,68,0.45); }
.cal-toast.err svg:first-child { color: var(--crimson); }
.cal-toast button { margin-left: auto; border: 0; background: none; color: var(--text-muted); cursor: pointer; display: inline-flex; }
`;

export default function CalendarPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [view,       setView]       = useState<ViewMode>("month");
  const [meetings,   setMeetings]   = useState<CalMeeting[]>([]);
  const [anchor,     setAnchor]     = useState(new Date());
  const [selected,   setSelected]   = useState<CalMeeting | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [wsId,       setWsId]       = useState<string | null>(null);
  const [userId,     setUserId]     = useState<string | null>(null);
  const [showModal,   setShowModal]   = useState(false);
  const [showAddFeed,  setShowAddFeed]  = useState(false);
  const [feeds,        setFeeds]        = useState<CalFeed[]>([]);
  const [syncing,      setSyncing]      = useState<string | null>(null);
  const [syncMsg,      setSyncMsg]      = useState<{ ok: boolean; text: string } | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [googleOn,     setGoogleOn]     = useState(false);
  const [gSyncing,     setGSyncing]     = useState(false);
  const [gLastSync,    setGLastSync]    = useState<string | null>(null);
  const [syncingAll,   setSyncingAll]   = useState(false);

  // Success messages fade out by themselves; errors stay until closed.
  useEffect(() => {
    if (!syncMsg?.ok) return;
    const t = setTimeout(() => setSyncMsg(null), 6000);
    return () => clearTimeout(t);
  }, [syncMsg]);

  const load = useCallback(async () => {
    setLoading(true);
    const user = await getCurrentUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);
    const wsId = activeWorkspace?.workspace_id ??
      (await getFirstWorkspaceId(user.id));
    if (!wsId) { setLoading(false); return; }
    setWsId(wsId);
    const { data } = await supabase
      .from("meetings_summary")
      .select("*")
      .eq("workspace_id", wsId)
      .order("started_at", { ascending: false })
      .limit(200);
    const mapped: CalMeeting[] = (data ?? []).map(m => {
      const row = m as Database["public"]["Views"]["meetings_summary"]["Row"];
      return {
        ...row,
        color:    strColor(row.id ?? ""),
        platform: (row.platform as Platform) ?? "other",
      };
    });
    setMeetings(mapped);
    setLoading(false);
  }, [router, activeWorkspace]);

  useEffect(() => { load(); }, [load, activeWorkspace]);

  // Load calendar feeds
  const loadFeeds = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("calendar_feeds")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true });
    setFeeds((data ?? []) as CalFeed[]);
  }, []);

  useEffect(() => { if (userId) loadFeeds(userId); }, [userId, loadFeeds]);

  // Sync a feed (calls server-side /api/calendar/sync)
  const handleSync = async (feed: CalFeed, silent = false): Promise<{ inserted: number; updated: number } | null> => {
    if (!wsId || !userId) return null;
    setSyncing(feed.id);
    if (!silent) setSyncMsg(null);
    try {
      const res  = await authFetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedId: feed.id, feedUrl: feed.feed_url, workspaceId: wsId, userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (!silent) setSyncMsg({ ok: false, text: json.error || "Sync failed" });
      } else {
        if (!silent || json.inserted || json.updated) {
          setSyncMsg({ ok: true, text: `${feed.name} synced. ${json.inserted} new, ${json.updated ?? 0} updated.` });
        }
        await load();
        if (userId) loadFeeds(userId);
        return { inserted: json.inserted ?? 0, updated: json.updated ?? 0 };
      }
    } catch (e: unknown) {
      if (!silent) setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSyncing(null);
    }
    return null;
  };

  const importGoogle = useCallback(async (opts: { prompt?: boolean; silent?: boolean } = {}) => {
    if (!wsId) return;
    setGSyncing(true);
    try {
      const token = opts.silent ? cachedGoogleToken() : await getGoogleToken(!!opts.prompt);
      if (!token) return;
      const res = await authFetch("/api/calendar/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", accessToken: token, workspaceId: wsId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.reconnect) clearGoogleToken();
        throw new Error(json.error || "Google Calendar sync failed");
      }
      rememberGoogle(true);
      setGoogleOn(true);
      const now = new Date().toISOString();
      setGLastSync(now);
      try { localStorage.setItem("cm_gcal_last", now); } catch { /* ignore */ }
      const toGoogle = (json.pushedNew ?? 0) + (json.pushedUpdated ?? 0);
      if (!opts.silent || json.inserted || json.updated || toGoogle) {
        setSyncMsg({ ok: true, text: `Google Calendar synced. ${json.inserted ?? 0} brought in, ${toGoogle} sent to Google.` });
      }
      await load();
    } catch (e) {
      if (!opts.silent) throw e;
    } finally {
      setGSyncing(false);
    }
  }, [wsId, load]);

  useEffect(() => { try { setGLastSync(localStorage.getItem("cm_gcal_last")); } catch { /* ignore */ } }, []);

  // One button that syncs Google and every linked calendar, then shows one message.
  const syncAll = async () => {
    setSyncingAll(true);
    setSyncMsg(null);
    const failed: string[] = [];
    let brought = 0;
    for (const f of feeds) {
      const r = await handleSync(f, true);
      if (r) brought += r.inserted; else failed.push(f.name);
    }
    if (googleOn) {
      try { await importGoogle({}); } catch { failed.push("Google Calendar"); }
    }
    setSyncingAll(false);
    if (failed.length) setSyncMsg({ ok: false, text: `Could not sync ${failed.join(", ")}. Try again or reconnect it.` });
    else if (!googleOn) setSyncMsg({ ok: true, text: `All calendars synced. ${brought} new meeting${brought === 1 ? "" : "s"}.` });
  };

  useEffect(() => { setGoogleOn(!!GOOGLE_CLIENT_ID && googleRemembered()); }, []);

  const [autoSynced, setAutoSynced] = useState(false);
  useEffect(() => {
    if (autoSynced || !wsId || !userId) return;
    setAutoSynced(true);
    const stale = (f: CalFeed) => !f.last_synced || Date.now() - new Date(f.last_synced).getTime() > 15 * 60 * 1000;
    (async () => {
      for (const f of feeds.filter(stale)) await handleSync(f, true);
      if (googleRemembered()) await importGoogle({ silent: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, userId, feeds]);

  const disconnectGoogle = () => { clearGoogleToken(); rememberGoogle(false); setGoogleOn(false); };

  // Delete a feed
  const handleDeleteFeed = async (feedId: string) => {
    await supabase.from("calendar_feeds").delete().eq("id", feedId);
    setFeeds(f => f.filter(x => x.id !== feedId));
  };

  // Week view data
  const weekDays = getWeekDays(anchor);
  const meetingsOn = (date: string) =>
    meetings.filter(m => m.started_at && toDateStr(m.started_at) === date)
      .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime());

  const step = (dir: number) => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };
  const rangeLabel = view === "week"
    ? `${weekDays[0].date} – ${weekDays[6].date}`
    : anchor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

  const platformIcon = (p: Platform) => PLATFORM_ICONS[p] ?? <Link2 size={13} />;
  const platformColor = (p: Platform) => PLATFORM_COLORS[p] ?? "#6B7280";
  const platformName = (p: Platform) => ({ zoom: "Zoom", google_meet: "Google Meet", teams: "Teams", webex: "Webex", upload: "Upload", other: "Other" })[p] ?? "Other";

  const now = Date.now();
  const upcoming = meetings
    .filter(m => m.started_at && new Date(m.started_at).getTime() > now - 30 * 60000 && m.status !== "complete")
    .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime())
    .slice(0, 5);
  const listUpcoming = meetings.filter(m => m.started_at && new Date(m.started_at).getTime() >= now)
    .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime());
  const listPast = meetings.filter(m => !m.started_at || new Date(m.started_at).getTime() < now);

  const anySyncing = syncingAll || gSyncing || !!syncing;
  const connections = (googleOn ? 1 : 0) + feeds.length;
  const lastSynced = [gLastSync, ...feeds.map(f => f.last_synced)].filter(Boolean).sort().pop() ?? null;

  const statusBadge = (st: string | null) => (
    <span className={`badge ${st === "complete" ? "badge-green" : st === "recording" ? "badge-red" : st === "scheduled" ? "badge-blue" : "badge-muted"}`}>
      {st === "complete" ? "Summarised" : st === "scheduled" ? "Upcoming" : st}
    </span>
  );

  // A meeting chip used in the week and month grids
  const Chip = ({ m, compact = false }: { m: CalMeeting; compact?: boolean }) => (
    <button className="cal-chip" onClick={() => setSelected(m)} title={m.title || "Meeting"}
      style={{ borderLeftColor: platformColor(m.platform), background: `${platformColor(m.platform)}14` }}>
      <span className="cal-chip-time">{m.started_at ? timeOf(m.started_at) : ""}</span>
      <span className="cal-chip-title">{m.title || "Untitled meeting"}</span>
      {!compact && m.duration_secs ? <span className="cal-chip-meta">{fmtDuration(m.duration_secs)}</span> : null}
    </button>
  );

  const ConnectionRow = ({ icon, name, detail, busy, onSync, onRemove }: { icon: JSX.Element; name: string; detail: string; busy: boolean; onSync: () => void; onRemove: () => void }) => (
    <div className="cal-conn">
      <span className="cal-conn-icon">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cal-conn-name">{name}</div>
        <div className="cal-conn-detail">{detail}</div>
      </div>
      <button className="cal-icon-btn" onClick={onSync} disabled={busy} title="Sync now" aria-label={`Sync ${name}`}>
        <RefreshCw size={13} style={busy ? { animation: "spin 0.8s linear infinite" } : {}} />
      </button>
      <button className="cal-icon-btn cal-icon-danger" onClick={onRemove} title="Disconnect" aria-label={`Disconnect ${name}`}>
        <X size={13} />
      </button>
    </div>
  );

  return (
    <>
      <div style={{ paddingBottom: "48px" }} className="page-enter">
        <div className="page-header">
          <div>
            <div className="page-header-title">Calendar</div>
            <div className="page-header-sub">
              {listUpcoming.length} upcoming · {connections ? `${connections} calendar${connections === 1 ? "" : "s"} linked · synced ${agoText(lastSynced)}` : "no calendars linked yet"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {connections > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={syncAll} disabled={anySyncing}>
                <RefreshCw size={13} style={anySyncing ? { animation: "spin 0.8s linear infinite" } : {}} />
                {anySyncing ? "Syncing..." : "Sync now"}
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)} disabled={!wsId || !userId}>
              <Plus size={13} /> New meeting
            </button>
          </div>
        </div>

        <div className="page-body cal-layout">
          {/* Main calendar */}
          <div style={{ minWidth: 0 }}>
            <div className="cal-toolbar">
              {view !== "list" ? (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button className="cal-icon-btn" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
                  <button className="cal-icon-btn" onClick={() => step(1)} aria-label="Next"><ChevronRight size={16} /></button>
                  <span className="cal-range">{rangeLabel}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>Today</button>
                </div>
              ) : <span className="cal-range">All meetings</span>}
              <div className="cal-seg" role="tablist" aria-label="Calendar view">
                {(["month", "week", "list"] as ViewMode[]).map(v => (
                  <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                    {v === "month" ? "Month" : v === "week" ? "Week" : "List"}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "40vh" }}>
                <div style={{ width: "32px", height: "32px", border: "3px solid var(--glass-border)", borderTopColor: "#0EA5E9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              </div>
            ) : (
              <>
                {/* MONTH VIEW */}
                {view === "month" && (
                  <div className="data-card cal-month">
                    <div className="cal-month-head">
                      {DAYS.map(d => <div key={d}>{d}</div>)}
                    </div>
                    <div className="cal-month-grid">
                      {(() => {
                        const y = anchor.getFullYear(), mo = anchor.getMonth();
                        const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday first
                        const cells = Math.ceil((offset + new Date(y, mo + 1, 0).getDate()) / 7) * 7;
                        const todayStr = toDateStr(new Date());
                        return Array.from({ length: cells }).map((_, i) => {
                          const d = new Date(y, mo, i - offset + 1);
                          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                          const inMonth = d.getMonth() === mo;
                          const dayMeetings = meetingsOn(dateStr);
                          const isToday = dateStr === todayStr;
                          return (
                            <div key={dateStr} className={`cal-day${inMonth ? "" : " out"}${isToday ? " today" : ""}`}>
                              <div className="cal-day-num"><span>{d.getDate()}</span></div>
                              {dayMeetings.slice(0, 3).map(m => <Chip key={m.id} m={m} compact />)}
                              {dayMeetings.length > 3 && (
                                <button className="cal-more" onClick={() => { setAnchor(d); setView("week"); }}>+{dayMeetings.length - 3} more</button>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* WEEK VIEW */}
                {view === "week" && (
                  <div className="data-card cal-week">
                    <div className="cal-week-row cal-week-head">
                      <div />
                      {weekDays.map(d => (
                        <div key={d.dateStr} className={d.isToday ? "today" : ""}>
                          <div className="cal-week-dow">{d.label}</div>
                          <div className="cal-week-date"><span>{d.date.split(" ")[0]}</span></div>
                        </div>
                      ))}
                    </div>
                    {HOURS.map(hour => (
                      <div key={hour} className="cal-week-row">
                        <div className="cal-week-hour">{hour}</div>
                        {weekDays.map(d => {
                          const h = Number(hour.slice(0, 2));
                          const inSlot = meetingsOn(d.dateStr).filter(m => {
                            const mh = hourOf(m.started_at!);
                            return mh === h || (mh < 8 && h === 8) || (mh > 18 && h === 18);
                          });
                          return (
                            <div key={d.dateStr} className={`cal-week-cell${d.isToday ? " today" : ""}`}>
                              {inSlot.map(m => <Chip key={m.id} m={m} />)}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {/* LIST VIEW */}
                {view === "list" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                    {[{ label: "Upcoming", rows: listUpcoming }, { label: "Past", rows: listPast.slice(0, 100) }].map(group => (
                      <div key={group.label} className="data-card">
                        <div className="cal-card-title" style={{ padding: "14px 18px 0" }}>{group.label} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {group.rows.length}</span></div>
                        <table className="data-table">
                          <thead><tr><th>Meeting</th><th>Platform</th><th>When</th><th>Length</th><th>Status</th><th></th></tr></thead>
                          <tbody>
                            {group.rows.map(m => (
                              <tr key={m.id} style={{ cursor: "pointer" }} onClick={() => setSelected(m)}>
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: platformColor(m.platform), flexShrink: 0 }} />
                                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{m.title || "Untitled meeting"}</span>
                                  </div>
                                </td>
                                <td><span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>{platformIcon(m.platform)} {platformName(m.platform)}</span></td>
                                <td style={{ fontSize: "13px" }}>{m.started_at ? new Date(m.started_at).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-"}</td>
                                <td style={{ fontSize: "13px" }}>{fmtDuration(m.duration_secs)}</td>
                                <td>{statusBadge(m.status)}</td>
                                <td style={{ textAlign: "right" }}>
                                  {m.meeting_url && m.status !== "complete" && (
                                    <a href={`/bot?url=${encodeURIComponent(m.meeting_url)}`} className="btn btn-ghost btn-sm" style={{ textDecoration: "none", fontSize: "11px" }} onClick={e => e.stopPropagation()}>
                                      <Video size={11} /> Send bot
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {group.rows.length === 0 && (
                              <tr><td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                                {group.label === "Upcoming" ? "Nothing coming up. Schedule a meeting or link a calendar." : "No past meetings yet."}
                              </td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Side panel */}
          <aside className="cal-side">
            <div className="data-card cal-card">
              <div className="cal-card-title">Up next</div>
              {upcoming.length === 0 && <p className="cal-empty">No upcoming meetings.</p>}
              {upcoming.map(m => {
                const start = new Date(m.started_at!);
                const isToday = toDateStr(start) === toDateStr(new Date());
                return (
                  <button key={m.id} className="cal-next" onClick={() => setSelected(m)}>
                    <div className="cal-next-date" style={{ borderColor: platformColor(m.platform) }}>
                      <span>{isToday ? "Today" : start.toLocaleDateString("en-AU", { weekday: "short" })}</span>
                      <strong>{isToday ? timeOf(m.started_at!) : start.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</strong>
                    </div>
                    <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                      <div className="cal-next-title">{m.title || "Untitled meeting"}</div>
                      <div className="cal-next-meta">{platformIcon(m.platform)} {platformName(m.platform)}{!isToday ? ` · ${timeOf(m.started_at!)}` : ""}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="data-card cal-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div className="cal-card-title" style={{ marginBottom: 0 }}>Linked calendars</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddFeed(true)} disabled={!wsId || !userId} style={{ fontSize: "12px" }}>
                  <Plus size={12} /> Add
                </button>
              </div>
              {connections === 0 && (
                <p className="cal-empty">Link Google, Outlook or iCloud to bring your meetings in automatically.</p>
              )}
              {googleOn && (
                <ConnectionRow
                  icon={<CalendarDays size={15} />}
                  name="Google Calendar"
                  detail={`Two-way · synced ${agoText(gLastSync)}`}
                  busy={gSyncing}
                  onSync={() => importGoogle().catch(e => setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Google Calendar sync failed" }))}
                  onRemove={disconnectGoogle}
                />
              )}
              {feeds.map(feed => (
                <ConnectionRow
                  key={feed.id}
                  icon={FEED_ICONS[feed.provider] ?? <Link2 size={15} />}
                  name={feed.name}
                  detail={`Brings meetings in · synced ${agoText(feed.last_synced)}${feed.event_count ? ` · ${feed.event_count} events` : ""}`}
                  busy={syncing === feed.id}
                  onSync={() => { handleSync(feed); }}
                  onRemove={() => handleDeleteFeed(feed.id)}
                />
              ))}
              {connections === 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAddFeed(true)} disabled={!wsId || !userId} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>
                  <Wifi size={13} /> Link a calendar
                </button>
              )}
              <p className="cal-hint">Linked calendars sync each time you open this page, or press Sync now.</p>
            </div>

            <div className="data-card cal-card">
              <div className="cal-card-title">On your phone</div>
              <p className="cal-empty" style={{ marginBottom: "10px" }}>Show this workspace&apos;s meetings in your iPhone, Google or Outlook calendar. It updates by itself.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSubscribe(true)} disabled={!wsId} style={{ width: "100%", justifyContent: "center" }}>
                <Smartphone size={13} /> Add to phone
              </button>
            </div>

            <div className="cal-legend">
              {(["zoom", "teams", "google_meet", "upload"] as Platform[]).map(p => (
                <span key={p}><i style={{ background: platformColor(p) }} />{platformName(p)}</span>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* Sync message, bottom right */}
      <AnimatePresence>
        {syncMsg && (
          <motion.div role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className={`cal-toast ${syncMsg.ok ? "ok" : "err"}`}>
            {syncMsg.ok ? <Check size={15} /> : <AlertCircle size={15} />}
            <span>{syncMsg.text}</span>
            <button onClick={() => setSyncMsg(null)} aria-label="Dismiss"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Meeting detail modal */}
      <AnimatePresence>
        {selected && (
          <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={() => setSelected(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="liquid-card" style={{ width: "100%", maxWidth: "420px", padding: "28px" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "18px" }}>{platformIcon(selected.platform)}</span>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 800, color: "var(--text-primary)" }}>{selected.title || "Untitled meeting"}</h2>
                  </div>
                  <span className={`badge ${selected.status === "complete" ? "badge-green" : selected.status === "recording" ? "badge-red" : "badge-muted"}`}>{selected.status}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} style={{ padding: "6px" }}><X size={15} /></button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
                {[
                  { icon: <CalendarDays size={13} />, label: "Date", value: selected.started_at ? new Date(selected.started_at).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "-" },
                  { icon: <Clock size={13} />, label: "Time", value: selected.started_at ? new Date(selected.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-" },
                  { icon: <Clock size={13} />, label: "Duration", value: fmtDuration(selected.duration_secs) },
                  { icon: <Users size={13} />, label: "Participants", value: String(selected.participant_count || 0) },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{row.icon}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", width: "80px", flexShrink: 0 }}>{row.label}</span>
                    <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                {selected.meeting_url && (
                  <Link
                    href={`/bot?url=${encodeURIComponent(selected.meeting_url)}`}
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}
                  >
                    <Video size={13} /> Join with Bot
                  </Link>
                )}
                <Link href={`/meeting-summary?id=${selected.id}`} className="btn btn-secondary" style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}>
                  View summary
                </Link>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Schedule modal */}
      <AnimatePresence>
        {showModal && wsId && userId && (
          <ScheduleModal
            workspaceId={wsId}
            userId={userId}
            onClose={() => setShowModal(false)}
            onCreated={() => { load(); }}
          />
        )}
      </AnimatePresence>

      {/* Add Feed modal */}
      <AnimatePresence>
        {showAddFeed && wsId && userId && (
          <AddFeedModal
            workspaceId={wsId}
            userId={userId}
            onClose={() => setShowAddFeed(false)}
            onAdded={(feed) => {
              setFeeds(f => [...f, feed]);
              handleSync(feed);
            }}
            onGoogle={() => importGoogle({ prompt: true })}
          />
        )}
      </AnimatePresence>

      {/* Subscribe modal */}
      <AnimatePresence>
        {showSubscribe && wsId && (
          <SubscribeModal workspaceId={wsId} onClose={() => setShowSubscribe(false)} />
        )}
      </AnimatePresence>

      <style>{CAL_CSS}</style>
    </>
  );
}