"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "rothenhall-orb": any;
    }
  }
}

interface Props {
  state: OrbState;
  level: number;
  size?: number;
}

/**
 * The Rothenhall voice orb. Static artwork shows instantly so the orb is
 * never blank, then the animated WebGL element takes over once its script
 * is ready. If WebGL fails, the element falls back to the artwork itself.
 */
export default function VoiceOrb({ state, level, size = 280 }: Props) {
  const [ready, setReady] = useState(
    () =>
      typeof customElements !== "undefined" &&
      !!customElements.get("rothenhall-orb"),
  );
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (ready) return;
    let live = true;
    customElements
      .whenDefined("rothenhall-orb")
      .then(() => {
        if (live) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ready]);

  useEffect(() => {
    const el = ref.current as unknown as
      | { state?: string; level?: number }
      | null;
    if (el && ready) {
      el.state = state;
      el.level = Math.max(0, Math.min(1, level));
    }
  }, [state, level, ready]);

  const clamped = Math.max(0, Math.min(1, level));

  return (
    <div
      style={{
        width: `${size}px`,
        maxWidth: "100%",
        aspectRatio: "1",
        position: "relative",
        marginInline: "auto",
      }}
    >
      <Script src="/orb/rothenhall-orb.js" strategy="afterInteractive" />
      {/* Floor shadow grounds the floating orb, product photography style. */}
      <div
        aria-hidden
        className="orb-shadow"
        style={{
          position: "absolute",
          left: "20%",
          right: "20%",
          bottom: "6%",
          height: "10%",
        }}
      />
      {!ready && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/orb/rothenhall-orb.png"
          alt="Rothenhall voice orb"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            position: "relative",
          }}
        />
      )}
      {ready && (
        // @ts-expect-error custom element
        <rothenhall-orb
          ref={ref}
          state={state}
          level={String(clamped)}
          style={{ width: "100%", position: "relative" }}
        />
      )}
    </div>
  );
}
