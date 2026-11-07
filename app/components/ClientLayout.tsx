// Conditionally wraps pages with the sidebar shell.

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { WorkspaceProvider } from "./WorkspaceContext";
import { authFetch } from "@/lib/auth-fetch";
import { applyTimezone, restoreTimezone } from "@/lib/timezone";
import { needsProfile } from "@/lib/profile-check";

const PUBLIC_PATHS = ["/", "/login", "/register", "/invite", "/invite/accept", "/auth/callback", "/auth/reset-password", "/privacy", "/terms", "/mfa", "/welcome"];

function isPublicPath(pathname: string | null) {
  if (!pathname) return false;
  return PUBLIC_PATHS.some((publicPath) =>
    pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const isPublic = isPublicPath(pathname);

  const [authChecked, setAuthChecked] = useState(isPublic); // public pages skip auth check
  const [authed,      setAuthed]      = useState(false);
  const [menuOpen,    setMenuOpen]    = useState(false);

  // Close the phone menu whenever the page changes
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Password-reset emails can land on any page (Supabase falls back to the
  useEffect(() => {
    if (pathname === "/auth/reset-password") return;
    if (/(^|[#&])type=recovery(&|$)/.test(window.location.hash)) {
      window.location.replace(`/auth/reset-password${window.location.search}${window.location.hash}`);
    } else if (pathname !== "/auth/callback" && /(^|[#&])access_token=/.test(window.location.hash)) {
      window.location.replace(`/auth/callback?next=%2Fdashboard${window.location.hash}`);
    }
  }, [pathname]);

  const checkedUser = useRef<string | null>(null);

  useEffect(() => { restoreTimezone(); }, []);

  useEffect(() => {
    if (isPublic) return;
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        checkedUser.current = null;
        setAuthed(false);
        router.replace("/login");
        setAuthChecked(true);
        return;
      }
      if (checkedUser.current !== data.session.user.id) {
        checkedUser.current = null;
        setAuthed(false);
      }
      const here = pathname || "/dashboard";
      try {
        const res = await authFetch("/api/mfa");
        if (res.ok) {
          const s = await res.json();
          if (s.enabled && !s.verified) {
            checkedUser.current = null;
            setAuthed(false);
            router.replace(`/mfa?next=${encodeURIComponent(here)}`);
            return;
          }
        }
      } catch {
      }
      if (cancelled) return;
      const { data: me } = await supabase.from("users").select("first_name, last_name, email, timezone").eq("id", data.session.user.id).maybeSingle();
      applyTimezone(me?.timezone);
      if (needsProfile(me, data.session.user.email)) {
        router.replace(`/welcome?next=${encodeURIComponent(here)}`);
        return;
      }
      if (cancelled) return;
      checkedUser.current = data.session.user.id;
      setAuthed(true);
      setAuthChecked(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        checkedUser.current = null;
        setAuthed(false);
        router.replace("/login");
      } else if (checkedUser.current && session.user.id !== checkedUser.current) {
        checkedUser.current = null;
        setAuthed(false);
      }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [isPublic, router, pathname]);

  return (
    <WorkspaceProvider>
      {isPublic ? (
        children
      ) : !authChecked || !authed ? (
        <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: "32px", height: "32px", border: "3px solid rgba(125,211,252,0.2)", borderTopColor: "#7DD3FC", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <>
          <div className="neural-bg">
            <div className="neural-bg-grid" />
          </div>
          <div className="app-layout">
            {/* Phone/tablet top bar - the sidebar slides in from the left */}
            <div className="mobile-topbar">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
                <Menu size={20} />
              </button>
              <span className="mobile-topbar-title">ClarityMeet</span>
            </div>
            {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
            <Sidebar mobileOpen={menuOpen} onClose={() => setMenuOpen(false)} />
            <div className="main-content">{children}</div>
          </div>
        </>
      )}
    </WorkspaceProvider>
  );
}