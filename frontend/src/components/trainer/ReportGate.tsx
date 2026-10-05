"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/leads";

type Status = "idle" | "sending" | "done" | "error";

// The notice under the button links to the privacy policy. Set
// NEXT_PUBLIC_PRIVACY_URL to wherever Rothenhall publishes it.
const PRIVACY_URL =
  process.env.NEXT_PUBLIC_PRIVACY_URL ?? "https://rothenhall.com/privacy";

const INPUT =
  "w-full rounded-xl border border-ink/15 bg-white/80 px-4 py-3 text-[15px] text-ink outline-none transition-colors duration-200 placeholder:text-ink/35 focus:border-copper";

/**
 * What a visitor sees when the call ends. There is no scorecard on screen:
 * one email address (and an optional phone number) and the PDF report is
 * sent to their inbox. That exchange is the lead.
 */
export function ReportGate({
  callId,
  company,
  youAreRep,
  onRetry,
}: {
  callId: string;
  company: string;
  youAreRep: boolean;
  onRetry: () => void;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // A field real people never see. Bots fill it, and the server drops them.
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await api.requestReport(callId, {
        email: email.trim(),
        phone: phone.trim() || undefined,
        website,
      });
      setStatus("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
      setStatus("error");
    }
  }

  return (
    <div className="thin-scroll anim-fade-up min-h-0 flex-1 overflow-y-auto rounded-[20px]">
      <div className="stage-beige grain relative mx-auto flex min-h-full w-full flex-col items-center justify-center rounded-[20px] px-5 py-10 text-center sm:px-8">
        <div className="relative w-full max-w-md">
          {status === "done" ? (
            <div role="status" aria-live="polite">
              <div
                aria-hidden
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ink text-canvas"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 12.5l5 5L20 6.5"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="mt-5 font-display text-3xl font-light tracking-tight text-balance">
                Your report is on its way.
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
                We sent the PDF to{" "}
                <span className="font-medium text-ink">
                  {email.trim().toLowerCase()}
                </span>
                . It can take a minute. Check your spam folder if you do not
                see it.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <button
                  className="cursor-pointer rounded-full bg-ink px-7 py-3.5 text-sm font-semibold text-canvas transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
                  onClick={onRetry}
                >
                  Practise again
                </button>
                <a
                  href="https://rothenhall.com/contact"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-ink/25 bg-white/50 px-7 py-3.5 text-sm font-medium text-ink/80 transition-colors duration-200 hover:border-ink/50"
                >
                  Talk to Rothenhall
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} aria-label="Get your report by email">
              <p className="eyebrow">Call complete</p>
              <h2 className="mt-3 font-display text-3xl font-light leading-tight tracking-tight text-balance sm:text-4xl">
                Where should we send your report?
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
                {youAreRep
                  ? "Your scorecard, what went well, where to improve and the lines that would have landed better, as a PDF in your inbox."
                  : "How the AI caller did, what it would bring to your pipeline and the full call, as a PDF in your inbox."}
                {company ? ` Built from your call about ${company}.` : ""}
              </p>

              <div className="mt-6 space-y-3 text-left">
                <label className="block text-xs font-medium text-ink/65">
                  Email
                  <input
                    className={`${INPUT} mt-1.5`}
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    autoFocus
                    required
                    maxLength={254}
                  />
                </label>
                <label className="block text-xs font-medium text-ink/65">
                  Phone <span className="font-normal text-ink/40">(optional)</span>
                  <input
                    className={`${INPUT} mt-1.5`}
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                    maxLength={30}
                  />
                </label>
              </div>

              <div className="absolute -left-[9999px]" aria-hidden>
                <label>
                  Leave this empty
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={status === "sending" || !email.trim()}
                className="mt-5 w-full cursor-pointer rounded-xl bg-ink px-6 py-3.5 text-sm font-semibold text-canvas transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100"
              >
                {status === "sending" ? "Preparing your report" : "Email my report"}
              </button>

              <div
                className="mt-3 min-h-[1.25rem] text-sm text-red-700"
                role="alert"
                aria-live="assertive"
              >
                {status === "error" ? error : ""}
              </div>

              <p className="mt-2 text-xs leading-relaxed text-ink/50">
                By sending this you agree Rothenhall can email you the report
                and follow up about it. See the{" "}
                <a
                  href={PRIVACY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  privacy policy
                </a>
                .
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 cursor-pointer text-xs text-ink/45 underline underline-offset-4 hover:text-ink"
              >
                Start over without a report
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
