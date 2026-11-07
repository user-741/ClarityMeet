// Makes every date the app shows use the timezone chosen in Profile.

const KEY = "cm-timezone";
let current: string | null = null;
let patched = false;

type Opts = Intl.DateTimeFormatOptions | undefined;

function withZone(opts: Opts): Opts {
  if (!current || (opts && opts.timeZone)) return opts;
  return { ...(opts ?? {}), timeZone: current };
}

function patch() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const p = Date.prototype;
  const ls = p.toLocaleString, lds = p.toLocaleDateString, lts = p.toLocaleTimeString;
  p.toLocaleString = function (this: Date, l?: Intl.LocalesArgument, o?: Opts) { return ls.call(this, l, withZone(o)); };
  p.toLocaleDateString = function (this: Date, l?: Intl.LocalesArgument, o?: Opts) { return lds.call(this, l, withZone(o)); };
  p.toLocaleTimeString = function (this: Date, l?: Intl.LocalesArgument, o?: Opts) { return lts.call(this, l, withZone(o)); };
  const DTF = Intl.DateTimeFormat;
  const Wrapped = function (this: unknown, l?: Intl.LocalesArgument, o?: Opts) { return new DTF(l as string, withZone(o)); } as unknown as typeof Intl.DateTimeFormat;
  (Wrapped as unknown as { prototype: unknown }).prototype = DTF.prototype;
  Wrapped.supportedLocalesOf = DTF.supportedLocalesOf;
  Intl.DateTimeFormat = Wrapped;
}

export function isValidZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-AU", { timeZone: tz }); return true; } catch { return false; }
}

export function applyTimezone(tz: string | null | undefined) {
  if (!isValidZone(tz)) return;
  current = tz;
  try { localStorage.setItem(KEY, tz); } catch { /* storage blocked */ }
  patch();
}

export function restoreTimezone() {
  try { applyTimezone(localStorage.getItem(KEY)); } catch { /* storage blocked */ }
}

export function browserZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function allZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn("timeZone") : ["Australia/Melbourne", "Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth", "Australia/Hobart", "Australia/Darwin", "Pacific/Auckland", "Asia/Singapore", "Asia/Tokyo", "Asia/Kolkata", "Asia/Dubai", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC"];
  return list.includes("UTC") ? list : [...list, "UTC"];
}

let cachedOptions: { value: string; label: string }[] | null = null;

export function zoneOptions() {
  if (!cachedOptions) cachedOptions = allZones().map(z => ({ value: z, label: zoneLabel(z) }));
  return cachedOptions;
}

export function zoneLabel(tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const off = parts.find(p => p.type === "timeZoneName")?.value ?? "";
    return `${tz.replace(/_/g, " ")} (${off.replace("GMT", "UTC")})`;
  } catch { return tz; }
}
