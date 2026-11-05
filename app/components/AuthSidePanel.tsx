"use client";

import { useEffect, useState } from "react";
import { SummaryVisual } from "./landing/Illustrations";

type Stats = { meetings: number; tasks: number; completed: number; users: number; hours: number };

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

const STEPS = [
  "Paste a Zoom or Teams link - the notetaker joins for you",
  "Recording stops by itself when the meeting ends",
  "Get a summary, highlights and tasks with owners",
];

export default function AuthSidePanel({ heading }: { heading: string }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats").then(r => (r.ok ? r.json() : null)).then(setStats).catch(() => {});
  }, []);

  const tiles = stats ? [
    { label: "Meetings written up", value: fmt(stats.meetings) },
    { label: "Hours recorded",      value: fmt(stats.hours) },
    { label: "Tasks created",       value: fmt(stats.tasks) },
    { label: "Tasks completed",     value: stats.tasks ? `${Math.round((stats.completed / stats.tasks) * 100)}%` : "0%" },
  ] : null;

  return (
    <div className="lp auth-side hide-mobile">
      <div className="auth-side-inner">
        <h2 className="lp-h2" style={{ fontSize: 30, maxWidth: "16ch" }}>{heading}</h2>
        <div className="auth-side-stats" aria-live="polite">
          {(tiles ?? [0, 1, 2, 3].map(i => ({ label: "", value: "", key: i }))).map((s, i) => (
            <div key={i} className="auth-stat">
              <div className="auth-stat-value">{s.value || <span className="auth-stat-skel" />}</div>
              <div className="auth-stat-label">{s.label || <span className="auth-stat-skel" style={{ width: 80, height: 10 }} />}</div>
            </div>
          ))}
        </div>
        <ol className="auth-side-steps">
          {STEPS.map((s, i) => (
            <li key={s}><span className="lp-step-num" style={{ margin: 0, width: 26, height: 26, fontSize: 12 }}>{i + 1}</span><span>{s}</span></li>
          ))}
        </ol>
        <SummaryVisual />
      </div>
      <style>{`
        .auth-side { position: relative; z-index: 1; flex: 1; min-height: 100vh; border-left: 1px solid var(--lp-line); background: var(--lp-raised); display: flex; align-items: center; }
        .auth-side-inner { width: 100%; max-width: 520px; margin: 0 auto; padding: 56px 40px; }
        .auth-side-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; margin: 24px 0 8px; background: var(--lp-line); border: 1px solid var(--lp-line); border-radius: 14px; overflow: hidden; }
        .auth-stat { background: var(--lp-surface); padding: 16px 18px; }
        .auth-stat-value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: var(--lp-text); min-height: 32px; font-variant-numeric: tabular-nums; }
        .auth-stat-label { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--lp-muted); margin-top: 4px; }
        .auth-stat-skel { display: inline-block; width: 56px; height: 22px; border-radius: 6px; background: var(--lp-raised); }
        .auth-side-steps { list-style: none; padding: 0; margin: 20px 0 32px; }
        .auth-side-steps li { display: flex; gap: 14px; align-items: baseline; padding: 12px 0; border-top: 1px solid var(--lp-line); font-size: 15px; color: var(--lp-text); }
        .auth-side-steps li:last-child { border-bottom: 1px solid var(--lp-line); }
      `}</style>
    </div>
  );
}
