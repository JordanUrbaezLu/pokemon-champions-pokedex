/** Simple house/home outline icon. Uses `currentColor`. */
export function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 11.5 L12 4 L21 11.5" />
      <path d="M5 10 V20 H19 V10" />
      <path d="M9.5 20 V14.5 H14.5 V20" />
    </svg>
  );
}
