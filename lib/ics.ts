// Reads .ics calendar feeds (Google secret link, Outlook published link, iCloud).
// Handles timezones (including the Windows names Outlook uses) and repeating events.

export interface ICSEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  location: string | null;
  desc: string | null;
  allDay: boolean;
  conf: string | null;
}

interface RawEvent extends ICSEvent {
  rrule: string | null;
  exdates: number[];
  recurrenceId: number | null;
  tz: string | null;
}

// Outlook writes Windows timezone names. These are the IANA names Intl understands.
const WINDOWS_ZONES: Record<string, string> = {
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Canada Central Standard Time': 'America/Regina',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Arab Standard Time': 'Asia/Riyadh',
  'Arabian Standard Time': 'Asia/Dubai',
  'Iran Standard Time': 'Asia/Tehran',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
};

function validZone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Turns a TZID into an IANA zone, or null if we can't tell.
export function resolveZone(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const t = tzid.replace(/^"|"$/g, '').trim();
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  if (validZone(t)) return t;
  // Some feeds prefix the zone, e.g. "/mozilla.org/20050126_1/Australia/Sydney".
  const tail = t.split('/').slice(-2).join('/');
  return validZone(tail) ? tail : null;
}

// Minutes the zone is ahead of UTC at that moment.
function offsetMinutes(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - instant) / 60000);
}

// A wall-clock time in a zone -> the real moment. Works across daylight saving changes.
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string | null): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz || tz === 'UTC') return new Date(guess);
  let t = guess - offsetMinutes(guess, tz) * 60000;
  t = guess - offsetMinutes(t, tz) * 60000;
  return new Date(t);
}

// The wall-clock parts of a moment in a zone.
function wallClock(instant: Date, tz: string | null) {
  if (!tz || tz === 'UTC') {
    return { y: instant.getUTCFullYear(), mo: instant.getUTCMonth() + 1, d: instant.getUTCDate(), h: instant.getUTCHours(), mi: instant.getUTCMinutes(), s: instant.getUTCSeconds() };
  }
  const shifted = new Date(instant.getTime() + offsetMinutes(instant.getTime(), tz) * 60000);
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: shifted.getUTCHours(), mi: shifted.getUTCMinutes(), s: shifted.getUTCSeconds() };
}

// Parses one ICS date value. params is the part after the property name, e.g. ";TZID=Australia/Sydney".
export function parseICSDate(value: string, params = '', fallbackTz: string | null = null): { date: Date | null; allDay: boolean; tz: string | null } {
  const v = (value || '').trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
  if (!m) return { date: null, allDay: false, tz: null };
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) {
    // All-day events are stored at midnight UTC on that date.
    return { date: new Date(Date.UTC(+y, +mo - 1, +d)), allDay: true, tz: null };
  }
  const tzid = params.match(/TZID=("[^"]+"|[^;:]+)/i)?.[1];
  const tz = z ? 'UTC' : (resolveZone(tzid) ?? fallbackTz);
  return { date: zonedToUtc(+y, +mo, +d, +h, +mi, +(s ?? 0), tz), allDay: false, tz };
}

