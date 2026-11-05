export type SearchKind = "all" | "tasks" | "meetings";
export type TaskStatus = "Open" | "In Progress" | "Completed" | "Cancelled";

export interface ParsedQuery {
  kind: SearchKind;
  statuses: TaskStatus[];
  priority: "High" | "Medium" | "Low" | null;
  assignee: string | null;
  mine: boolean;
  unassigned: boolean;
  overdue: boolean;
  from: Date | null;
  to: Date | null;
  dateLabel: string | null;
  dueWindow: boolean;
  terms: string[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const STOP = new Set([
  "show", "me", "find", "list", "get", "give", "all", "any", "the", "a", "an", "of", "in", "on", "at", "from", "about",
  "with", "what", "which", "who", "were", "was", "is", "are", "be", "been", "that", "this", "those", "these", "and", "or",
  "my", "i", "we", "our", "us", "did", "do", "does", "to", "for", "by", "there", "have", "has", "had", "any", "some",
  "please", "can", "you", "everything", "anything", "items", "item", "stuff", "things", "related", "regarding", "where",
  "discussed", "talked", "mentioned", "said", "decide", "decided", "decision", "decisions", "happened", "happen",
  "agreed", "covered",
]);

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); const day = (x.getDay() + 6) % 7; return addDays(x, -day); };

export function parseQuery(input: string, now = new Date()): ParsedQuery {
  let q = ` ${input.toLowerCase().replace(/[?!.,;:"]/g, " ").replace(/\s+/g, " ")} `;
  const take = (re: RegExp) => { const m = q.match(re); if (m) q = q.replace(re, " "); return m; };

  const out: ParsedQuery = {
    kind: "all", statuses: [], priority: null, assignee: null, mine: false, unassigned: false,
    overdue: false, from: null, to: null, dateLabel: null, dueWindow: false, terms: [],
  };

  const wantsTasks = /\b(tasks?|action items?|to-?dos?|actions|jobs)\b/.test(q);
  const wantsMeetings = /\b(meetings?|calls?|summar(y|ies)|transcripts?|recordings?)\b/.test(q);
  out.kind = wantsTasks && !wantsMeetings ? "tasks" : wantsMeetings && !wantsTasks ? "meetings" : "all";
  take(/\b(tasks?|action items?|to-?dos?|actions|jobs|meetings?|calls?|summar(y|ies)|transcripts?|recordings?)\b/g);

  if (take(/\b(overdue|late|past due)\b/)) { out.overdue = true; out.kind = "tasks"; }
  if (take(/\b(unfinished|incomplete|outstanding|pending|not done|not finished|still open|to do|todo|remaining)\b/g)) out.statuses = ["Open", "In Progress"];
  if (take(/\b(in progress|ongoing|started|underway)\b/g)) out.statuses = ["In Progress"];
  if (take(/\bopen\b/g) && !out.statuses.length) out.statuses = ["Open"];
  if (take(/\b(completed|complete|done|finished|closed|resolved)\b/g)) out.statuses = ["Completed"];
  if (take(/\b(cancelled|canceled|dropped)\b/g)) out.statuses = ["Cancelled"];
  if (out.statuses.length && out.kind === "all") out.kind = "tasks";

  const pri = take(/\b(high|urgent|important|critical|medium|normal|low)( priority)?\b/);
  if (pri) out.priority = /high|urgent|important|critical/.test(pri[1]) ? "High" : /medium|normal/.test(pri[1]) ? "Medium" : "Low";
  take(/\bpriority\b/g);

  if (take(/\b(unassigned|no owner|nobody|no one)\b/)) out.unassigned = true;
  if (take(/\b(assigned to me|my|mine|for me)\b/g) && !out.unassigned) out.mine = true;
  const who = take(/\b(?:assigned to|owned by|for|by|owner) ([a-z][a-z'-]{1,30}(?: [a-z][a-z'-]{1,30})?)\b/);
  if (who && !STOP.has(who[1].split(" ")[0])) {
    const words = who[1].split(" ").filter(w => !STOP.has(w));
    if (words.length) out.assignee = words.join(" ");
  }

  if (take(/\bdue (this|next) week\b/)) {
    out.dueWindow = true; out.kind = "tasks";
    const s = startOfWeek(now), shift = /next week/.test(input.toLowerCase()) ? 7 : 0;
    out.from = addDays(s, shift); out.to = addDays(s, shift + 7); out.dateLabel = shift ? "due next week" : "due this week";
  }

  const today = startOfDay(now);
  const setRange = (from: Date, to: Date, label: string) => { if (!out.from) { out.from = from; out.to = to; out.dateLabel = label; } };
  const lastN = take(/\b(?:last|past|previous) (\d{1,3}) (day|week|month)s?\b/);
  if (lastN) {
    const n = Number(lastN[1]), unit = lastN[2];
    const from = unit === "day" ? addDays(today, -n) : unit === "week" ? addDays(today, -7 * n) : new Date(today.getFullYear(), today.getMonth() - n, today.getDate());
    setRange(from, addDays(today, 1), `last ${n} ${unit}${n > 1 ? "s" : ""}`);
  }
  if (take(/\btoday\b/)) setRange(today, addDays(today, 1), "today");
  if (take(/\byesterday\b/)) setRange(addDays(today, -1), today, "yesterday");
  if (take(/\b(this week)\b/)) setRange(startOfWeek(now), addDays(startOfWeek(now), 7), "this week");
  if (take(/\b(last week|previous week)\b/)) setRange(addDays(startOfWeek(now), -7), startOfWeek(now), "last week");
  if (take(/\b(this month)\b/)) setRange(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1), "this month");
  if (take(/\b(last month|previous month)\b/)) setRange(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1), "last month");
  if (take(/\b(recent|recently|latest|lately)\b/)) setRange(addDays(today, -14), addDays(today, 1), "last 14 days");
  const month = take(new RegExp(`\\b(?:in |since |during )?(${MONTHS.join("|")})(?: (\\d{4}))?\\b`));
  if (month) {
    const m = MONTHS.indexOf(month[1]);
    const year = month[2] ? Number(month[2]) : (m > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
    const since = /since/.test(month[0]);
    setRange(new Date(year, m, 1), since ? addDays(today, 1) : new Date(year, m + 1, 1), since ? `since ${MONTHS.at(m)}` : `${MONTHS.at(m)} ${year}`);
  }

  out.terms = q.split(" ").map(w => w.replace(/[^a-z0-9'-]/g, "")).filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  return out;
}

export function describe(p: ParsedQuery): string[] {
  const chips: string[] = [];
  chips.push(p.kind === "tasks" ? "Tasks" : p.kind === "meetings" ? "Meetings" : "Meetings and tasks");
  if (p.overdue) chips.push("Overdue");
  if (p.statuses.length) chips.push(p.statuses.length === 2 ? "Not finished" : p.statuses[0]);
  if (p.priority) chips.push(`${p.priority} priority`);
  if (p.mine) chips.push("Assigned to me");
  if (p.unassigned) chips.push("Unassigned");
  if (p.assignee) chips.push(`Assigned to "${p.assignee}"`);
  if (p.dateLabel) chips.push(p.dateLabel.charAt(0).toUpperCase() + p.dateLabel.slice(1));
  if (p.terms.length) chips.push(`Mentions "${p.terms.join(" ")}"`);
  return chips;
}
