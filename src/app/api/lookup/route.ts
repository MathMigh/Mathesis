import { NextResponse } from "next/server";
import { lookupAllSources, lookupSource } from "@/lib/lookup";
import { LOOKUP_SOURCE_IDS } from "@/lib/lookup-source-config";
import {
  consumeRateLimit,
  sanitizeHeaderValue,
} from "@/lib/request-security";
import type { DictionarySourceId, LookupContext } from "@/lib/lookup-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_WORD = /^[\p{L}\p{M}'-]{1,80}$/u;
const VALID_LOOKUP_PHRASE = /^[\p{L}\p{M}'-]+(?:\s+[\p{L}\p{M}'-]+){0,3}$/u;
const LOOKUP_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const VALID_DOCUMENT_LANGUAGES = new Set(["portuguese", "latin", "english"]);
const AI_BACKED_SOURCE_IDS = new Set<DictionarySourceId>([
  "etimologia",
  "mitologico",
  "wikipedia",
  "imagens",
]);

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    headers: {
      ...LOOKUP_CACHE_HEADERS,
      ...headers,
    },
    status,
  });
}

function buildSafeLookupContext(searchParams: URLSearchParams): LookupContext {
  const language = sanitizeHeaderValue(searchParams.get("documentLanguage"), 24);

  return {
    documentAuthor: sanitizeHeaderValue(searchParams.get("documentAuthor"), 160) || undefined,
    documentLanguage: VALID_DOCUMENT_LANGUAGES.has(language) ? language : undefined,
    documentLabel: sanitizeHeaderValue(searchParams.get("documentLabel"), 160) || undefined,
    selectionContextText:
      sanitizeHeaderValue(searchParams.get("selectionContextText"), 800) || undefined,
    documentTitle: sanitizeHeaderValue(searchParams.get("documentTitle"), 160) || undefined,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawWord = searchParams.get("word")?.trim().normalize("NFC");
  const rawSource = searchParams.get("source")?.trim();
  const context = buildSafeLookupContext(searchParams);

  if (!rawWord) {
    return jsonResponse(
      { message: "Informe uma palavra para consultar." },
      400,
    );
  }

  const allowsPhrase =
    rawSource === "wikipedia";

  if (!(allowsPhrase ? VALID_LOOKUP_PHRASE.test(rawWord) : VALID_WORD.test(rawWord))) {
    return jsonResponse(
      {
        message: allowsPhrase
          ? "A consulta da Wikipedia aceita uma palavra ou um nome curto."
          : "A consulta aceita apenas uma unica palavra.",
      },
      400,
    );
  }

  try {
    const sourceForLimit =
      rawSource && (LOOKUP_SOURCE_IDS as readonly string[]).includes(rawSource)
        ? (rawSource as DictionarySourceId)
        : null;
    const rateLimit = await consumeRateLimit(
      request,
      sourceForLimit && AI_BACKED_SOURCE_IDS.has(sourceForLimit)
        ? "lookup-ai"
        : "lookup",
      sourceForLimit && AI_BACKED_SOURCE_IDS.has(sourceForLimit)
        ? { intervalMs: 60_000, limit: 36 }
        : { intervalMs: 60_000, limit: 260 },
    );

    if (!rateLimit.allowed) {
      return jsonResponse(
        { message: "Muitas consultas em pouco tempo. Tente novamente em instantes." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) },
      );
    }

    if (rawSource) {
      if (!(LOOKUP_SOURCE_IDS as readonly string[]).includes(rawSource)) {
        return jsonResponse(
          { message: "Fonte de consulta invalida." },
          400,
        );
      }

      const sourceId = rawSource as (typeof LOOKUP_SOURCE_IDS)[number];

      const sourcePayload = await lookupSource(
        rawWord,
        sourceId,
        context,
      );

      return jsonResponse(sourcePayload);
    }

    const payload = await lookupAllSources(rawWord, context);

    return jsonResponse(payload);
  } catch {
    return jsonResponse(
      { message: "Nao foi possivel consultar os dicionarios agora." },
      502,
    );
  }
}
