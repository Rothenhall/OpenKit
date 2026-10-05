"use client";

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

/**
 * House icon set. Phosphor-regular discipline: 24 grid, 1.75 stroke,
 * round caps and joins, currentColor, no fill. Decorative by default
 * (aria-hidden); pass a title for meaningful standalone use.
 */
function Base({
  size = 18,
  label,
  children,
  ...rest
}: IconProps & { children: React.ReactNode; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      {...rest}
    >
      {label && <title>{label}</title>}
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Base>
  );
}

export function MicOffIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M4 4l16 16" />
    </Base>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 5.5v13l11-6.5z" />
    </Base>
  );
}

export function EndCallIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 5h16v11H4z" />
      <path d="M9 19l3-3 3 3" />
    </Base>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.3 3.9 5.2 3.9 8.5s-1.3 6.2-3.9 8.5c-2.6-2.3-3.9-5.2-3.9-8.5s1.3-6.2 3.9-8.5z" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Base>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 12h15" />
      <path d="M13.5 6.5L19 12l-5.5 5.5" />
    </Base>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
      <path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
    </Base>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5l7 2.6v5.2c0 4.6-3 7.9-7 9.2-4-1.3-7-4.6-7-9.2V6.1z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </Base>
  );
}

export function WaveIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4v16" />
      <path d="M16 8v8" />
      <path d="M20 10v4" />
    </Base>
  );
}

export function LeaveIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 4H6v16h8" />
      <path d="M10 12h11" />
      <path d="M17.5 8.5L21 12l-3.5 3.5" />
    </Base>
  );
}
