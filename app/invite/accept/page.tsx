"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/app/components/WorkspaceContext";

type Status = "loading" | "joining" | "done" | "error";

type AcceptInviteRow = {
  workspace_id: string;
  workspace_name: string;
  role: string;
};

type SessionUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

function InviteAcceptFallback() {
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
      <div style={{ width: "100%", maxWidth: "420px", textAlign: "center" }}>
        <Loader size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Preparing invite...</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function getSafeUserMeta(user: SessionUser | null | undefined) {
  const meta = user?.user_metadata;
  return meta && typeof meta === "object" ? meta : {};
}

function splitName(fullName: string | undefined, email: string | undefined) {
  const clean = (fullName || "").trim();

  if (!clean) {
    const fallback = (email || "").split("@")[0] || "";
    return {
      name: fallback || "User",
      first_name: fallback,
      last_name: "",
    };
  }

  const parts = clean.split(/\s+/);
  return {
    name: clean,
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" "),
  };
}

async function ensureUserProfile(user: SessionUser) {
  const meta = getSafeUserMeta(user);

  const fullName =
    typeof meta.full_name === "string"
      ? meta.full_name
      : typeof meta.name === "string"
      ? meta.name
      : undefined;

  const { name, first_name, last_name } = splitName(fullName, user.email);

  const { error } = await supabase.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      name,
      first_name,
      last_name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new Error(`User profile update failed: ${error.message}`);
  }
}

function InviteAcceptContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { reload, setActiveWorkspace } = useWorkspace();

  const [status, setStatus] = useState<Status>("loading");
  const [workspaceName, setWorkspaceName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const startedRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const workspaceId = searchParams.get("workspace_id");
    if (!workspaceId) {
      router.replace("/dashboard");
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fail = (message: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      setErrorMsg(message);
      setStatus("error");
    };

    const succeed = async (row: AcceptInviteRow) => {
      if (finishedRef.current) return;

      finishedRef.current = true;
      setWorkspaceName(row.workspace_name || "Workspace");

      await reload();

      setActiveWorkspace({
        workspace_id: row.workspace_id,
        name: row.workspace_name || "Workspace",
        role: row.role || "member",
      });

      setStatus("done");

      timeoutId = setTimeout(() => {
        router.replace("/dashboard");
      }, 1800);
    };

    const run = async () => {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        const user = userData?.user as SessionUser | null;

        if (userError || !user) {
          const next = `/invite/accept?workspace_id=${encodeURIComponent(workspaceId)}`;
          router.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }

        setStatus("joining");

        await ensureUserProfile(user);

        const { data, error } = await supabase.rpc("accept_workspace_invite", {
          p_workspace_id: workspaceId,
        });

        if (error) {
          throw new Error(error.message);
        }

        const row = (Array.isArray(data) ? data[0] : data) as AcceptInviteRow | null;

        if (!row?.workspace_id) {
          throw new Error("Invite acceptance returned no workspace data.");
        }

        // Tell the workspace admins someone joined (best effort - the
        // backend may be offline, which must not block joining).
        const meta = getSafeUserMeta(user);
        const joinerName =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.first_name === "string" && meta.first_name) ||
          user.email || "A new member";
        authFetch("/api/backend/notify-invite-accepted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: row.workspace_id,
            joinerName,
            workspaceName: row.workspace_name,
            role: row.role,
          }),
        }).catch(() => {});

        await succeed(row);
      } catch (err) {
        fail(err instanceof Error ? `Workspace join failed: ${err.message}` : "Workspace join failed.");
      }
    };

    void run();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [router, searchParams, reload, setActiveWorkspace]);

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
      <div style={{ width: "100%", maxWidth: "420px", position: "relative", zIndex: 1 }}>
        <div className="liquid-card" style={{ padding: "40px", textAlign: "center" }}>
          {(status === "loading" || status === "joining") && (
            <>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "rgba(99,102,241,0.12)",
                  border: "1px solid rgba(99,102,241,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                }}
              >
                <Loader
                  size={24}
                  color="var(--accent-indigo, #6366f1)"
                  style={{ animation: "spin 1s linear infinite" }}
                />
              </div>

              <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                {status === "loading" ? "Verifying your invite..." : "Joining workspace..."}
              </h2>

              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                Just a moment.
              </p>
            </>
          )}

          {status === "done" && (
            <>
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

              <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                You&apos;re in!
              </h2>

              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                You&apos;ve joined <strong>{workspaceName}</strong>. Redirecting to your dashboard...
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                }}
              >
                <AlertCircle size={24} color="#ef4444" />
              </div>

              <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                Something went wrong
              </h2>

              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "14px",
                  marginBottom: "20px",
                }}
              >
                {errorMsg}
              </p>

              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={() => {
                  const next = `/invite/accept?workspace_id=${encodeURIComponent(
                    searchParams.get("workspace_id") || ""
                  )}`;
                  router.push(`/login?next=${encodeURIComponent(next)}`);
                }}
              >
                Go to Login
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<InviteAcceptFallback />}>
      <InviteAcceptContent />
    </Suspense>
  );
}

//this page is used to accept workspace invites. It checks for the workspace_id in the query parameters, verifies the user's session, ensures the user's profile is up-to-date, and then calls a Supabase RPC function to accept the invite. Depending on the status of the operation, it displays appropriate messages and redirects the user to their dashboard or login page.