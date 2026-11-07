"use client";

export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, useMemo } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Copy,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Shield,
  Link as LinkIcon,
} from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buildAppUrl } from "@/lib/app-url";
import { authFetch } from "@/lib/auth-fetch";

type WorkspaceMembershipRow = {
  workspace_id: string;
  role: string;
  workspaces: { name: string } | null;
};

type SendInviteResponse = {
  ok?: boolean;
  emailed?: boolean;
  link?: string;
  reason?: string;
  error?: string;
};

function isAllowedInviteRole(value: string): value is "admin" | "member" | "viewer" {
  return value === "admin" || value === "member" || value === "viewer";
}

export default function InvitePage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "viewer">("member");
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [wsName, setWsName] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [wsLoading, setWsLoading] = useState(true);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [emailNote, setEmailNote] = useState("");
  const [serverLink, setServerLink] = useState("");

  const inviteLink = useMemo(() => {
    if (serverLink) return serverLink;
    if (!workspaceId) return "";
    return buildAppUrl(`/invite/accept?workspace_id=${encodeURIComponent(workspaceId)}`);
  }, [workspaceId, serverLink]);

  const loadWorkspace = useCallback(async () => {
    setWsLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login?next=%2Finvite");
        return;
      }

      const { data: ownerWorkspace, error: ownerError } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("owner_id", user.id)
        .limit(1)
        .maybeSingle();

      if (ownerError) {
        throw new Error(ownerError.message);
      }

      if (ownerWorkspace) {
        setWorkspaceId(ownerWorkspace.id);
        setWsName(ownerWorkspace.name ?? "your workspace");
        return;
      }

      const { data: wm, error: wmError } = (await supabase
        .from("workspace_members")
        .select("workspace_id, role, workspaces(name)")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle()) as {
        data: WorkspaceMembershipRow | null;
        error: { message: string } | null;
      };

      if (wmError) {
        throw new Error(wmError.message);
      }

      if (!wm) {
        router.replace("/settings");
        return;
      }

      setWorkspaceId(wm.workspace_id);
      setWsName(wm.workspaces?.name ?? "your workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace");
    } finally {
      setWsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const createInvite = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setCopied(false);

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Enter an email address.");
      return;
    }

    if (!workspaceId) {
      setError("Workspace is still loading. Please try again.");
      return;
    }

    if (!isAllowedInviteRole(role)) {
      setError("Invalid role selected.");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace(`/login?next=${encodeURIComponent("/invite")}`);
        return;
      }

      if ((user.email || "").toLowerCase() === cleanEmail) {
        throw new Error("You can't invite your own email address.");
      }

      // Creates the invite and emails it (server route, SMTP creds stay server-side).
      const res = await authFetch("/api/invite/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, role, workspaceId }),
      });
      const json = (await res.json().catch(() => ({}))) as SendInviteResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to create invite");
      }

      if (json.link) setServerLink(json.link);
      setSentTo(json.emailed ? cleanEmail : null);
      setEmailNote(json.emailed ? "" : json.reason || "");
      setCreated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setLoading(false);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the invite link.");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div className="neural-bg">
        <div className="neural-bg-grid" />
      </div>

      <div style={{ width: "100%", maxWidth: "520px", position: "relative", zIndex: 1 }}>
        <Link
          href="/settings"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: "13px",
            marginBottom: "32px",
          }}
        >
          <ArrowLeft size={14} /> Back to Settings
        </Link>

        <div className="liquid-card" style={{ padding: "36px" }}>
          {created ? (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "rgba(16,185,129,0.12)",
                  border: "1px solid rgba(16,185,129,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                }}
              >
                <CheckCircle2 size={24} color="var(--emerald-pulse, #10b981)" />
              </div>

              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "22px",
                  fontWeight: 800,
                  color: "var(--text-primary)",
                  marginBottom: "10px",
                }}
              >
                {sentTo ? "Invite sent" : "Invite ready"}
              </h2>

              <p
                style={{
                  fontSize: "14px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.7,
                  marginBottom: "20px",
                }}
              >
                {sentTo ? (
                  <>We emailed an invite to <strong style={{ color: "var(--text-primary)" }}>{sentTo}</strong>. You can also share the link below.</>
                ) : (
                  <>{emailNote ? `${emailNote} ` : ""}Share this link with the invited person.</>
                )}{" "}
                After they sign in, they&apos;ll be added to{" "}
                <strong style={{ color: "var(--text-primary)" }}>{wsName}</strong>.
              </p>

              <div
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.14)",
                  borderRadius: "var(--radius-md)",
                  padding: "12px",
                  marginBottom: "18px",
                  textAlign: "left",
                  wordBreak: "break-all",
                  fontSize: "13px",
                  color: "var(--text-primary)",
                }}
              >
                {inviteLink}
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={copyInviteLink}>
                  <Copy size={14} /> {copied ? "Copied" : "Copy invite link"}
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setCreated(false);
                    setEmail("");
                    setRole("member");
                    setCopied(false);
                    setError("");
                  }}
                >
                  <Mail size={14} /> Create another
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "28px" }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "14px",
                    background: "rgba(14,165,233,0.1)",
                    border: "1px solid rgba(14,165,233,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "16px",
                  }}
                >
                  <Mail size={20} color="#7DD3FC" />
                </div>

                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "22px",
                    fontWeight: 800,
                    color: "var(--text-primary)",
                    marginBottom: "6px",
                  }}
                >
                  Invite a team member
                </h1>

                <p
                  style={{
                    fontSize: "13px",
                    color: "var(--text-muted)",
                    lineHeight: 1.6,
                  }}
                >
                  Create a secure invite record, then share the invite link directly.
                </p>
              </div>

              <form onSubmit={createInvite} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label className="form-label">Email address</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="colleague@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="form-label">Role</label>
                  <select
                    className="form-select"
                    value={role}
                    onChange={(e) => setRole(e.target.value as "admin" | "member" | "viewer")}
                  >
                    <option value="admin">Admin - full access</option>
                    <option value="member">Member - standard access</option>
                    <option value="viewer">Viewer - read only</option>
                  </select>
                </div>

                <div
                  style={{
                    background: "rgba(14,165,233,0.06)",
                    border: "1px solid rgba(14,165,233,0.15)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                    display: "flex",
                    gap: "10px",
                  }}
                >
                  <Shield size={14} color="#7DD3FC" style={{ flexShrink: 0, marginTop: "1px" }} />
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                    The invited role is stored in your database. The link does not grant access by itself;
                    the user must sign in, then the invite is validated server-side.
                  </p>
                </div>

                <div
                  style={{
                    background: "rgba(99,102,241,0.06)",
                    border: "1px solid rgba(99,102,241,0.15)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                    display: "flex",
                    gap: "10px",
                  }}
                >
                  <LinkIcon size={14} color="#A5B4FC" style={{ flexShrink: 0, marginTop: "1px" }} />
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                    Share the generated app link manually by email, chat, or message. This avoids fragile
                    single-use magic-link delivery problems.
                  </p>
                </div>

                {error && (
                  <div
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: "var(--radius-md)",
                      padding: "12px 14px",
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <AlertCircle size={14} color="#FCA5A5" />
                    <span style={{ fontSize: "13px", color: "#FCA5A5" }}>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ justifyContent: "center", padding: "12px", opacity: loading || wsLoading ? 0.7 : 1 }}
                  disabled={loading || wsLoading}
                >
                  {wsLoading ? "Loading workspace..." : loading ? "Creating invite..." : "Create invite link"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}