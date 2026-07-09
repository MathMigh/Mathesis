import { createHash } from "node:crypto";

type RateBucket = {
  count: number;
  resetAt: number;
};

type RedisResponse<T> = {
  error?: string;
  result?: T;
};

type RateLimitOptions = {
  intervalMs: number;
  limit: number;
};

const MAX_RATE_BUCKETS = 5_000;

declare global {
  var __mathesisRateBuckets: Map<string, RateBucket> | undefined;
}

function getRateBuckets() {
  if (!globalThis.__mathesisRateBuckets) {
    globalThis.__mathesisRateBuckets = new Map<string, RateBucket>();
  }

  return globalThis.__mathesisRateBuckets;
}

function getRedisCredentials() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_API_URL ||
    null;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_API_TOKEN ||
    null;

  return url && token ? { token, url } : null;
}

async function redisCommand<T>(command: unknown[]) {
  const credentials = getRedisCredentials();

  if (!credentials) {
    return null;
  }

  try {
    const response = await fetch(credentials.url, {
      body: JSON.stringify(command),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(4_000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as RedisResponse<T>;

    if (payload.error) {
      return null;
    }

    return payload.result ?? null;
  } catch {
    return null;
  }
}

function hashRateLimitIdentity(namespace: string, ip: string) {
  return createHash("sha256")
    .update(`${namespace}:${ip}`)
    .digest("hex");
}

function pruneRateBuckets(now: number) {
  const buckets = getRateBuckets();

  if (buckets.size < MAX_RATE_BUCKETS) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  while (buckets.size >= MAX_RATE_BUCKETS) {
    const oldestKey = buckets.keys().next().value;

    if (!oldestKey) {
      break;
    }

    buckets.delete(oldestKey);
  }
}

export function getClientIp(request: Request) {
  const forwarded =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "local";

  return forwarded.split(",")[0]?.trim() || "local";
}

async function consumeRedisRateLimit(
  request: Request,
  namespace: string,
  options: RateLimitOptions,
) {
  const redisKey = `ratelimit:${hashRateLimitIdentity(namespace, getClientIp(request))}`;
  const count = await redisCommand<number>(["INCR", redisKey]);

  if (typeof count !== "number") {
    return null;
  }

  if (count === 1) {
    await redisCommand(["PEXPIRE", redisKey, options.intervalMs]);
  }

  const ttlMs = await redisCommand<number>(["PTTL", redisKey]);
  const retryAfterSeconds =
    typeof ttlMs === "number" && ttlMs > 0
      ? Math.max(1, Math.ceil(ttlMs / 1000))
      : Math.max(1, Math.ceil(options.intervalMs / 1000));

  return {
    allowed: count <= options.limit,
    retryAfterSeconds: count <= options.limit ? 0 : retryAfterSeconds,
  };
}

export async function consumeRateLimit(
  request: Request,
  namespace: string,
  options: RateLimitOptions,
) {
  const redisResult = await consumeRedisRateLimit(request, namespace, options);

  if (redisResult) {
    return redisResult;
  }

  const now = Date.now();
  const clientKey = `${namespace}:${hashRateLimitIdentity(namespace, getClientIp(request))}`;
  const buckets = getRateBuckets();
  pruneRateBuckets(now);
  const current = buckets.get(clientKey);

  if (!current || current.resetAt <= now) {
    buckets.set(clientKey, {
      count: 1,
      resetAt: now + options.intervalMs,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;

  if (current.count <= options.limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function sanitizeHeaderValue(value: string | null, maxLength: number) {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}
