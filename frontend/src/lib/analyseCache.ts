"use client";

import type { SessionView } from "@/lib/leads";

interface CacheEntry {
  at: number;
  session: SessionView;
}

/** Browser cache for site analysis. Analysis costs ~20s of pipeline, so a
 *  returning visitor with a live backend session skips it entirely. Entries
 *  are revalidated against the backend before reuse, never trusted blind.
 *  Backend sessions die after an hour idle or on restart. */
const KEY = "roth-openkit-analyses";
const MAX = 5;
const TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("//")
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(withScheme.startsWith("//") ? `https:${withScheme}` : withScheme);
    url.hash = "";
    url.search = "";
    let path = url.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${url.host.toLowerCase()}${path}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function readAll(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    const fresh: Record<string, CacheEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v &&
        typeof v.at === "number" &&
        v.session?.sessionId &&
        now - v.at < TTL_MS
      ) {
        fresh[k] = v;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeAll(entries: Record<string, CacheEntry>) {
  try {
    const keys = Object.keys(entries).slice(-MAX);
    const trimmed: Record<string, CacheEntry> = {};
    for (const k of keys) trimmed[k] = entries[k];
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // storage full or blocked, analysis just runs fresh
  }
}

export function getCachedAnalysis(url: string): SessionView | null {
  return readAll()[normalizeUrl(url)]?.session ?? null;
}

export function saveAnalysis(session: SessionView) {
  const entries = readAll();
  entries[normalizeUrl(session.url)] = { at: Date.now(), session };
  writeAll(entries);
}

export function recentAnalyses(): { url: string; name: string; at: number }[] {
  return Object.entries(readAll())
    .map(([url, e]) => ({ url, name: e.session.profile.name, at: e.at }))
    .sort((a, b) => b.at - a.at);
}
