import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const MAX_KEYS = 10_000;

/** Sliding window limiter held in memory. Fine for one instance. */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Records one hit, or throws 429 when the key is over its limit. */
  hit(key: string, limit: number, windowMs: number): void {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return;
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      const retryAfter = Math.ceil((recent[0] + windowMs - now) / 1000);
      throw new HttpException(
        `Too many requests. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > MAX_KEYS) this.prune(now, windowMs);
  }

  private prune(now: number, windowMs: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= windowMs)) this.hits.delete(key);
    }
  }
}
