export const dynamic = 'force-dynamic';
// Custom 404 page shown when a route doesn't exist.

import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg-base)", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      position: "relative", overflow: "hidden",
    }}>
      <div className="neural-bg"><div className="neural-bg-grid" /></div>
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "32px" }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: "clamp(80px,15vw,140px)",
          fontWeight: 800, lineHeight: 1, letterSpacing: "-4px", marginBottom: "16px",
        }} className="text-gradient">404</div>
        <h2 style={{
          fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700,
          color: "var(--text-primary)", marginBottom: "12px",
        }}>Page not found</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "15px", marginBottom: "36px" }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <Link href="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
          <Link href="/" className="btn btn-secondary">Back to Home</Link>
        </div>
      </div>
    </div>
  );
}