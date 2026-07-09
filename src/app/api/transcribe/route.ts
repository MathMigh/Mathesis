import { NextResponse } from "next/server";
import { getGeminiApiKeys } from "@/lib/gemini-keys";
import {
  buildGeminiUnavailableNote,
  createGeminiFailureState,
  noteGeminiHttpFailure,
} from "@/lib/gemini-runtime";
import { consumeRateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSIONS = ["v1beta", "v1"] as const;
const DEFAULT_TRANSCRIPTION_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;
const MAX_AUDIO_BASE64_LENGTH = 12_000_000;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function getTranscriptionModels() {
  return Array.from(
    new Set(
      [
        process.env.AI_TRANSCRIPTION_MODEL,
        process.env.GEMINI_TRANSCRIPTION_MODEL,
        process.env.AI_MODEL,
        process.env.GEMINI_MODEL,
        ...DEFAULT_TRANSCRIPTION_MODELS,
      ].filter((model): model is string => Boolean(model?.trim())),
    ),
  );
}

function cleanTranscription(value: string) {
  return value
    .replace(/^\s*(?:Transcrição|Transcricao)\s*:\s*/iu, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeAudioMimeType(value: string) {
  const mimeType = value.split(";")[0]?.trim().toLocaleLowerCase("en-US");

  if (!mimeType) {
    return "audio/webm";
  }

  if (
    ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"].includes(
      mimeType,
    )
  ) {
    return mimeType;
  }

  return "audio/webm";
}

function buildMimeTypeCandidates(value: string) {
  const raw = value.trim() || "audio/webm";
  const normalized = normalizeAudioMimeType(raw);

  return Array.from(new Set([raw, normalized, "audio/webm"].filter(Boolean)));
}

function buildTranscriptionBody(audioBase64: string, mimeType: string) {
  return JSON.stringify({
    contents: [
      {
        parts: [
          {
            text:
              "Transcreva fielmente este áudio em português. " +
              "Mantenha pontuação natural, preserve nomes próprios quando possível " +
              "e devolva somente a transcrição, sem comentários.",
          },
          {
            inlineData: {
              data: audioBase64,
              mimeType,
            },
          },
        ],
        role: "user",
      },
    ],
    generationConfig: {
      temperature: 0,
      topP: 0.4,
    },
  });
}

async function transcribeWithGemini(audioBase64: string, mimeTypes: string[]) {
  const apiKeys = getGeminiApiKeys();
  const failureState = createGeminiFailureState();

  if (apiKeys.length === 0) {
    throw new Error("A transcrição por IA não está configurada.");
  }

  for (const model of getTranscriptionModels()) {
    for (const version of GEMINI_API_VERSIONS) {
      for (const mimeType of mimeTypes) {
        for (const [apiKeyIndex, apiKey] of apiKeys.entries()) {
          const url = new URL(
            `${GEMINI_ENDPOINT}/${version}/models/${encodeURIComponent(
              model,
            )}:generateContent`,
          );
          url.searchParams.set("key", apiKey);

          try {
            const response = await fetch(url, {
              body: buildTranscriptionBody(audioBase64, mimeType),
              cache: "no-store",
              headers: {
                "content-type": "application/json",
              },
              method: "POST",
              signal: AbortSignal.timeout(45000),
            });

            if (!response.ok) {
              const errorText = await response.text();
              noteGeminiHttpFailure(failureState, response.status, errorText);
              console.warn(
                `GEMINI_TRANSCRIBE_FAIL status=${response.status} model=${model} version=${version} mime=${mimeType} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=${errorText.slice(0, 160)}`,
              );
              continue;
            }

            const payload = (await response.json()) as GeminiResponse;
            const text = cleanTranscription(
              payload.candidates?.[0]?.content?.parts
                ?.map((part) => part.text ?? "")
                .join("\n") ?? "",
            );

            if (text) {
              return text;
            }

            console.warn(
              `GEMINI_TRANSCRIBE_FAIL model=${model} version=${version} mime=${mimeType} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=empty-response`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "falha desconhecida";
            if (/503|high demand|service unavailable|temporarily unavailable/iu.test(message)) {
              failureState.serviceUnavailable = true;
            }
            console.warn(
              `GEMINI_TRANSCRIBE_FAIL model=${model} version=${version} mime=${mimeType} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=${message.slice(0, 160)}`,
            );
            continue;
          }
        }
      }
    }
  }

  throw new Error(
    buildGeminiUnavailableNote("transcricao", failureState),
  );
}

export async function POST(request: Request) {
  const rateLimit = consumeRateLimit(request, "transcribe", {
    intervalMs: 60_000,
    limit: 8,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Muitas transcricoes em pouco tempo. Tente novamente em instantes." },
      {
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-Content-Type-Options": "nosniff",
        },
        status: 429,
      },
    );
  }

  try {
    const body = (await request.json()) as {
      audioBase64?: string;
      mimeType?: string;
    };
    const audioBase64 = body.audioBase64?.replace(/^data:[^,]+,/u, "") ?? "";
    const mimeTypes = buildMimeTypeCandidates(body.mimeType?.trim() || "audio/webm");

    if (!audioBase64) {
      return NextResponse.json(
        { message: "Envie uma gravação para transcrever." },
        { status: 400 },
      );
    }

    if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
      return NextResponse.json(
        {
          message:
            "Esta gravação ficou grande demais para esta versão. Tente um trecho menor.",
        },
        { status: 413 },
      );
    }

    const text = await transcribeWithGemini(audioBase64, mimeTypes);

    return NextResponse.json(
      { text },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível transcrever este áudio.";

    return NextResponse.json({ message }, { status: 502 });
  }
}
