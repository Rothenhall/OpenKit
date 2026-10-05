"use client";

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "@/components/VoiceOrb";
import {
  ArrowRightIcon,
  CheckIcon,
  MicIcon,
  SparkIcon,
} from "@/components/icons";
import {
  LANGUAGE_LABEL,
  api,
  type CallView,
  type SessionView,
} from "@/lib/leads";
import {
  getCachedAnalysis,
  recentAnalyses,
  saveAnalysis,
} from "@/lib/analyseCache";

type Mode = "lead" | "rep";
type Step = "site" | "analysing" | "drills";

const TIMES = [3, 5, 10];

const STAGES = [
  { label: "Reading the site", sub: "Homepage, sitemap and marketing pages." },
  { label: "Pulling evidence", sub: "Claims with quotes, nothing invented." },
  { label: "Understanding the business", sub: "Offerings, buyers, frictions." },
  { label: "Planning your drills", sub: "Buyer personas taking shape." },
];

const MODES: { id: Mode; name: string; line: string; icon: typeof MicIcon }[] = [
  {
    id: "lead",
    name: "You sell",
    line: "The AI is your buyer. Close them.",
    icon: MicIcon,
  },
  {
    id: "rep",
    name: "AI sells",
    line: "The AI cold calls. You buy.",
    icon: SparkIcon,
  },
];

interface Props {
  onReady: (call: CallView, session: SessionView) => void;
  onClose: () => void;
}

/** Animated number. Counts up on mount, snaps instantly on reduced motion. */
function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const display =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? value
      : shown;
  return (
    <span className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}

