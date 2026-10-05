// Where the API lives. Unset means local development on port 4000. The value
// "same-origin" means the API is served from the same domain as this app, as it
// is when both run as services of one Vercel project.
const configured = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export const BACKEND_URL = configured === "same-origin" ? "" : configured;

/** The voice socket URL for a call. Resolved at call time so same-origin works in the browser. */
export function voiceSocketUrl(callId: string): string {
  const base =
    process.env.NEXT_PUBLIC_BACKEND_WS_URL ??
    (BACKEND_URL || window.location.origin).replace(/^http/, "ws");
  return `${base}/tools/leads/voice?callId=${encodeURIComponent(callId)}`;
}

export type LanguageCode =
  | "en-IN"
  | "hi-IN"
  | "bn-IN"
  | "gu-IN"
  | "kn-IN"
  | "ml-IN"
  | "mr-IN"
  | "od-IN"
  | "pa-IN"
  | "ta-IN"
  | "te-IN";

export const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "mr-IN", label: "Marathi" },
  { code: "od-IN", label: "Odia" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
];

export const LANGUAGE_LABEL: Record<LanguageCode, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.label]),
) as Record<LanguageCode, string>;

export interface Scenario {
  id: string;
  agentRole: "rep" | "lead";
  title: string;
  situation: string;
  lead: {
    name: string;
    gender: string;
    jobTitle: string;
    mood: string;
    objections: string[];
  };
  goal: string;
  difficulty: string;
  language: LanguageCode;
  custom: boolean;
}

export interface SessionView {
  sessionId: string;
  url: string;
  profile: {
    name: string;
    industry: string;
    oneLiner: string;
    offerings: string[];
    buyers: string[];
    proofPoints: string[];
    priceSignals: string;
    likelyObjections: string[];
    tone: string;
    language: LanguageCode;
  };
  scenarios: Scenario[];
}

export interface Turn {
  speaker: "agent" | "user";
  text: string;
}

export interface CallView {
  callId: string;
  scenario: Scenario;
  language: LanguageCode;
  voice: string;
  ended: boolean;
  turns: Turn[];
  practiceMinutes: number;
  endsAt: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message ?? `Request failed: ${res.status}`,
    );
  }
  return data as T;
}

export const api = {
  analyse: (url: string, language?: LanguageCode) =>
    req<SessionView>("/tools/leads/analyse", {
      method: "POST",
      // No language means auto. The agent starts in English and mirrors
      // the first thing the user says.
      body: JSON.stringify(language ? { url, language } : { url }),
    }),
  getSession: (sessionId: string) =>
    req<SessionView>(`/tools/leads/sessions/${sessionId}`),
  startCall: (
    sessionId: string,
    scenarioId: string,
    practiceMinutes: number,
  ) =>
    req<CallView>(`/tools/leads/sessions/${sessionId}/calls`, {
      method: "POST",
      body: JSON.stringify({ scenarioId, practiceMinutes }),
    }),
  sendTurn: (callId: string, message: string) =>
    req<CallView>(`/tools/leads/calls/${callId}/turns`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  /** Hangs up. The report is not returned, it is emailed by `requestReport`. */
  endCall: (callId: string) =>
    req<{ ended: true }>(`/tools/leads/calls/${callId}/end`, { method: "POST" }),
  /** The email gate: the PDF report is sent to this address. */
  requestReport: (
    callId: string,
    body: { email: string; phone?: string; website?: string },
  ) =>
    req<{ ok: true; alreadySent?: boolean }>(
      `/tools/leads/calls/${callId}/report`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  addCustomScenario: (
    sessionId: string,
    agentRole: "rep" | "lead",
    description: string,
  ) =>
    req<Scenario>(`/tools/leads/sessions/${sessionId}/scenarios`, {
      method: "POST",
      body: JSON.stringify({ agentRole, description }),
    }),
};
