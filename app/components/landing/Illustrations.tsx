// Product illustrations for the landing page, built in HTML/SVG so they stay sharp in light and dark mode.
import {
  LayoutDashboard, Video, CheckSquare, BarChart3, Plug, Settings, TrendingUp,
  Mic, VideoOff, MonitorUp, PhoneOff, CheckCircle2, Circle, Sparkles, Link2,
} from "lucide-react";
import Logo from "./Logo";

const FACE_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899"];

function Face({ initials, i = 0, size = 26 }: { initials: string; i?: number; size?: number }) {
  return (
    <span className="lp-face" style={{ background: FACE_COLORS[i % FACE_COLORS.length], width: size, height: size }}>
      {initials}
    </span>
  );
}

function Sparkline() {
  return (
    <svg viewBox="0 0 120 40" width="100%" height="40" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lpSpark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2563eb" stopOpacity=".22" />
          <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 32 L12 28 L24 30 L36 22 L48 25 L60 18 L72 20 L84 13 L96 15 L108 8 L120 4 L120 40 L0 40 Z" fill="url(#lpSpark)" />
      <path d="M0 32 L12 28 L24 30 L36 22 L48 25 L60 18 L72 20 L84 13 L96 15 L108 8 L120 4" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function DashboardPreview() {
  const nav = [
    { icon: LayoutDashboard, label: "Dashboard", on: true },
    { icon: Video, label: "Meetings" },
    { icon: CheckSquare, label: "Tasks" },
    { icon: BarChart3, label: "Analytics" },
    { icon: Plug, label: "Integrations" },
    { icon: Settings, label: "Settings" },
  ];
  const rows = [
    { t: "Review Q1 metrics deck", p: "Sarah K.", i: 0, s: "Open", c: "lp-status-open" },
    { t: "Finalise Q2 budget allocation", p: "John M.", i: 2, s: "In Progress", c: "lp-status-progress" },
    { t: "Schedule client onboarding call", p: "Emily R.", i: 4, s: "Done", c: "lp-status-done" },
  ];
  return (
    <div className="lp-app" role="img" aria-label="Preview of the ClarityMeet dashboard with example data">
      <div className="lp-app-top"><Logo size={18} />ClarityMeet<span className="lp-avatar">LN</span></div>
      <div className="lp-app-body">
        <div className="lp-app-nav">
          {nav.map(n => <span key={n.label} className={n.on ? "on" : ""}><n.icon size={14} />{n.label}</span>)}
        </div>
        <div className="lp-app-main">
          <div className="lp-card lp-card-wide" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", alignItems: "end", gap: 12 }}>
            <div>
              <p className="lp-stat-label">Meetings this month</p>
              <p className="lp-stat-value">24</p>
              <span className="lp-stat-delta"><TrendingUp size={12} />+12% vs last month</span>
            </div>
            <Sparkline />
          </div>
          <div className="lp-card">
            <p className="lp-stat-label">Tasks extracted</p>
            <p className="lp-stat-value">187</p>
            <span className="lp-stat-delta"><TrendingUp size={12} />+8% vs last month</span>
          </div>
          <div className="lp-card">
            <p className="lp-stat-label">Completion rate</p>
            <p className="lp-stat-value">91%</p>
            <span className="lp-stat-delta"><TrendingUp size={12} />+5% vs last month</span>
          </div>
          <div className="lp-card lp-card-wide">
            <p className="lp-stat-label" style={{ fontWeight: 600, color: "var(--lp-text)" }}>Recent action items</p>
            {rows.map(r => (
              <div key={r.t} className="lp-row">
                <Face initials={r.p.split(" ").map(x => x[0]).join("").replace(".", "")} i={r.i} />
                <span className="lp-row-main">{r.t}<small>{r.p}</small></span>
                <span className={`lp-status ${r.c}`}>{r.s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PasteLinkVisual() {
  return (
    <div className="lp-frame" aria-hidden="true">
      <div className="lp-frame-bar"><span className="lp-frame-dots"><span /><span /><span /></span>Start ClarityMeet</div>
      <div className="lp-frame-body">
        <p className="lp-label">Meeting link</p>
        <div className="lp-input"><Link2 size={15} style={{ flexShrink: 0, color: "var(--lp-muted)" }} />https://us05web.zoom.us/j/81234567890?pwd=...</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <span className="lp-btn lp-btn-primary" style={{ pointerEvents: "none" }}>Start ClarityMeet</span>
          <span className="lp-chip lp-chip-blue"><Video size={13} />Zoom detected</span>
          <span className="lp-chip lp-chip-green"><Circle size={8} fill="currentColor" />Host computer online</span>
        </div>
      </div>
    </div>
  );
}

export function JoinedVisual() {
  const people = [["Priya Shah", "PS", 0, "Host"], ["Sam Morgan", "SM", 1, ""], ["Alex Li", "AL", 3, ""]] as const;
  return (
    <div className="lp-frame" aria-hidden="true">
      <div className="lp-frame-bar"><span className="lp-frame-dots"><span /><span /><span /></span>Weekly product sync<span className="lp-rec" style={{ marginLeft: "auto" }}>Recording 12:04</span></div>
      <div className="lp-frame-body">
        <p className="lp-label">Participants (4)</p>
        {people.map(([n, ini, i, role]) => (
          <div key={n} className="lp-person"><Face initials={ini} i={i} size={30} />{n}{role && <small>{role}</small>}</div>
        ))}
        <div className="lp-person">
          <span className="lp-face" style={{ background: "#2563eb", width: 30, height: 30 }}><Sparkles size={14} /></span>
          ClarityMeet<small><span className="lp-chip lp-chip-green">Joined automatically</span></small>
        </div>
      </div>
    </div>
  );
}

export function SummaryVisual() {
  return (
    <div className="lp-frame" aria-hidden="true">
      <div className="lp-frame-bar"><span className="lp-frame-dots"><span /><span /><span /></span>Meeting summary<span className="lp-chip lp-chip-blue" style={{ marginLeft: "auto" }}><Sparkles size={12} />AI processed</span></div>
      <div className="lp-frame-body">
        <p className="lp-sum-title">Weekly product sync</p>
        <p className="lp-sum-meta">Today · 32 min · Priya Shah, Sam Morgan, Alex Li</p>
        <p className="lp-label">Summary</p>
        <p className="lp-sum-text">The team agreed to move the onboarding release to next Thursday so the new sign-up emails can be tested first. Sam flagged that the import tool still fails on large files; Alex will investigate before Friday.</p>
        <p className="lp-label">Highlights</p>
        <ul className="lp-list">
          <li><CheckCircle2 size={16} color="#2563eb" />Onboarding release moves to Thursday</li>
          <li><CheckCircle2 size={16} color="#2563eb" />Large-file import bug is the top blocker</li>
        </ul>
      </div>
    </div>
  );
}

export function TasksVisual() {
  const tasks = [
    ["Investigate large-file import failure", "AL", 3, "In Progress", "lp-status-progress"],
    ["Test new sign-up emails", "PS", 0, "Open", "lp-status-open"],
    ["Update release date in the changelog", "SM", 1, "Done", "lp-status-done"],
  ] as const;
  return (
    <div className="lp-frame" aria-hidden="true">
      <div className="lp-frame-bar"><span className="lp-frame-dots"><span /><span /><span /></span>Tasks · Weekly product sync</div>
      <div className="lp-frame-body">
        <ul className="lp-list">
          {tasks.map(([t, ini, i, s, c]) => (
            <li key={t}>
              {s === "Done" ? <CheckCircle2 size={18} color="var(--lp-green)" /> : <Circle size={18} color="var(--lp-faint)" />}
              {t}
              <span className="lp-task-meta"><Face initials={ini} i={i} size={24} /><span className={`lp-status ${c}`}>{s}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// A simple person bust used in the video-call tiles (no stock photos).
function Person({ skin, shirt }: { skin: string; shirt: string }) {
  return (
    <svg viewBox="0 0 100 80" aria-hidden="true">
      <circle cx="50" cy="30" r="16" fill={skin} />
      <path d="M18 80c2-18 16-28 32-28s30 10 32 28z" fill={shirt} />
    </svg>
  );
}

export function CallMock() {
  const tiles = [
    { bg: "#dbeafe", skin: "#f1c27d", shirt: "#1e3a8a", name: "Priya" },
    { bg: "#e0e7ff", skin: "#c68642", shirt: "#334155", name: "Sam" },
    { bg: "#fce7f3", skin: "#8d5524", shirt: "#0f766e", name: "Alex" },
    { bg: "#dcfce7", skin: "#ffdbac", shirt: "#7c2d12", name: "Jordan" },
  ];
  return (
    <div className="lp-call" role="img" aria-label="Illustration of a video call with ClarityMeet's summary and action items beside it">
      <div className="lp-laptop">
        <div className="lp-tiles">
          {tiles.map(t => (
            <div key={t.name} className="lp-tile" style={{ background: t.bg }}>
              <Person skin={t.skin} shirt={t.shirt} />
              <span className="lp-tile-name">{t.name}</span>
            </div>
          ))}
        </div>
        <div className="lp-controls">
          <span><Mic size={13} /></span><span><VideoOff size={13} /></span><span><MonitorUp size={13} /></span><span className="end"><PhoneOff size={13} /></span>
        </div>
      </div>
      <div className="lp-laptop-base" />
      <div className="lp-float lp-float-1">
        <h4>AI Summary</h4>
        <ul>
          <li><CheckCircle2 size={14} color="#2563eb" />3 action items extracted</li>
          <li><CheckCircle2 size={14} color="#2563eb" />1 decision made</li>
          <li><CheckCircle2 size={14} color="#2563eb" />2 owners assigned</li>
        </ul>
      </div>
      <div className="lp-float lp-float-2">
        <h4>Action items</h4>
        <ul>
          <li><CheckCircle2 size={14} color="var(--lp-green)" />Review Q1 metrics deck</li>
          <li><CheckCircle2 size={14} color="var(--lp-green)" />Finalise Q2 budget allocation</li>
          <li><CheckCircle2 size={14} color="var(--lp-green)" />Schedule client onboarding call</li>
        </ul>
      </div>
    </div>
  );
}
