import type { IncomingMessage } from 'node:http';

const DEFAULT_ORIGINS = ['http://localhost:3000'];

/**
 * Browser origins allowed to call the API and open the voice socket.
 * `FRONTEND_ORIGIN` takes a comma separated list, for example
 * `https://rothenhall.com,https://www.rothenhall.com`.
 */
export function allowedOrigins(): string[] {
  const configured = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}

/**
 * A request with no Origin header is not a browser (scripts, health checks)
 * and passes. In development any localhost port passes, so a busy port never
 * blocks the app. In production only the configured origins pass.
 */
export function isOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return true;
  const clean = origin.replace(/\/$/, '');
  if (allowedOrigins().includes(clean)) return true;
  if (process.env.NODE_ENV !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(clean);
  }
  return false;
}

/**
 * The visitor's address. Behind a reverse proxy the socket address is the
 * proxy's, so set `TRUST_PROXY=true` (or a hop count) to read the first
 * `X-Forwarded-For` entry instead.
 */
export function clientIp(request: IncomingMessage): string {
  const trust = process.env.TRUST_PROXY;
  if (trust && trust !== 'false') {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(',')[0]
      ?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/** Express `trust proxy` value from `TRUST_PROXY`: off, a hop count, or true. */
export function trustProxySetting(): boolean | number {
  const value = process.env.TRUST_PROXY;
  if (!value || value === 'false') return false;
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 ? hops : true;
}
