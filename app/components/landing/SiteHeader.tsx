"use client";

// Top bar for the public pages. Shows the signed-in user's name and a link
// to the dashboard instead of "Sign in / Get started" when there's a session.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/app/components/ThemeProvider";
import Logo from "./Logo";

type Account = { name: string; initials: string } | null;

export default function SiteHeader({ showSectionLinks = true }: { showSectionLinks?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const [account, setAccount] = useState<Account | undefined>(undefined); // undefined = still checking

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) { if (!cancelled) setAccount(null); return; }
      const { data: row } = await supabase.from("users").select("first_name, last_name").eq("id", user.id).maybeSingle();
      const first = row?.first_name || (user.user_metadata?.first_name as string | undefined) || "";
      const last = row?.last_name || (user.user_metadata?.last_name as string | undefined) || "";
      const name = [first, last].filter(Boolean).join(" ") || user.email?.split("@")[0] || "Your account";
      const initials = ([first[0], last[0]].filter(Boolean).join("") || name[0] || "U").toUpperCase();
      if (!cancelled) setAccount({ name, initials });
    };
    load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { load(); });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  return (
    <header className="lp-header">
      <a href="#main" className="lp-skip">Skip to content</a>
      <div className="lp-wrap lp-header-inner">
        <Link href="/" className="lp-brand" aria-label="ClarityMeet home">
          <Logo />
          ClarityMeet
        </Link>

        {showSectionLinks && (
          <nav className="lp-nav" aria-label="Page sections">
            <Link href="/#how">How it works</Link>
            <Link href="/#features">Features</Link>
            <Link href="/#faq">FAQ</Link>
          </nav>
        )}

        <div className="lp-header-actions">
          <button
            type="button"
            className="lp-btn lp-btn-text lp-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          {account === undefined ? null : account ? (
            <Link href="/dashboard" className="lp-account">
              <span className="lp-avatar" aria-hidden="true">{account.initials}</span>
              <span className="lp-account-name">{account.name}</span>
              <span className="lp-account-go">Dashboard</span>
            </Link>
          ) : (
            <>
              <Link href="/login" className="lp-btn lp-btn-text">Sign in</Link>
              <Link href="/register" className="lp-btn lp-btn-primary">Get started free</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
