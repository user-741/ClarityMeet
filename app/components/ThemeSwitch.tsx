"use client";

import { useTheme } from "./ThemeProvider";

export default function ThemeSwitch() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" className={`pill-switch${dark ? " on" : ""}`} role="switch" aria-checked={dark} aria-label="Dark mode" onClick={toggleTheme}>
      <i>
        <svg className="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
        <svg className="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" fill="currentColor" /></svg>
      </i>
    </button>
  );
}
