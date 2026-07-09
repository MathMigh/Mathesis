type RateBucket = {
  count: number;
  resetAt: number;
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

export function consumeRateLimit(
  request: Request,
  namespace: string,
  options: RateLimitOptions,
) {
  const now = Date.now();
  const clientKey = `${namespace}:${getClientIp(request)}`;
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
