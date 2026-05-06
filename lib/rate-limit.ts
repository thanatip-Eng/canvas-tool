import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Lazily build the rate limiter so missing env vars don't crash module import.
// If Upstash isn't configured, checkRateLimit becomes a no-op (fail-open).
const ratelimit = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('Upstash env vars not set; rate limiting disabled.');
    }
    return null;
  }
  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    analytics: true,
    prefix: 'canvas-tools/api',
  });
})();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

/**
 * Check the per-user rate limit. Returns ok=true if allowed, or ok=false with
 * the seconds the caller should wait before retrying.
 */
export async function checkRateLimit(uid: string): Promise<RateLimitResult> {
  if (!ratelimit) return { ok: true, retryAfterSeconds: 0 };
  const { success, reset } = await ratelimit.limit(uid);
  if (success) return { ok: true, retryAfterSeconds: 0 };
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}
