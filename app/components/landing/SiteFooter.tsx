import Link from "next/link";
import Logo from "./Logo";

export default function SiteFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-inner">
        <Link href="/" className="lp-brand" aria-label="ClarityMeet home"><Logo size={24} />ClarityMeet</Link>
        <span>© {new Date().getFullYear()} ClarityMeet · Victoria University</span>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:claritymeet@help.com">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
