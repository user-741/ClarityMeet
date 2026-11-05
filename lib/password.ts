// Password rules for sign-up, reset and change password.

export function checkPassword(pw: string, ctx: { email?: string | null; name?: string | null } = {}) {
  const missing: string[] = [];
  if (pw.length < 12) missing.push("12+ characters");
  if (!/[a-z]/.test(pw)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) missing.push("an uppercase letter");
  if (!/\d/.test(pw)) missing.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push("a symbol");
  const lower = pw.toLowerCase();
  const local = (ctx.email ?? "").split("@")[0].toLowerCase();
  const names = (ctx.name ?? "").toLowerCase().split(/\s+/).filter(n => n.length >= 3);
  if ((local.length >= 3 && lower.includes(local)) || names.some(n => lower.includes(n))) missing.push("no name or email in it");
  return missing;
}

// Checks the Have I Been Pwned range API. Only the first 5 characters of the
// SHA-1 hash leave the browser, so the password itself is never sent.
export async function isPwned(pw: string) {
  try {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { "Add-Padding": "true" } });
    if (!res.ok) return false;
    const tail = hex.slice(5);
    return (await res.text()).split("\n").some(line => {
      const [suffix, count] = line.trim().split(":");
      return suffix === tail && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
