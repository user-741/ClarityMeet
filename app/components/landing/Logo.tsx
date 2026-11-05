// ClarityMeet logo mark - a rounded "C" with a speech-dot, drawn as SVG.
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M24.6 9.4A11 11 0 1 0 24.6 22.6" fill="none" stroke="#2563eb" strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="25.2" cy="16" r="2.6" fill="#60a5fa" />
    </svg>
  );
}
