"use client";

export interface PracticeEntry {
  at: number;
  mode: "you-sell" | "ai-sell";
  company: string;
  outcome: string;
  avg: number;
}

const KEY = "roth-openkit-history";
const MAX = 8;

function safeParse(raw: string | null): PracticeEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is PracticeEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.at === "number" &&
        typeof e.outcome === "string",
    );
  } catch {
    return [];
  }
}

export function loadHistory(): PracticeEntry[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(KEY)).slice(0, MAX);
}

export function savePractice(entry: PracticeEntry): PracticeEntry[] {
  const list = [entry, ...loadHistory()].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked, history stays in memory only
  }
  return list;
}

export function outcomeLabel(outcome: string): string {
  return (
    {
      next_step_agreed: "Next step",
      callback: "Callback",
      declined: "Declined",
      unclear: "Unclear",
    }[outcome] ?? outcome
  );
}
