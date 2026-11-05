type Row = { first_name: string | null; last_name: string | null } | null | undefined;

// True when the account has no real name yet, e.g. a Google sign-up where
// the name was filled from the email address.
export function needsProfile(row: Row, email?: string | null) {
  if (!row) return false;
  const first = (row.first_name ?? "").trim();
  const last = (row.last_name ?? "").trim();
  const local = (email ?? "").split("@")[0].toLowerCase();
  return !first || !last || (!!local && first.toLowerCase() === local);
}
