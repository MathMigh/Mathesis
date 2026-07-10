import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

let blobCacheDisabled = false;
const MAX_CACHE_VALUE_BYTES = 512_000;

type RedisResponse<T> = {
  error?: string;
  result?: T;
};

function buildBlobPath(key: string) {
  const digest = createHash("sha256").update(key).digest("hex");
  return `lookup-cache/${digest.slice(0, 2)}/${digest}.json`;
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
      signal: AbortSignal.timeout(6000),
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

export async function readPersistentLookupCache<T>(key: string) {
  const blobValue = await readBlobLookupCache<T>(key);

  if (blobValue) {
    return blobValue;
  }

  const rawValue = await redisCommand<string>(["GET", key]);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

export async function writePersistentLookupCache(key: string, value: unknown) {
  const serialized = JSON.stringify(value);

  if (Buffer.byteLength(serialized, "utf8") > MAX_CACHE_VALUE_BYTES) {
    return;
  }

  await Promise.allSettled([
    writeBlobLookupCache(key, serialized),
    redisCommand(["SET", key, serialized]),
  ]);
}

async function readBlobLookupCache<T>(key: string) {
  if (blobCacheDisabled) {
    return null;
  }

  try {
    const result = await get(buildBlobPath(key), {
      access: "private",
      useCache: true,
    });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return null;
    }

    const text = await new Response(result.stream).text();
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/suspended/iu.test(message)) {
      blobCacheDisabled = true;
    }

    return null;
  }
}

async function writeBlobLookupCache(key: string, serializedValue: string) {
  if (blobCacheDisabled) {
    return;
  }

  try {
    await put(buildBlobPath(key), serializedValue, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
      contentType: "application/json; charset=utf-8",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";

    if (/suspended/iu.test(message)) {
      blobCacheDisabled = true;
    }

    // Blob persistence is a resilience layer; lookup must never fail because
    // storage was temporarily unavailable.
  }
}
