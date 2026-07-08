import type {
  DictionarySourceId,
  LookupContext,
  LookupPayload,
} from "@/lib/lookup-types";
import { getDisplayPayload } from "./lookup-display";

const LOOKUP_CLIENT_CACHE_STORAGE_KEY =
  "mathesis-lookup-cache-stable-fallbacks-v16";
const LOOKUP_CLIENT_CACHE_SCHEMA_VERSION = "lookup-schema-v25";
const LOOKUP_CLIENT_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const LOOKUP_CLIENT_CACHE_LIMIT = 36;

const VOLATILE_LOOKUP_SOURCE_IDS = new Set<DictionarySourceId>([
  "aulete",
  "priberam",
  "infopedia",
  "wikipedia",
]);

type StoredLookupCache = Record<
  string,
  {
    expiresAt: number;
    payload: LookupPayload;
    savedAt: number;
  }
>;

export function buildLookupCacheKey(word: string, context: LookupContext) {
  const fingerprint = [
    context.documentAuthor ?? "",
    context.documentLanguage ?? "",
    context.documentTitle ?? "",
    context.documentLabel ?? "",
  ]
    .map((value) => value.toLocaleLowerCase("pt-BR"))
    .join("::");

  return `${LOOKUP_CLIENT_CACHE_SCHEMA_VERSION}::${word.toLocaleLowerCase("pt-BR")}::${fingerprint}`;
}

export function readLookupFromBrowserCache(cacheKey: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawCache = window.localStorage.getItem(LOOKUP_CLIENT_CACHE_STORAGE_KEY);
    const cache = rawCache ? (JSON.parse(rawCache) as StoredLookupCache) : {};
    const entry = cache[cacheKey];

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now() || !shouldCacheLookupPayload(entry.payload)) {
      delete cache[cacheKey];
      window.localStorage.setItem(
        LOOKUP_CLIENT_CACHE_STORAGE_KEY,
        JSON.stringify(cache),
      );
      return null;
    }

    return getDisplayPayload(entry.payload);
  } catch {
    return null;
  }
}

export function writeLookupToBrowserCache(cacheKey: string, payload: LookupPayload) {
  if (typeof window === "undefined" || !shouldCacheLookupPayload(payload)) {
    return;
  }

  try {
    const rawCache = window.localStorage.getItem(LOOKUP_CLIENT_CACHE_STORAGE_KEY);
    const cache = rawCache ? (JSON.parse(rawCache) as StoredLookupCache) : {};
    cache[cacheKey] = {
      expiresAt: Date.now() + LOOKUP_CLIENT_CACHE_TTL_MS,
      payload: getDisplayPayload(payload),
      savedAt: Date.now(),
    };

    const prunedEntries = Object.entries(cache)
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, LOOKUP_CLIENT_CACHE_LIMIT);

    window.localStorage.setItem(
      LOOKUP_CLIENT_CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(prunedEntries)),
    );
  } catch {
    // Browser storage is only an acceleration layer; lookup must keep working.
  }
}

export function shouldCacheLookupPayload(payload: LookupPayload) {
  return !payload.sources.some((source) => {
    if (source.status === "unavailable" || source.status === "loading") {
      return true;
    }

    return (
      source.status === "not_found" && VOLATILE_LOOKUP_SOURCE_IDS.has(source.sourceId)
    );
  });
}
