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
    return NextResponse.json(
      { message: "Informe uma palavra para consultar." },
      { status: 400 },
    );
  }

  const allowsPhrase =
    rawSource === "wikipedia";

  if (!(allowsPhrase ? VALID_LOOKUP_PHRASE.test(rawWord) : VALID_WORD.test(rawWord))) {
    return NextResponse.json(
      {
        message: allowsPhrase
          ? "A consulta da Wikipedia aceita uma palavra ou um nome curto."
          : "A consulta aceita apenas uma unica palavra.",
      },
      { status: 400 },
    );
  }

  try {
    const sourceForLimit =
      rawSource && (LOOKUP_SOURCE_IDS as readonly string[]).includes(rawSource)
        ? (rawSource as DictionarySourceId)
        : null;
    const rateLimit = consumeRateLimit(
      request,
      sourceForLimit && AI_BACKED_SOURCE_IDS.has(sourceForLimit)
        ? "lookup-ai"
        : "lookup",
      sourceForLimit && AI_BACKED_SOURCE_IDS.has(sourceForLimit)
        ? { intervalMs: 60_000, limit: 36 }
        : { intervalMs: 60_000, limit: 260 },
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Muitas consultas em pouco tempo. Tente novamente em instantes." },
        {
          headers: {
            ...LOOKUP_CACHE_HEADERS,
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
          status: 429,
        },
      );
    }

    if (rawSource) {
      if (!(LOOKUP_SOURCE_IDS as readonly string[]).includes(rawSource)) {
        return NextResponse.json(
          { message: "Fonte de consulta invalida." },
          { status: 400 },
        );
      }

      const sourceId = rawSource as (typeof LOOKUP_SOURCE_IDS)[number];

      const sourcePayload = await lookupSource(
        rawWord,
        sourceId,
        context,
      );

      return NextResponse.json(sourcePayload, {
        headers: LOOKUP_CACHE_HEADERS,
      });
    }

    const payload = await lookupAllSources(rawWord, context);

    return NextResponse.json(payload, {
      headers: LOOKUP_CACHE_HEADERS,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel consultar os dicionarios.";

    return NextResponse.json({ message }, { status: 502 });
  }
}
