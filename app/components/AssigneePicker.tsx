"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, UserRound, Users } from "lucide-react";

export type PickerMember = { id: string; name: string; email?: string | null };
export type Assignee = { id: string | null; name: string | null };

const TEAM = "Whole team";

type Props = {
  members: PickerMember[];
  value: Assignee;
  onChange: (a: Assignee) => void;
  compact?: boolean;
  placeholder?: string;
  autoCommit?: boolean;
};

// Type to search workspace members. A name that isn't a member can still be
// used, with a warning that it won't be linked to an account.
export default function AssigneePicker({ members, value, onChange, compact, placeholder = "Search members or type a name" }: Props) {
  const [text, setText] = useState(value.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // The list is positioned on the page so table cards with hidden overflow don't cut it off.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 240) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  useEffect(() => { setText(value.name ?? ""); }, [value.name, value.id]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || listRef.current?.contains(t)) return;
      if (open) { setOpen(false); commitText(); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  });

  const q = text.trim().toLowerCase();
  const matches = useMemo(() => members.filter(m =>
    !q || m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)
  ).slice(0, 8), [members, q]);
  const exact = members.find(m => m.name.toLowerCase() === q);
  const showCustom = !!q && !exact && q !== TEAM.toLowerCase();
  const options: { kind: "member" | "team" | "custom" | "none"; m?: PickerMember }[] = [
    ...matches.map(m => ({ kind: "member" as const, m })),
    ...(!q || TEAM.toLowerCase().includes(q) ? [{ kind: "team" as const }] : []),
    ...(showCustom ? [{ kind: "custom" as const }] : []),
    ...(value.id || value.name ? [{ kind: "none" as const }] : []),
  ];

  const pick = (o: typeof options[number]) => {
    if (o.kind === "member" && o.m) onChange({ id: o.m.id, name: o.m.name });
    else if (o.kind === "team") onChange({ id: null, name: TEAM });
    else if (o.kind === "custom") onChange({ id: null, name: text.trim() });
    else onChange({ id: null, name: null });
    setOpen(false);
  };

  function commitText() {
    const t = text.trim();
    if (t === (value.name ?? "")) return;
    if (!t) { onChange({ id: null, name: null }); return; }
    const m = members.find(x => x.name.toLowerCase() === t.toLowerCase());
    onChange(m ? { id: m.id, name: m.name } : { id: null, name: t });
  }

  const notMember = !!value.name && !value.id && value.name !== TEAM;
  const size = compact ? { height: "32px", fontSize: "13px", padding: "0 10px" } : {};

  return (
    <div ref={box} style={{ position: "relative", minWidth: compact ? "170px" : undefined }}>
      <input
        className="form-input"
        value={text}
        placeholder={placeholder}
        onChange={e => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && options[active]) pick(options[active]); else commitText(); }
          else if (e.key === "Escape") { setOpen(false); setText(value.name ?? ""); }
        }}
        role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label="Assignee"
        style={{ ...size, paddingRight: notMember ? "30px" : undefined, borderColor: notMember ? "rgba(245,158,11,0.6)" : undefined }}
      />
      {notMember && (
        <span title="Not a member of this workspace" style={{ position: "absolute", right: "9px", top: "50%", transform: "translateY(-50%)", color: "#F59E0B", display: "flex" }}>
          <AlertTriangle size={14} />
        </span>
      )}
      {open && pos && options.length > 0 && typeof document !== "undefined" && createPortal(
        <div ref={listRef}>
          <ul role="listbox" className="search-suggest" style={{ position: "fixed", top: pos!.top, left: pos!.left, width: pos!.width, right: "auto", zIndex: 2000 }}>
          {options.map((o, i) => (
            <li key={o.kind + (o.m?.id ?? "")} role="option" aria-selected={i === active} className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(o); }}>
              {o.kind === "member" && o.m && <>
                <span className="avatar avatar-sm" style={{ width: 22, height: 22, fontSize: 10 }}>{o.m.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <b style={{ fontWeight: 600 }}>{o.m.name}</b>
                  {o.m.email && <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{o.m.email}</span>}
                </span>
                {value.id === o.m.id && <Check size={14} style={{ marginLeft: "auto" }} />}
              </>}
              {o.kind === "team" && <><Users size={14} /><span>{TEAM}</span></>}
              {o.kind === "custom" && <><UserRound size={14} /><span>Use &quot;{text.trim()}&quot;</span><em style={{ color: "#F59E0B" }}>Not in workspace</em></>}
              {o.kind === "none" && <span style={{ color: "var(--text-muted)" }}>Unassign</span>}
            </li>
          ))}
        </ul>
        </div>,
        document.body
      )}
      {!compact && notMember && (
        <p style={{ fontSize: 12, color: "#F59E0B", marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={12} /> {value.name} isn&apos;t in this workspace, so they won&apos;t be notified. Invite them from the Team page.
        </p>
      )}
    </div>
  );
}
