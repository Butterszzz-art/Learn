// The Neuron mark: a glowing core with eight dendrites, two of them tipped
// pink and two teal. Same drawing as assets/icon.svg (the App Store icon).
//
// Plain JSX with no hooks, so it also renders inside next/og ImageResponse
// (app icons, share images), where only literal colours work. In the app,
// leave the colour props unset to follow the theme's accent tokens.

type MarkColors = { from?: string; to?: string; tipA?: string; tipB?: string };

const THEME: Required<MarkColors> = {
  from: "rgb(var(--n-accent))",
  to: "rgb(var(--n-accent2))",
  tipA: "rgb(var(--n-accent2))",
  tipB: "rgb(var(--n-accent3))",
};

/** Fixed colours for places without the CSS tokens (generated images). */
export const MARK_DARK: Required<MarkColors> = { from: "#a78bfa", to: "#f472b6", tipA: "#f472b6", tipB: "#2dd4bf" };

const SPOKES: [number, number, number, number][] = [
  [32, 12, 32, 18],
  [32, 46, 32, 52],
  [12, 32, 18, 32],
  [46, 32, 52, 32],
  [18, 18, 22, 22],
  [46, 46, 42, 42],
  [46, 18, 42, 22],
  [18, 46, 22, 42],
];

export function LogoMark({
  size = 40,
  colors,
  gradientId = "neuron-mark",
  className,
}: {
  size?: number;
  colors?: MarkColors;
  /** Must be unique when two marks with different colours share a page. */
  gradientId?: string;
  className?: string;
}) {
  const c = { ...THEME, ...colors };
  const fill = `url(#${gradientId})`;
  // var() only resolves in CSS, not in SVG presentation attributes, so theme
  // colours go through style. next/og wants plain attributes, which is fine
  // because it is always given literal colours.
  const paint = (prop: "stopColor" | "fill", value: string) => (colors ? { [prop]: value } : { style: { [prop]: value } });
  return (
    <svg width={size} height={size} viewBox="8 8 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" {...paint("stopColor", c.from)} />
          <stop offset="100%" {...paint("stopColor", c.to)} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="10" fill={fill} />
      <g stroke={fill} strokeWidth="4" strokeLinecap="round">
        {SPOKES.map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <circle cx="32" cy="12" r="3" {...paint("fill", c.tipA)} />
      <circle cx="52" cy="32" r="3" {...paint("fill", c.tipA)} />
      <circle cx="32" cy="52" r="3" {...paint("fill", c.tipB)} />
      <circle cx="12" cy="32" r="3" {...paint("fill", c.tipB)} />
    </svg>
  );
}

/** Mark plus the gradient "Neuron" wordmark. */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className="bg-gradient-to-r from-neuron-accent to-neuron-accent2 bg-clip-text font-display font-bold text-transparent" style={{ fontSize: size * 0.72 }}>
        Neuron
      </span>
    </span>
  );
}
