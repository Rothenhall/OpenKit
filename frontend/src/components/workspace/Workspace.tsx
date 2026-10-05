"use client";

import { useState } from "react";
import VoiceOrb from "@/components/VoiceOrb";
import { GlobeIcon, MicIcon, PlayIcon, SparkIcon } from "@/components/icons";
import { LiveCall } from "@/components/trainer/LiveCall";
import { AmbientField } from "@/components/workspace/AmbientField";
import { SetupModal } from "@/components/workspace/SetupModal";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { loadHistory, outcomeLabel } from "@/lib/history";
import type { CallView, SessionView } from "@/lib/leads";

const DIMENSIONS = ["Opening", "Discovery", "Objection handling", "Close"];

const STEPS = [
  {
    icon: PlayIcon,
    text: "Tap Start call, the agent speaks first.",
  },
  {
    icon: MicIcon,
    text: "Just talk. When you pause, you are heard.",
  },
  {
    icon: GlobeIcon,
    text: "Any language, even mixed. The clock ends the practice.",
  },
];

function GuideCard() {
  const [history] = useState(loadHistory);
  return (
    <div className="rounded-[20px] border border-line bg-white/70 p-4">
      <p className="eyebrow">How a call works</p>
      <ul className="mt-2 space-y-2.5">
        {STEPS.map((s) => (
          <li
            key={s.text}
            className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/75"
          >
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-cognac">
              <s.icon size={14} />
            </span>
            {s.text}
          </li>
        ))}
      </ul>
      <p className="eyebrow mt-4">Scored on</p>
      <ul className="mt-2 space-y-1 text-sm text-ink/75">
        {DIMENSIONS.map((d) => (
          <li key={d} className="flex items-center gap-2">
            <SparkIcon size={13} />
            {d}
          </li>
        ))}
      </ul>
      <p className="eyebrow mt-4">Recent practice</p>
      {history.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-ink/60">
          Nothing yet. Your finished calls land here with their outcomes.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {history.map((h) => (
            <li
              key={`${h.at}-${h.outcome}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-canvas px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {h.company || (h.mode === "you-sell" ? "You sold" : "AI sold")}
                </span>
                <span className="block text-ink/55">
                  {new Date(h.at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  {" . "}
                  {outcomeLabel(h.outcome)} . {h.avg.toFixed(1)}/5
                </span>
              </span>
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  h.outcome === "next_step_agreed"
                    ? "bg-emerald-600"
                    : h.outcome === "callback"
                      ? "bg-copper"
                      : "bg-ink/25"
                }`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Viewport-fit cockpit. Idle, call and verdict never page-scroll. */
export function Workspace() {
  const [modalOpen, setModalOpen] = useState(true);
  const [session, setSession] = useState<SessionView | null>(null);
  const [call, setCall] = useState<CallView | null>(null);

  function reset() {
    setCall(null);
    setSession(null);
    setModalOpen(true);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-canvas font-sans text-ink">
      <AmbientField />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WorkspaceHeader onReset={reset} />
        {modalOpen && (
          <SetupModal
            onReady={(c, s) => {
              setCall(c);
              setSession(s);
              setModalOpen(false);
            }}
            onClose={() => setModalOpen(false)}
          />
        )}
        <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-4 sm:px-6">
          {call ? (
            <div key={call.callId} className="anim-fade-up flex min-h-0 flex-1 flex-col">
              <LiveCall
                initialCall={call}
                company={session?.profile.name ?? ""}
                onExit={() => setCall(null)}
              />
            </div>
          ) : (
            <div
              key="idle"
              className="thin-scroll anim-fade-up grid min-h-0 flex-1 gap-4 overflow-y-auto pb-1 lg:grid-cols-[minmax(0,1fr)_290px] lg:overflow-visible lg:pb-0"
            >
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="stage-beige grain relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-[20px] p-6 text-center sm:p-8">
                  <div className="orb-float relative">
                    <VoiceOrb state="idle" level={0.12} size={220} />
                  </div>
                  <h1
                    className="anim-fade-up mx-auto mt-4 max-w-md text-balance font-display text-4xl font-light tracking-tight sm:text-5xl"
                    style={{ ["--d" as string]: "80ms" }}
                  >
                    Your buyer is one setup away.
                  </h1>
                  <p
                    className="anim-fade-up mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-ink/60"
                    style={{ ["--d" as string]: "160ms" }}
                  >
                    Website, drill and practice time, then the call.
                  </p>
                  <button
                    className="anim-fade-up mt-6 inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink px-8 py-4 text-sm font-semibold text-canvas transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
                    style={{ ["--d" as string]: "240ms" }}
                    onClick={() => setModalOpen(true)}
                  >
                    Set up a call
                    <PlayIcon size={15} />
                  </button>
                </div>
              </section>

              <aside className="anim-fade-up hidden min-h-0 min-w-0 flex-col gap-4 lg:flex"
                style={{ ["--d" as string]: "120ms" }}
              >
                <GuideCard />
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
