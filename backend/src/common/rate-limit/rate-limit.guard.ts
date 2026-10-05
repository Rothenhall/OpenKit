import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimiter } from './rate-limiter.js';

interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

const KEY = 'rate-limit';

/** Limits one route per client address, for example `@RateLimit('analyse', 10, HOUR)`. */
export const RateLimit = (name: string, limit: number, windowMs: number) =>
  SetMetadata(KEY, { name, limit, windowMs } satisfies RateLimitRule);

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.get<RateLimitRule | undefined>(
      KEY,
      context.getHandler(),
    );
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<Request>();
    this.limiter.hit(`${rule.name}:${request.ip}`, rule.limit, rule.windowMs);
    return true;
  }
}
