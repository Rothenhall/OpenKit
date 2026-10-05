"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/lib/leads";

type Backend = "checking" | "live" | "offline";

/** Slim workspace bar. Tool identity, backend status, way back to Rothenhall. */
export function WorkspaceHeader({ onReset }: { onReset: () => void }) {
  const [backend, setBackend] = useState<Backend>("checking");

  useEffect(() => {
    let live = true;
    fetch(`${BACKEND_URL}/`, { cache: "no-store" })
      .then((r) => {
        if (live) setBackend(r.ok ? "live" : "offline");
      })
      .catch(() => {
        if (live) setBackend("offline");
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-ink/10 bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="https://rothenhall.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-baseline gap-2"
          >
            <span className="font-display text-base font-medium tracking-tight">
              Rothenhall
            </span>
            <span className="text-[0.65rem] uppercase tracking-[0.16em] text-cognac">
              Openkit
            </span>
          </Link>
          <span className="hidden h-4 w-px bg-ink/15 sm:block" />
          <span className="truncate text-sm text-ink/70">
            Sales Call Trainer
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            className="flex items-center gap-1.5 rounded-full border border-line bg-white/60 px-2.5 py-1 text-xs text-ink/70"
            title={
              backend === "live"
                ? "Backend reachable"
                : backend === "offline"
                  ? "Backend unreachable, start it on port 4000"
                  : "Checking backend"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                backend === "live"
                  ? "bg-emerald-600"
                  : backend === "offline"
                    ? "bg-red-600"
                    : "bg-amber-500"
              }`}
            />
            {backend === "live"
              ? "Live"
              : backend === "offline"
                ? "Offline"
                : "Checking"}
          </span>
          <button
            className="cursor-pointer rounded-lg border border-ink/20 px-3 py-1.5 text-xs transition-colors duration-200 hover:border-ink/50"
            onClick={onReset}
          >
            New session
          </button>
          <Link
            href="https://rothenhall.com/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-ink px-3 py-1.5 text-xs text-canvas transition-transform duration-200 hover:scale-[1.04] active:scale-[0.97]"
          >
            Talk to us
          </Link>
        </div>
      </div>
    </header>
  );
}