function unescapeText(s: string) {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

// Splits the feed into events. Repeating events still carry their RRULE here.
function parseEvents(text: string): RawEvent[] {
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const calZone = resolveZone(lines.find(l => l.startsWith('X-WR-TIMEZONE:'))?.slice(14));
  const out: RawEvent[] = [];
  let props: { name: string; params: string; value: string }[] | null = null;
  let depth = 0; // skip VALARM and other nested parts

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { props = []; depth = 0; continue; }
    if (!props) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (depth > 0) continue;

    if (line === 'END:VEVENT') {
      const get = (n: string) => props!.find(p => p.name === n);
      const s = get('DTSTART');
      const st = s ? parseICSDate(s.value, s.params, calZone) : null;
      if (st?.date && (get('STATUS')?.value || '').toUpperCase() !== 'CANCELLED') {
        const e = get('DTEND') ?? get('DUE');
        const end = e ? parseICSDate(e.value, e.params, calZone).date : null;
        const exdates = props.filter(p => p.name === 'EXDATE')
          .flatMap(p => p.value.split(',').map(v => parseICSDate(v, p.params, st.tz ?? calZone).date?.getTime()))
          .filter((t): t is number => typeof t === 'number');
        const rid = get('RECURRENCE-ID');
        const conf = get('X-GOOGLE-CONFERENCE') ?? get('X-MICROSOFT-SKYPETEAMSMEETINGURL') ?? get('URL');
        out.push({
          uid: get('UID')?.value || `${st.date.toISOString()}-${out.length}`,
          title: unescapeText(get('SUMMARY')?.value || 'Untitled') || 'Untitled',
          start: st.date,
          end,
          location: get('LOCATION')?.value ?? null,
          desc: get('DESCRIPTION')?.value ?? null,
          allDay: st.allDay,
          conf: conf?.value ?? null,
          rrule: get('RRULE')?.value ?? null,
          exdates,
          recurrenceId: rid ? parseICSDate(rid.value, rid.params, st.tz ?? calZone).date?.getTime() ?? null : null,
          tz: st.tz,
        });
      }
      props = null;
      continue;
    }

    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const head = line.slice(0, colon);
    const semi = head.indexOf(';');
    props.push({
      name: (semi === -1 ? head : head.slice(0, semi)).toUpperCase(),
      params: semi === -1 ? '' : head.slice(semi),
      value: line.slice(colon + 1),
    });
  }
  return out;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Every start time of a repeating event between from and to.
// Supports DAILY, WEEKLY (with BYDAY), MONTHLY and YEARLY, plus INTERVAL, COUNT, UNTIL and EXDATE.
function occurrences(ev: RawEvent, from: Date, to: Date): Date[] {
  const rule = Object.fromEntries((ev.rrule ?? '').toUpperCase().split(';').map(p => p.split('=')));
  const freq = rule.FREQ;
  if (!freq) return [ev.start];
  const interval = Math.max(1, parseInt(rule.INTERVAL || '1', 10) || 1);
  const maxCount = rule.COUNT ? parseInt(rule.COUNT, 10) : Infinity;
  const until = rule.UNTIL ? parseICSDate(rule.UNTIL, '', ev.tz).date : null;
  const last = until && until < to ? until : to;
  const tz = ev.allDay ? null : ev.tz;
  const w = wallClock(ev.start, tz);
  const at = (y: number, mo: number, d: number) => zonedToUtc(y, mo, d, w.h, w.mi, w.s, tz);

  const byDay = freq === 'WEEKLY' && rule.BYDAY
    ? rule.BYDAY.split(',').map((x: string) => DAYS.indexOf(x.replace(/^[+-]?\d+/, ''))).filter((i: number) => i >= 0).sort()
    : null;

  const out: Date[] = [];
  let count = 0;
  for (let step = 0; step < 5000; step++) {
    // The calendar date of this period, worked out on plain dates so DST can't shift it.
    const base = new Date(Date.UTC(w.y, w.mo - 1, w.d));
    if (freq === 'DAILY') base.setUTCDate(base.getUTCDate() + step * interval);
    else if (freq === 'WEEKLY') base.setUTCDate(base.getUTCDate() + step * 7 * interval);
    else if (freq === 'MONTHLY') base.setUTCMonth(base.getUTCMonth() + step * interval);
    else if (freq === 'YEARLY') base.setUTCFullYear(base.getUTCFullYear() + step * interval);
    else return [ev.start];
    // Skip dates that don't exist, e.g. the 31st in a 30 day month.
    if ((freq === 'MONTHLY' || freq === 'YEARLY') && base.getUTCDate() !== w.d) continue;

    let dates = [base];
    if (byDay) {
      const weekStart = new Date(base); weekStart.setUTCDate(base.getUTCDate() - base.getUTCDay());
      dates = byDay.map((i: number) => { const x = new Date(weekStart); x.setUTCDate(weekStart.getUTCDate() + i); return x; });
    }
    for (const dt of dates) {
      const when = at(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (when < ev.start) continue;
      if (when > last || count >= maxCount) return out;
      count++;
      if (when >= from && !ev.exdates.includes(when.getTime())) out.push(when);
    }
  }
  return out;
}

// Parses a feed and returns every event in the window, with repeating events expanded
// and moved occurrences (RECURRENCE-ID) replacing the original time.
export function parseICS(text: string, from: Date, to: Date): ICSEvent[] {
  const all = parseEvents(text);
  const moved = new Map<string, RawEvent>();
  for (const ev of all) if (ev.recurrenceId !== null) moved.set(`${ev.uid}|${ev.recurrenceId}`, ev);

  const out: ICSEvent[] = [];
  const plain = ({ uid, title, start, end, location, desc, allDay, conf }: RawEvent): ICSEvent => ({ uid, title, start, end, location, desc, allDay, conf });

  for (const ev of all) {
    if (ev.recurrenceId !== null) continue;
    if (!ev.rrule) {
      if (ev.start >= from && ev.start <= to) out.push(plain(ev));
      continue;
    }
    const length = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;
    for (const when of occurrences(ev, from, to)) {
      const key = `${ev.uid}|${when.getTime()}`;
      const uid = `${ev.uid}_${when.toISOString().slice(0, 10)}`;
      const m = moved.get(key);
      if (m) { moved.delete(key); out.push({ ...plain(m), uid }); continue; }
      out.push({ ...plain(ev), uid, start: when, end: length > 0 ? new Date(when.getTime() + length) : null });
    }
  }
  // Moved occurrences whose original date falls outside the window.
  for (const m of moved.values()) {
    if (m.start >= from && m.start <= to) out.push({ ...plain(m), uid: `${m.uid}_${new Date(m.recurrenceId!).toISOString().slice(0, 10)}` });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
