import { supabase } from "./supabase";

// The user's first workspace - used when no workspace is selected yet.
export async function getFirstWorkspaceId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.workspace_id ?? null;
}
