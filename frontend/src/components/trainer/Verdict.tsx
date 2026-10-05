"use client";

import { useEffect, useState } from "react";
import { savePractice } from "@/lib/history";
import type { Scorecard } from "@/lib/leads";

function OutcomeBadge({ outcome }: { outcome: string }) {
  const styles: Record<string, string> = {
    next_step_agreed: "bg-emerald-700 text-canvas",
    callback: "bg-copper text-night",
    declined: "bg-ink/10 text-ink",
    unclear: "bg-ink/10 text-ink",
  };
  const labels: Record<string, string> = {
    next_step_agreed: "Next step agreed",
    callback: "Callback",
    declined: "Declined",
    unclear: "No clear outcome",
  };
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.12em] ${styles[outcome] ?? styles.unclear}`}
    >
      {labels[outcome] ?? outcome}
    </span>
  );
}

function useAnimate() {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 80);
    return () => clearTimeout(t);
  }, []);
  return animate;
}

function ScoreNumber({ score }: { score: number }) {
  const [shown, setShown] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? score
      : 0,
  );
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 800);
      setShown(Math.round(score * p * 10) / 10);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setShown(score);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  return (
    <p className="font-display text-2xl tabular-nums text-copper">
      {Number.isInteger(shown) ? shown : shown.toFixed(1)}/5
    </p>
  );
}

function Dimensions({ score }: { score: Scorecard }) {
  const animate = useAnimate();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {score.dimensions.map((d, i) => (
        <div
          key={d.name}
          className="anim-fade-up rounded-xl bg-white/5 p-4"
          style={{ ["--d" as string]: `${i * 90}ms` }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">{d.name}</p>
            <ScoreNumber score={d.score} />
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-copper transition-all duration-700"
              style={{ width: animate ? `${(d.score / 5) * 100}%` : "0%" }}
            />
          </div>
          <p className="mt-2 text-sm text-canvas/60">{d.note}</p>
        </div>
      ))}
    </div>
  );
}

function verdictText(score: Scorecard, heading: string): string {
  const lines = [
    heading,
    `Outcome: ${score.outcome}`,
    "",
    score.verdict || score.summary,
    "",
    ...score.dimensions.map((d) => `${d.name}: ${d.score}/5. ${d.note}`),
    "",
    `Strong: ${score.strengths.join("; ")}`,
    `Improve: ${score.improvements.join("; ")}`,
  ];
  if (score.betterMoves.length > 0)
    lines.push("", `Better lines: ${score.betterMoves.join(" | ")}`);
  if (score.coaching.length > 0)
    lines.push("", `Coaching: ${score.coaching.join(" | ")}`);
  return lines.join("\n");
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      className="cursor-pointer rounded-lg border border-white/20 px-5 py-2.5 text-sm text-canvas/85 transition-colors duration-200 hover:border-white/40"
      onClick={() => void copy()}
      aria-live="polite"
    >
      {copied ? "Copied" : "Copy verdict"}
    </button>
  );
}

function BulletList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="anim-fade-up rounded-xl border border-white/10 p-4"
      style={{ ["--d" as string]: "120ms" }}
    >
      <p className="eyebrow" style={{ color: "#e8b98a" }}>
        {title}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-canvas/80">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

/** You sold. Full coaching: overall, wins, gaps, better lines, habits, verdict. */
export function RepVerdict({
  score,
  company,
  onRetry,
}: {
  score: Scorecard;
  company: string;
  onRetry: () => void;
}) {
  useEffect(() => {
    const avg =
      score.dimensions.reduce((s, d) => s + d.score, 0) /
      Math.max(1, score.dimensions.length);
    savePractice({
      at: Date.now(),
      mode: "you-sell",
      company,
      outcome: score.outcome,
      avg: Math.round(avg * 10) / 10,
    });
  }, [score, company]);
  return (
    <section className="anim-fade-up rounded-2xl bg-night p-6 text-canvas sm:p-8">
      <div className="rounded-xl border border-copper/40 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow" style={{ color: "#e8b98a" }}>
            Final verdict
          </p>
          <OutcomeBadge outcome={score.outcome} />
        </div>
        <p className="mt-2 font-display text-2xl font-light leading-snug">
          {score.verdict || score.summary}
        </p>
      </div>

      <h3 className="mt-6 font-display text-xl font-light">
        How the call went overall
      </h3>
      <p className="mt-1 max-w-2xl text-[0.95rem] leading-relaxed text-canvas/75">
        {score.summary}
      </p>

      <div className="mt-5">
        <Dimensions score={score} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <BulletList title="What went well" items={score.strengths} />
        <BulletList title="Where to improve" items={score.improvements} />
        <BulletList
          title="Lines that would have landed better"
          items={score.betterMoves}
        />
        <BulletList
          title="What makes a better calling agent"
          items={score.coaching}
        />
      </div>

      <div className="mt-4 rounded-xl border border-canvas/15 bg-canvas/5 p-4">
        <p className="text-sm leading-relaxed text-canvas/85">
          Want your whole team calling this well? Rothenhall runs the go-to-market
          and revenue operations behind it.
        </p>
        <a
          href="https://rothenhall.com/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-lg bg-copper px-5 py-2.5 text-sm font-medium text-night"
        >
          Talk to Rothenhall
        </a>
      </div>

      <button
        className="mt-6 cursor-pointer rounded-lg bg-canvas px-5 py-2.5 text-sm font-medium text-ink transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
        onClick={onRetry}
      >
        Practise again
      </button>
      <span className="ml-2 inline-block">
        <CopyButton text={verdictText(score, "Sales call verdict: you sold")} />
      </span>
    </section>
  );
}

/** The AI sold. Rate the caller, then show what it would do in a pipeline. */
export function AiVerdict({
  score,
  company,
  onRetry,
}: {
  score: Scorecard;
  company: string;
  onRetry: () => void;
}) {
  useEffect(() => {
    const avg =
      score.dimensions.reduce((s, d) => s + d.score, 0) /
      Math.max(1, score.dimensions.length);
    savePractice({
      at: Date.now(),
      mode: "ai-sell",
      company,
      outcome: score.outcome,
      avg: Math.round(avg * 10) / 10,
    });
  }, [score, company]);
  return (
    <section className="anim-fade-up rounded-2xl bg-night p-6 text-canvas sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow" style={{ color: "#e8b98a" }}>
            How the AI did
          </p>
          <h3 className="mt-2 font-display text-3xl font-light">
            The caller, reviewed
          </h3>
        </div>
        <OutcomeBadge outcome={score.outcome} />
      </div>
      <p className="mt-3 max-w-2xl text-[1rem] leading-relaxed text-canvas/75">
        {score.verdict || score.summary}
      </p>

      <div className="mt-5">
        <Dimensions score={score} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <BulletList title="Done well" items={score.strengths} />
        <BulletList title="Fell short" items={score.improvements} />
      </div>

      <div className="mt-4 rounded-xl border border-copper/40 bg-white/5 p-5">
        <p className="eyebrow" style={{ color: "#e8b98a" }}>
          In your pipeline
        </p>
        <h4 className="mt-2 font-display text-2xl font-light leading-snug">
          What this kind of caller does for {company || "your"} cold calling.
        </h4>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-canvas/80">
          {(score.benefits.length > 0
            ? score.benefits
            : [
                "Every lead gets a call within minutes, nights and weekends included.",
                "Discovery questions asked the same way, every time, so nothing slips.",
                "Costs less per dial than a human SDR team, and scales without hiring.",
              ]
          ).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        <a
          href="https://rothenhall.com/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-lg bg-copper px-5 py-2.5 text-sm font-medium text-night"
        >
          Put one in my pipeline
        </a>
      </div>

      <button
        className="mt-6 cursor-pointer rounded-lg bg-canvas px-5 py-2.5 text-sm font-medium text-ink transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
        onClick={onRetry}
      >
        Take another call
      </button>
      <span className="ml-2 inline-block">
        <CopyButton text={verdictText(score, "Sales call verdict: AI sold")} />
      </span>
    </section>
  );
}
