"use client";

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "@/components/VoiceOrb";
import {
  EndCallIcon,
  MicIcon,
  MicOffIcon,
  PlayIcon,
  WaveIcon,
} from "@/components/icons";
import { AiVerdict, RepVerdict } from "@/components/trainer/Verdict";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import {
  LANGUAGE_LABEL,
  type CallView,
  type Scenario,
  type Turn,
} from "@/lib/leads";

function BuyerCard({ scenario }: { scenario: Scenario }) {
  return (
    <div className="shrink-0 rounded-xl border border-line bg-white/70 p-4">
      <p className="eyebrow">On this call</p>
      <p className="mt-2 font-display text-lg leading-snug">
        {scenario.lead.name}
        {scenario.lead.jobTitle ? `, ${scenario.lead.jobTitle}` : ""}
      </p>
      <p className="mt-1 text-sm text-ink/70">Mood: {scenario.lead.mood}</p>
      <p className="mt-2 text-sm">
        <span className="text-ink/50">Goal: </span>
        {scenario.goal}
      </p>
      {scenario.lead.objections.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {scenario.lead.objections.map((o, i) => (
            <span
              key={i}
              className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs text-ink/75"
            >
              {o}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptPanel({
  turns,
  waitingReply,
  youSpeaking,
  buyer,
  onLeave,
}: {
  turns: Turn[];
  waitingReply: boolean;
  /** The user is talking, or their audio is being transcribed. */
  youSpeaking: boolean;
  buyer: string;
  onLeave: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastLength = turns.at(-1)?.text.length ?? 0;

  // Pin the transcript box to the bottom as lines arrive. Never moves the
  // page, only this box scrolls.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, lastLength, waitingReply, youSpeaking]);

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[20px] border border-line bg-white/70 p-4">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-medium">
          <WaveIcon size={17} />
          Transcript
        </h3>
        <span className="flex shrink-0 items-center gap-1">
          <button
            className="inline-flex min-h-[44px] cursor-pointer items-center px-2 text-xs text-ink/50 underline underline-offset-4 transition-colors duration-200 hover:text-ink disabled:opacity-40"
            disabled={turns.length === 0}
            onClick={() => {
              const text = turns
                .map((t) => `${t.speaker === "agent" ? buyer : "You"}: ${t.text}`)
                .join("\n\n");
              const url = URL.createObjectURL(
                new Blob([text], { type: "text/plain" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "practice-call-transcript.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </button>
          <button
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center px-2 text-xs text-ink/50 underline underline-offset-4 transition-colors duration-200 hover:text-ink"
            onClick={onLeave}
          >
            Leave call
          </button>
        </span>
      </div>
        <div ref={listRef} className="thin-scroll mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-line/70 bg-canvas p-3" aria-live="polite" aria-label="Call transcript">
        {turns.length === 0 && (
          <p className="self-center text-sm text-ink/50">
            Lines appear here as you talk.
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`anim-bubble max-w-[90%] break-words rounded-xl px-3 py-2 text-sm leading-relaxed shadow-[0_1px_2px_rgba(26,23,18,0.06)] ${
              t.speaker === "agent"
                ? "self-start border border-line/70 bg-white"
                : "self-end bg-ink text-canvas"
            }`}
          >
            {t.text}
          </div>
        ))}
        {youSpeaking && (
          <div
            className="anim-bubble flex items-center gap-1.5 self-end rounded-xl bg-ink/85 px-3.5 py-3"
            aria-label="You are speaking"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden
                className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-canvas"
                style={{ animationDelay: `${i * 180}ms` }}
              />
            ))}
          </div>
        )}
        {waitingReply && (
          <div
            className="anim-bubble flex items-center gap-1.5 self-start rounded-xl border border-line/70 bg-white px-3.5 py-3"
            style={{ animationDelay: "700ms" }}
            aria-label="Agent is replying"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden
                className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-copper"
                style={{ animationDelay: `${i * 180}ms` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <span className="inline-flex h-3.5 items-center gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`eq-bar inline-block h-full w-[3px] rounded-full bg-copper ${active ? "" : "eq-paused"}`}
          style={{ animationDelay: `${i * 130}ms` }}
        />
      ))}
    </span>
  );
}

interface Props {
  initialCall: CallView;
  company: string;
  onExit: () => void;
}

/** Viewport-fit call cockpit. Stage, rail and verdict share one screen. */
export function LiveCall({ initialCall, company, onExit }: Props) {
  const [error, setError] = useState("");
  const v = useVoiceCall({ initialCall, onError: setError });

  // Transient voice hiccups clear by themselves. The next turn replaces them.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(id);
  }, [error]);

  const youAreRep = v.call.scenario.agentRole === "lead";
  const live =
    v.userTalking || v.speaking || v.waitingReply || v.transcribing;
  const first = v.call.scenario.lead.name.split(" ")[0];
  const status = !v.begun
    ? "Ready when you are"
    : v.micDenied
      ? "Mic blocked"
      : v.muted
        ? "Mic off"
        : v.userTalking
          ? "Listening, just talk"
          : v.transcribing
            ? "Got it, one moment"
            : v.waitingReply
              ? `${first} is thinking`
              : v.speaking
                ? `${first} is speaking`
                : v.call.ended
                  ? "Call ended"
                  : v.wsStatus !== "live" || !v.greeted
                    ? v.wsStatus === "error"
                      ? "Voice offline"
                      : `Connecting to ${first}`
                    : "Mic on, talk any time";

  function leave() {
    v.disconnectVoice();
    onExit();
  }

  // M toggles mute mid-call. Ignored while typing or before begin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "m" || e.key === "M") && v.begun && !v.call.ended) {
        v.toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v]);

  if (v.score) {
    return (
      <div className="thin-scroll anim-fade-up min-h-0 flex-1 overflow-y-auto rounded-2xl">
        {youAreRep ? (
          <RepVerdict score={v.score} company={company} onRetry={onExit} />
        ) : (
          <AiVerdict score={v.score} company={company} onRetry={onExit} />
        )}
      </div>
    );
  }

  return (
    <div className="thin-scroll grid min-h-0 flex-1 gap-4 overflow-y-auto pb-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-visible lg:pb-0">
      <div className="stage-beige grain anim-fade-up relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] p-4 text-center sm:p-6">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink/10 pb-3">
            <p className="eyebrow">
              {youAreRep ? "You sell, AI buys" : "AI sells, you buy"}
            </p>
            <p
              className={`rounded-full border px-2.5 py-1 font-display text-sm font-semibold tabular-nums ${
                v.urgent
                  ? "border-red-400/60 bg-red-50 text-red-700"
                  : "border-stage-line bg-white/50 text-ink/70"
              }`}
              role="timer"
              aria-label={`Practice time remaining ${v.clock}`}
            >
              {v.clock}
            </p>
          </div>
          <div
            className="mt-1 h-[3px] shrink-0 overflow-hidden rounded-full bg-ink/10"
            aria-hidden
          >
            <div
              className={`timer-rail-fill h-full rounded-full ${v.urgent ? "bg-red-400" : "bg-copper"}`}
              style={{ width: `${v.fractionLeft * 100}%` }}
            />
          </div>

          <div className="relative mx-auto mt-1 w-fit shrink-0">
            <div className="orb-float">
              <VoiceOrb state={v.orbState} level={v.orbLevel} size={240} />
            </div>
          </div>

          {/* Fixed height, fixed icon slots and a fixed width text box: the
              equalizer, dot and mic icon swap in place and the words change
              inside their own box, so a state change never moves the layout. */}
          <p
            className="mx-auto mt-2 flex h-5 shrink-0 items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--color-cognac)" }}
            role="status"
          >
            <span className="flex h-3.5 w-[27px] shrink-0 items-center justify-center">
              {v.userTalking || v.speaking ? (
                <Equalizer active />
              ) : (
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    live ? "live-dot bg-copper" : "bg-ink/30"
                  }`}
                />
              )}
            </span>
            <span className="flex w-3.5 shrink-0 items-center justify-center">
              {v.muted ? <MicOffIcon size={14} /> : <MicIcon size={14} />}
            </span>
            <span className="w-[15rem] truncate text-left">{status}</span>
          </p>
          <h2 className="mt-1 shrink-0 font-display text-3xl font-light tracking-tight text-balance sm:text-4xl">
            {v.call.scenario.lead.name}
          </h2>
          <p className="mt-1 shrink-0 text-sm text-ink/60">
            {v.call.scenario.lead.jobTitle
              ? `${v.call.scenario.lead.jobTitle} . `
              : ""}
            {v.call.scenario.difficulty} . Speaking{" "}
            {LANGUAGE_LABEL[v.call.language] ?? v.call.language}
          </p>

          <div className="mt-auto shrink-0 pt-3">
            {!v.begun ? (
              <div className="mx-auto max-w-md">
                <button
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink px-10 py-4 text-sm font-semibold text-canvas shadow-[0_10px_30px_-12px_rgba(26,23,18,0.5)] transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                  disabled={Boolean(v.unsupported)}
                  onClick={() => void v.begin()}
                >
                  <PlayIcon size={16} />
                  Start call
                </button>
                <p className="mt-3 text-xs leading-relaxed text-ink/55">
                  {v.call.practiceMinutes} minutes on the clock. The{" "}
                  {youAreRep ? "buyer" : "caller"} speaks first, then just
                  talk.
                </p>
                {v.unsupported && (
                  <p className="mt-2 text-xs leading-relaxed text-red-700" role="alert">
                    {v.unsupported} Open this page in the latest Chrome, Edge,
                    Safari or Firefox.
                  </p>
                )}
                <p className="mt-1.5 text-xs leading-relaxed text-ink/55">
                  Headphones give the clearest call. Without them, the agent
                  can hear itself through your speakers.
                </p>
              </div>
            ) : v.micDenied ? (
              <div className="mx-auto max-w-md">
                <button
                  className="cursor-pointer rounded-full bg-ink px-10 py-4 text-sm font-medium text-canvas shadow-[0_10px_30px_-12px_rgba(26,23,18,0.5)] transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
                  onClick={() => void v.retryMic()}
                >
                  Enable mic
                </button>
                <p className="mt-3 text-xs leading-relaxed text-ink/55">
                  The call needs the mic. Allow access to talk.
                </p>
              </div>
            ) : (
              <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-2">
                <p
                  className={`w-[9.5rem] shrink-0 whitespace-nowrap rounded-full px-4 py-4 text-center text-sm font-medium transition-colors duration-300 ${
                    v.userTalking
                      ? "border border-transparent bg-ink text-canvas shadow-[0_10px_30px_-12px_rgba(26,23,18,0.5)]"
                      : "border border-ink/25 bg-white/40 text-ink/70"
                  }`}
                  role="status"
                  aria-label={v.userTalking ? "Listening" : "Mic on"}
                >
                  {v.userTalking ? "Listening" : v.muted ? "Mic off" : "Mic on"}
                </p>
                {!v.call.ended && (
                  <button
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/25 bg-white/40 px-6 py-4 text-sm font-medium text-ink/80 transition-colors duration-200 hover:border-ink/50"
                    aria-pressed={v.muted}
                    onClick={v.toggleMute}
                  >
                    {v.muted ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
                    {v.muted ? "Unmute" : "Mute"}
                  </button>
                )}
                {!v.call.ended && (
                  <button
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/25 bg-white/40 px-6 py-4 text-sm font-medium text-ink/80 transition-colors duration-200 hover:border-ink/50"
                    onClick={() => void v.endCall()}
                  >
                    <EndCallIcon size={16} />
                    End and score
                  </button>
                )}
              </div>
            )}
            {v.begun && !v.micDenied && !v.muted && !v.call.ended && (
              <p className="mt-2 text-xs text-ink/55">
                Talk any time, even over the agent. Pause and you are heard.
              </p>
            )}
          </div>
          {/* One reserved line for notices, in priority order. Always the same
              height, so a message appearing never moves the controls. */}
          <div
            className="mx-auto mt-2 flex h-11 w-full max-w-md shrink-0 items-start justify-center text-center"
            role="status"
            aria-live="polite"
          >
            {error ? (
              <p className="text-sm text-red-700">{error}</p>
            ) : v.begun && v.wsStatus === "connecting" && v.greeted && !v.call.ended ? (
              <p className="text-xs text-ink/55">Reconnecting voice, hold on</p>
            ) : v.begun &&
              (v.wsStatus === "error" || v.wsStatus === "off") &&
              !v.call.ended ? (
              <button
                className="cursor-pointer text-xs text-ink/55 underline underline-offset-4 hover:text-ink"
                onClick={v.reconnectVoice}
              >
                Voice dropped, tap to reconnect
              </button>
            ) : v.hint ? (
              <p className="text-sm text-ink/60">{v.hint}</p>
            ) : null}
          </div>
        </div>
      </div>

      <aside
        className="anim-fade-up flex min-h-[30vh] min-w-0 flex-col gap-4 lg:min-h-0"
        style={{ ["--d" as string]: "120ms" }}
      >
          <BuyerCard scenario={v.call.scenario} />
          <TranscriptPanel
            turns={v.call.turns}
            waitingReply={v.waitingReply}
            youSpeaking={v.userTalking || v.transcribing}
            buyer={v.call.scenario.lead.name}
            onLeave={leave}
          />
      </aside>
    </div>
  );
}
