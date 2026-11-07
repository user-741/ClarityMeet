import { supabase } from "./supabase";

// Fast lookup of the signed-in user from the locally stored session.
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}
