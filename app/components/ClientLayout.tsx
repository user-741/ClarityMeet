// Conditionally wraps pages with the sidebar shell.
// Public paths (login, register, landing) get no sidebar.
// Protected paths redirect to /login if the user is not authenticated.

"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { WorkspaceProvider } from "./WorkspaceContext";
import { authFetch } from "@/lib/auth-fetch";

const PUBLIC_PATHS = ["/", "/login", "/register", "/invite", "/invite/accept", "/auth/callback", "/auth/reset-password", "/privacy", "/terms", "/mfa"];

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
  // Site URL when the requested redirect isn't on its allow-list). Send the
  // recovery tokens to the reset page instead of silently dropping them.
  useEffect(() => {
    if (pathname === "/auth/reset-password") return;
    if (/(^|[#&])type=recovery(&|$)/.test(window.location.hash)) {
      window.location.replace(`/auth/reset-password${window.location.search}${window.location.hash}`);
    }
  }, [pathname]);

  useEffect(() => {
    if (isPublic) return;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace("/login");
        setAuthChecked(true);
        return;
      }
      try {
        const res = await authFetch("/api/mfa");
        if (res.ok) {
          const s = await res.json();
          if (s.enabled && !s.verified) {
            router.replace(`/mfa?next=${encodeURIComponent(pathname || "/dashboard")}`);
            return;
          }
        }
      } catch {
      }
      setAuthed(true);
      setAuthChecked(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });
    return () => subscription.unsubscribe();
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