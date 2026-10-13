import { LOGO } from "../lib/images";

/**
 * The Tigger Oriental brand mark (white lotus + wordmark, for dark grounds).
 * `height` is in px; width scales to keep the aspect ratio.
 */
export function Logo({ height, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={LOGO}
      alt="Tigger Oriental Hotel"
      className={`logo ${className}`.trim()}
      style={height ? { height, width: "auto" } : undefined}
    />
  );
}
