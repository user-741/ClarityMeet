"use client";

// Main call-to-action buttons. Signed-in visitors go straight to the app.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, PlayCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function HeroCta({ label = "Start for free", showSecondary = true }: { label?: string; showSecondary?: boolean }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="lp-cta-row">
      {signedIn ? (
        <>
          <Link href="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">Open dashboard <ArrowRight size={16} aria-hidden="true" /></Link>
          {showSecondary && <Link href="/bot" className="lp-btn lp-btn-secondary lp-btn-lg">Start a notetaker</Link>}
        </>
      ) : (
        <>
          <Link href="/register" className="lp-btn lp-btn-primary lp-btn-lg">{label} <ArrowRight size={17} aria-hidden="true" /></Link>
          {showSecondary && <a href="#how" className="lp-btn lp-btn-secondary lp-btn-lg"><PlayCircle size={18} aria-hidden="true" />See how it works</a>}
        </>
      )}
    </div>
  );
}
