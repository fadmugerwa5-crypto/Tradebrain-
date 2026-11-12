/** The TradeBrain mark: a honeycomb cell with an ant walking through it. */
export function Logo({ size = 40, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={spin ? "tb-spin-slow" : undefined}>
      <defs>
        <linearGradient id="sd-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1b5aa6" />
          <stop offset="100%" stopColor="#0e2f5c" />
        </linearGradient>
      </defs>
      <polygon points="24,2 43,13 43,35 24,46 5,35 5,13" fill="url(#sd-logo)" />
      <polygon points="24,7 38.5,15.5 38.5,32.5 24,41 9.5,32.5 9.5,15.5" fill="none" stroke="#22b4d4" strokeOpacity="0.55" strokeWidth="1" />
      <g fill="#ffffff">
        <ellipse cx="17" cy="26" rx="4.6" ry="3.4" />
        <ellipse cx="24.5" cy="25" rx="3" ry="2.6" />
        <ellipse cx="30.5" cy="23.6" rx="2.7" ry="2.4" fill="#f5b83d" />
      </g>
      <g stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round">
        <line x1="23" y1="26.5" x2="21" y2="31" />
        <line x1="25" y1="26.5" x2="27" y2="31" />
        <line x1="24.5" y1="23" x2="23" y2="18.5" />
        <line x1="26" y1="23" x2="28" y2="18.5" />
        <line x1="32.5" y1="22.4" x2="36" y2="19.5" />
        <line x1="32.5" y1="24.6" x2="36" y2="27" />
      </g>
    </svg>
  );
}
