import { supabase } from "./supabase";
import { authFetch } from "./auth-fetch";

export type MfaStatus = { enabled: boolean; email: boolean; app: boolean; verified: boolean };

export async function getMfaStatus(): Promise<MfaStatus | null> {
  const res = await authFetch("/api/mfa");
  return res.ok ? res.json() : null;
}

function friendly(message: string) {
  if (/rate limit|too many/i.test(message)) return "Too many emails sent in the last hour. Try again later or use an authenticator app.";
  if (/only request this after/i.test(message)) return "Wait a minute before asking for another code.";
  if (/expired|invalid/i.test(message)) return "That code is wrong or has expired.";
  return message;
}

export async function sendEmailCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw new Error(friendly(error.message));
}

export async function verifyEmailCode(email: string, code: string, action: "confirm-email" | "enable-email") {
  const { error } = await supabase.auth.verifyOtp({ email, token: code.replace(/\D/g, ""), type: "email" });
  if (error) throw new Error(friendly(error.message));
  const res = await authFetch("/api/mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not confirm the code");
}

export async function verifyAppCode(code: string) {
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp?.find(f => f.status === "verified");
  if (!factor) throw new Error("No authenticator app is set up.");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\D/g, "") });
  if (error) throw new Error(friendly(error.message));
}
