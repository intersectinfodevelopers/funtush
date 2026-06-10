import { redis } from "../lib/redis";

export interface RateLimitConfig {
  maxRequests: number;  
  windowSecs:  number; 
}

// Rate limit configs per route
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "POST:/auth/agency/login":      { maxRequests: 5,   windowSecs: 60       }, // 5 per minute
  "POST:/auth/trekker/register":  { maxRequests: 3,   windowSecs: 60 * 60  }, // 3 per hour
  "DEFAULT":                      { maxRequests: 200, windowSecs: 60       }, // 200 per minute
};

// SOS routes are never rate limited
export const SOS_PATHS = ["/sos", "/api/sos", "/emergency"];

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  resetInSec: number;
  limit:      number;
}


export async function checkRateLimit(
  ip:     string,
  method: string,
  path:   string
): Promise<RateLimitResult> {
  // SOS routes always pass
  if (SOS_PATHS.some((sos) => path.startsWith(sos))) {
    return { allowed: true, remaining: 999, resetInSec: 0, limit: 999 };
  }

  // Find matching config
  const routeKey = `${method.toUpperCase()}:${path}`;
  const config   = RATE_LIMITS[routeKey] ?? RATE_LIMITS["DEFAULT"];

  const redisKey = `ratelimit:${ip}:${method.toUpperCase()}:${path}`;

  try {
   
    const count = await redis.incr(redisKey);

    if (count === 1) {
     
      await redis.expire(redisKey, config.windowSecs);
    }

    const ttl       = await redis.ttl(redisKey);
    const remaining = Math.max(0, config.maxRequests - count);
    const allowed   = count <= config.maxRequests;

    return {
      allowed,
      remaining,
      resetInSec: ttl > 0 ? ttl : config.windowSecs,
      limit:      config.maxRequests,
    };
  } catch (err) {
    // Redis down → fail open (allow request) to avoid blocking users
    console.error("[RateLimit] Redis error, failing open:", err);
    return { allowed: true, remaining: 1, resetInSec: 60, limit: config.maxRequests };
  }
}
