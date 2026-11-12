// Matches a name the AI heard to a workspace member.
// Full name first, then first name, but only when exactly one member has it.
export function matchPerson(name, knownPeople) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  const n = norm(name);
  if (!n || !knownPeople?.length) return null;
  const full = knownPeople.find(k => norm(k.name) === n);
  if (full) return full;
  const first = knownPeople.filter(k => norm(k.name).split(' ')[0] === n.split(' ')[0]);
  return first.length === 1 ? first[0] : null;
}
