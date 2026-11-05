// Builds type-ahead suggestions for the search box from common phrases,
// recent searches, meeting titles and teammate names.

export type Suggestion = { text: string; kind: "recent" | "phrase" | "meeting" | "person" };

const PHRASES = [
  "tasks assigned to me",
  "unfinished tasks from last week",
  "open tasks",
  "tasks in progress",
  "completed tasks this month",
  "high priority tasks",
  "high priority tasks assigned to me",
  "overdue tasks",
  "tasks due this week",
  "unassigned action items",
  "meetings this week",
  "meetings last week",
  "meetings this month",
  "meetings about ",
  "what did we decide in ",
];

const TAILS = [
  "today", "yesterday", "this week", "last week", "this month", "last month",
  "assigned to me", "unassigned", "high priority", "low priority", "overdue",
  "due this week", "in progress", "completed", "from last week", "from last month",
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function buildSuggestions(input: string, opts: { recent: string[]; meetings: string[]; people: string[] }, limit = 7): Suggestion[] {
  const q = input.toLowerCase().replace(/\s+/g, " ").trimStart();
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (text: string, kind: Suggestion["kind"]) => {
    const key = text.toLowerCase().trim();
    if (!key || key === q.trim() || seen.has(key)) return;
    seen.add(key);
    out.push({ text, kind });
  };

  if (!q) {
    opts.recent.slice(0, 4).forEach(r => add(r, "recent"));
    PHRASES.slice(0, 5).forEach(p => add(p, "phrase"));
    return out.slice(0, limit);
  }

  opts.recent.filter(r => r.toLowerCase().startsWith(q)).forEach(r => add(r, "recent"));
  PHRASES.filter(p => p.startsWith(q)).forEach(p => add(p, "phrase"));

  const m = q.match(/^(.*?\b(?:about|for|on)\s+)(.*)$/);
  if (m) {
    const part = m[2];
    opts.meetings.filter(t => t.toLowerCase().includes(part)).slice(0, 4).forEach(t => add(input.slice(0, m[1].length) + t, "meeting"));
  }

  const a = q.match(/^(.*?\bassigned to\s+)(.*)$/);
  if (a) {
    opts.people.filter(n => n.toLowerCase().startsWith(a[2])).slice(0, 4).forEach(n => add(input.slice(0, a[1].length) + n, "person"));
  }

  const d = q.match(/^(.*?\b(?:in|during)\s+)(\w*)$/);
  if (d) MONTHS.filter(mo => mo.toLowerCase().startsWith(d[2])).slice(0, 3).forEach(mo => add(input.slice(0, d[1].length) + mo, "phrase"));

  const words = q.split(" ");
  const last = words[words.length - 1];
  const head = input.slice(0, input.length - last.length);
  if ((words.length > 1 || q.endsWith(" ")) && !a && !m) {
    TAILS.filter(t => last ? t.startsWith(last) : true).slice(0, 4).forEach(t => add(head + t, "phrase"));
  }

  PHRASES.filter(p => !p.startsWith(q) && p.includes(q)).forEach(p => add(p, "phrase"));
  if (q.length >= 2) opts.meetings.filter(t => t.toLowerCase().includes(q)).slice(0, 3).forEach(t => add(`meetings about ${t}`, "meeting"));

  return out.slice(0, limit);
}

const KEY = "cm-recent-searches";

export function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]; } catch { return []; }
}

export function saveRecent(q: string) {
  try {
    const list = [q, ...loadRecent().filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* storage blocked */ }
}
