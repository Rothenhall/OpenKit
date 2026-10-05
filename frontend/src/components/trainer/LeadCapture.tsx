"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/leads";

type Status = "idle" | "sending" | "done" | "error";

// The consent line links to the privacy policy. Set NEXT_PUBLIC_PRIVACY_URL to
// wherever Rothenhall publishes it.
const PRIVACY_URL =
  process.env.NEXT_PUBLIC_PRIVACY_URL ?? "https://rothenhall.com/privacy";

const INPUT =
  "w-full rounded-lg border border-canvas/20 bg-canvas/10 px-3.5 py-2.5 text-sm text-canvas outline-none transition-colors duration-200 placeholder:text-canvas/40 focus:border-copper";

/**
 * The follow-up form on the scorecard. It asks at the moment the visitor has
 * just got value, says plainly what happens next, and needs a ticked box.
 * The company, outcome and score are read from the call on the server, so
 * the form only asks for who they are.
 */
export function LeadCapture({
  callId,
  company,
}: {
  callId: string;
  company: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [consent, setConsent] = useState(false);
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
      await api.captureLead(callId, {
        name,
        email,
        phone: phone || undefined,
        role: role || undefined,
        consent,
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

  if (status === "done") {
    return (
      <div
        className="mt-4 rounded-xl border border-copper/40 bg-white/5 p-5"
        role="status"
      >
        <p className="font-display text-xl font-light">
          Thanks, {name.trim().split(" ")[0]}.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-canvas/80">
          A Rothenhall partner will write to {email.trim().toLowerCase()} soon.
          Your scorecard stays on this page, so copy it now if you want to keep it.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-xl border border-canvas/15 bg-canvas/5 p-5"
      aria-label="Ask Rothenhall to follow up"
    >
      <p className="font-display text-xl font-light">
        Want help turning this into pipeline?
      </p>
      <p className="mt-1 text-sm leading-relaxed text-canvas/75">
        Leave your details and a Rothenhall partner will reach out about {company}
        . One short note from a person, no mailing list.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-canvas/70">
          Your name
          <input
            className={`${INPUT} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            maxLength={120}
          />
        </label>
        <label className="block text-xs text-canvas/70">
          Work email
          <input
            className={`${INPUT} mt-1`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label className="block text-xs text-canvas/70">
          Your role <span className="text-canvas/45">(optional)</span>
          <input
            className={`${INPUT} mt-1`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            autoComplete="organization-title"
            maxLength={120}
          />
        </label>
        <label className="block text-xs text-canvas/70">
          Phone <span className="text-canvas/45">(optional)</span>
          <input
            className={`${INPUT} mt-1`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
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

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-canvas/75">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#c67c48]"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
        />
        <span>
          I agree Rothenhall can contact me about this. I can ask to be removed
          at any time. See the{" "}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-canvas"
          >
            privacy policy
          </a>
          .
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status === "sending" || !consent}
          className="cursor-pointer rounded-lg bg-copper px-5 py-2.5 text-sm font-medium text-night transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {status === "sending" ? "Sending" : "Send my details"}
        </button>
        <a
          href="https://rothenhall.com/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-canvas/65 underline underline-offset-4 hover:text-canvas"
        >
          Or talk to us now
        </a>
      </div>
      {status === "error" && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