/** The front door. Site, drill, time, then the call. */
export function SetupModal({ onReady, onClose }: Props) {
  const [step, setStep] = useState<Step>("site");
  const [url, setUrl] = useState("");
  const [session, setSession] = useState<SessionView | null>(null);
  const [mode, setMode] = useState<Mode>("lead");
  const [minutes, setMinutes] = useState(5);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [restored, setRestored] = useState(false);
  // Read after mount. localStorage does not exist on the server, so reading it
  // during render would make the first client render differ from the HTML.
  const [recents, setRecents] = useState<ReturnType<typeof recentAnalyses>>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecents(recentAnalyses());
  }, []);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (step !== "analysing") return;
    const started = Date.now();
    const stageId = setInterval(
      () => setStageIdx((n) => Math.min(n + 1, STAGES.length - 1)),
      4500,
    );
    const clockId = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => {
      clearInterval(stageId);
      clearInterval(clockId);
    };
  }, [step]);

  function selectMode(m: Mode) {
    setMode(m);
    if (session) {
      const first = session.scenarios.find((s) => s.agentRole === m);
      setScenarioId(first ? first.id : null);
    }
  }

  function enterDrills(s: SessionView, fromCache: boolean) {
    setSession(s);
    const m: Mode = s.scenarios.some((x) => x.agentRole === "lead")
      ? "lead"
      : "rep";
    setMode(m);
    const first = s.scenarios.find((x) => x.agentRole === m);
    setScenarioId(first ? first.id : null);
    setRestored(fromCache);
    setStep("drills");
  }

  async function onAnalyse() {
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    // Cache first: a live backend session skips the ~20s pipeline.
    const cached = getCachedAnalysis(url.trim());
    if (cached) {
      try {
        const live = await api.getSession(cached.sessionId);
        enterDrills(live, true);
        return;
      } catch {
        // session died server side, fall through to full analysis
      } finally {
        setBusy(false);
      }
    }
    setStep("analysing");
    setStageIdx(0);
    setElapsed(0);
    try {
      const s = await api.analyse(url.trim());
      saveAnalysis(s);
      enterDrills(s, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse failed");
      setStep("site");
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    if (!session || !scenarioId) return;
    setBusy(true);
    setError("");
    try {
      const call = await api.startCall(
        session.sessionId,
        scenarioId,
        minutes,
      );
      onReady(call, session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start call");
    } finally {
      setBusy(false);
    }
  }

  const drills = session
    ? session.scenarios.filter((s) => s.agentRole === mode)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onClose();
        return;
      }
      // Keep tab cycling inside the dialog while it is open.
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Set up a practice call"
        className="anim-pop w-full max-w-lg rounded-[20px] border border-stage-line bg-canvas p-6 shadow-[0_40px_90px_-30px_rgba(26,23,18,0.5)] sm:p-7"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="eyebrow">Sales Call Trainer</p>
          <button
            className="inline-flex min-h-[44px] cursor-pointer items-center text-xs text-ink/50 underline underline-offset-4 transition-colors duration-200 hover:text-ink"
            onClick={onClose}
          >
            Later
          </button>
        </div>
        <div className="mt-3 flex items-center gap-1.5" aria-hidden>
          {(["site", "analysing", "drills"] as Step[]).map((s) => (
            <span
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                step === s
                  ? "bg-copper"
                  : (s === "site" && step !== "site") ||
                      (s === "analysing" && step === "drills")
                    ? "bg-ink/30"
                    : "bg-ink/10"
              }`}
            />
          ))}
        </div>

        <div key={step} className="anim-fade-up flex min-h-0 flex-1 flex-col">
        {step === "site" && (
          <>
            <h2 className="mt-3 font-display text-3xl font-light tracking-tight">
              Whose website are you pitching?
            </h2>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-ink/70">
              We read the marketing pages, learn the buyers, and build your
              drills from the real offering.
            </p>
            <input
              className="mt-5 w-full rounded-lg border border-line bg-white/80 px-4 py-3 outline-none placeholder:text-ink/40 focus:border-copper"
              placeholder="https://yourcompany.com"
              value={url}
              autoFocus
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onAnalyse();
              }}
            />
            <button
              className="mt-3 w-full cursor-pointer rounded-lg bg-ink px-4 py-3 text-canvas transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
              disabled={busy || !url.trim()}
              onClick={() => void onAnalyse()}
            >
              Analyse the site
            </button>
            {recents.length > 0 && (
              <div className="mt-4">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink/50">
                  Recent sites
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recents.map((r) => (
                    <button
                      key={r.url}
                      className="cursor-pointer rounded-full border border-line bg-white/70 px-3 py-1.5 text-xs text-ink/75 transition-colors duration-200 hover:border-copper"
                      onClick={() => setUrl(`https://${r.url}`)}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </>
        )}

        {step === "analysing" && (
          <div
            className="flex flex-col items-center py-6 text-center"
            aria-busy="true"
            aria-live="polite"
          >
            <VoiceOrb state="thinking" level={0.5} size={180} />
            <ol className="mt-5 w-full max-w-xs space-y-2 text-left">
              {STAGES.map((s, i) => {
                const done = i < stageIdx;
                const current = i === stageIdx;
                return (
                  <li key={s.label} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold transition-colors duration-300 ${
                        done
                          ? "bg-emerald-700 text-canvas"
                          : current
                            ? "bg-copper text-night"
                            : "border border-line bg-white/60 text-ink/40"
                      }`}
                    >
                      {done ? <CheckIcon size={11} /> : <span>{i + 1}</span>}
                    </span>
                    <span>
                      <span
                        className={`block text-sm font-medium ${current ? "" : "text-ink/60"}`}
                      >
                        {s.label}
                      </span>
                      {current && (
                        <span className="block text-xs text-ink/55">
                          {s.sub}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink/60">
              Seven pages in. Evidence first, then the business, then drills
              built from what is real.
            </p>
            <div className="mt-4 h-1 w-full max-w-xs overflow-hidden rounded-full bg-ink/10">
              <div className="h-full w-1/3 animate-[loadslide_1.4s_ease-in-out_infinite] rounded-full bg-copper" />
            </div>
            <p className="mt-2 text-xs tabular-nums text-ink/50" aria-live="off">
              Working… {elapsed}s
            </p>
          </div>
        )}

        {step === "drills" && session && (
          <>
            {restored && (
              <p className="anim-fade-up rounded-lg border border-line bg-white/70 px-3 py-2 text-xs text-ink/70">
                Restored your last analysis. No waiting this time.
              </p>
            )}            <div className="mt-3 flex items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-display text-sm font-semibold text-canvas">
                {session.profile.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl font-medium leading-tight">
                  {session.profile.name}
                </p>
                <p className="truncate text-xs text-ink/60">
                  {session.profile.industry
                    ? `${session.profile.industry} . `
                    : ""}
                  {session.profile.buyers.slice(0, 3).join(" . ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-4 text-center">
                {[
                  { v: session.profile.offerings.length, l: "Offers" },
                  { v: session.profile.buyers.length, l: "Buyers" },
                  {
                    v: session.profile.likelyObjections.length,
                    l: "Frictions",
                  },
                ].map((s) => (
                  <span key={s.l}>
                    <span className="block font-display text-xl font-semibold tabular-nums text-cognac">
                      <CountUp value={s.v} />
                    </span>
                    <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink/50">
                      {s.l}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => selectMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-200 ${
                    mode === m.id
                      ? "border-ink bg-ink text-canvas shadow-[0_10px_24px_-12px_rgba(26,23,18,0.6)]"
                      : "border-line bg-white/70 hover:border-copper"
                  }`}
                >
                  <m.icon
                    size={18}
                    className={`shrink-0 ${mode === m.id ? "text-copper" : "text-cognac"}`}
                  />
                  <span>
                    <span className="block font-display text-sm font-semibold">
                      {m.name}
                    </span>
                    <span
                      className={`block text-[0.7rem] leading-snug ${mode === m.id ? "text-canvas/70" : "text-ink/60"}`}
                    >
                      {m.line}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex shrink-0 items-center gap-2">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink/55">
                {minutes} min
              </p>
              {TIMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setMinutes(t)}
                  aria-pressed={minutes === t}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    minutes === t
                      ? "bg-ink text-canvas"
                      : "border border-line bg-white/70 text-ink/70 hover:border-copper"
                  }`}
                >
                  {t}
                </button>
              ))}
              <p className="text-[0.65rem] text-ink/50">Up to 10</p>
            </div>

            <div className="mt-2.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-2">
              {drills.slice(0, 4).map((s, i) => {
                const active = scenarioId === s.id;
                const featured = i === 0;
                return (
                  <button
                    key={s.id}
                    onClick={() => setScenarioId(s.id)}
                    aria-pressed={active}
                    className={`anim-fade-up relative cursor-pointer overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-14px_rgba(26,23,18,0.5)] ${
                      featured ? "col-span-2" : ""
                    } ${
                      active
                        ? "border-copper bg-white shadow-[0_8px_20px_-12px_rgba(198,124,72,0.7)]"
                        : "border-line bg-white/60 hover:border-copper/60"
                    }`}
                    style={{ ["--d" as string]: `${i * 70}ms` }}
                  >
                    {featured && (
                      <span className="absolute top-0 right-0 rounded-bl-xl bg-copper px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-night">
                        Suggested
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-cognac">
                      <span
                        aria-hidden
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          s.difficulty === "easy"
                            ? "bg-emerald-600"
                            : s.difficulty === "hard"
                              ? "bg-red-500"
                              : "bg-copper"
                        }`}
                      />
                      {s.difficulty}
                      <span className="font-medium normal-case tracking-normal text-ink/45">
                        {LANGUAGE_LABEL[s.language]}
                      </span>
                      {active && (
                        <span className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-canvas">
                          <CheckIcon size={12} />
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-sm font-semibold leading-snug">
                      {s.title}
                    </span>
                    <span className="block truncate text-xs text-ink/65">
                      {s.lead.name}
                      {s.lead.jobTitle ? `, ${s.lead.jobTitle}` : ""}
                    </span>
                    {featured && (
                      <span className="mt-0.5 line-clamp-1 block text-xs text-ink/60">
                        {s.situation}
                      </span>
                    )}
                  </button>
                );
              })}
              {drills.length === 0 && (
                <p className="col-span-2 rounded-xl bg-white/60 p-3 text-xs text-ink/60">
                  Nothing in this drill. Switch sides.
                </p>
              )}
            </div>

            <div className="shrink-0 border-t border-line/70 bg-canvas pt-3">
              <button
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3.5 text-sm font-semibold text-canvas transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
                disabled={busy || !scenarioId}
                onClick={() => void onStart()}
              >
                {busy ? "Starting" : `Start ${minutes} minute practice`}
                {!busy && <ArrowRightIcon size={16} />}
              </button>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
