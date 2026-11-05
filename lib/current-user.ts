import { supabase } from "./supabase";

// Fast lookup of the signed-in user from the locally stored session.
// supabase.auth.getUser() makes a network round-trip to Supabase on every
// call, which every page did on every navigation - that was the main cause
// of the lag when switching tabs. Data access is still protected by RLS on
// the server, so the local session is enough for loading UI data.
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}
