import {
  cleanAiMarkdown,
  htmlFromMarkdown,
  normalizeInlineText,
} from "./dictionary-utils";
import { getGeminiApiKeys } from "./gemini-keys";
import {
  buildGeminiUnavailableNote,
  createGeminiFailureState,
  noteGeminiHttpFailure,
} from "./gemini-runtime";
import type {
  DictionarySourceResult,
  LookupContext,
  LookupSection,
} from "./lookup-types";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSIONS = ["v1beta", "v1"] as const;
const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

type GrammarClassId =
  | "substantivo"
  | "artigo"
  | "adjetivo"
  | "pronome"
  | "numeral"
  | "verbo"
  | "adverbio"
  | "preposicao"
  | "conjuncao"
  | "interjeicao";

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

type GrammarPayload = {
  classId?: string;
  classMarkdown?: string;
  conjugationMarkdown?: string;
};

type GrammarResult = {
  payload: GrammarPayload | null;
  quotaLimited: boolean;
  serviceUnavailable: boolean;
};

const CLASS_ID_SET = new Set<GrammarClassId>([
  "substantivo",
  "artigo",
  "adjetivo",
  "pronome",
  "numeral",
  "verbo",
  "adverbio",
  "preposicao",
  "conjuncao",
  "interjeicao",
]);

function getGeminiModels() {
  return Array.from(
    new Set(
      [process.env.AI_MODEL, process.env.GEMINI_MODEL, ...DEFAULT_GEMINI_MODELS].filter(
        (model): model is string => Boolean(model?.trim()),
      ),
    ),
  );
}

function normalizeGrammarClassId(value: string | undefined) {
  const normalized = (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z]/gu, "");

  return CLASS_ID_SET.has(normalized as GrammarClassId)
    ? (normalized as GrammarClassId)
    : null;
}

function extractJsonObject(value: string) {
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  return cleaned.slice(start, end + 1);
}

function normalizeGrammarMarkdown(value: string | undefined) {
  const cleaned = cleanAiMarkdown(value ?? "")
    .replace(/^\s*(?:classe|definicao|definição)\s*:\s*/iu, "")
    .replace(/^\s*(?:forma e flexao|forma e flexão|conjugacao|conjugação)\s*:\s*/iu, "")
    .trim();

  return cleaned || null;
}

function buildSection(label: string, text: string): LookupSection {
  return {
    html: htmlFromMarkdown(text),
    label,
    text,
  };
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  sections: LookupSection[],
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: "Gramática",
    note,
    sections,
    sourceId: "gramatica",
    sourceUrl: null,
    status,
  };
}

function buildPrompt(word: string, context?: LookupContext) {
  const contextLines = [
    context?.documentTitle ? `- Titulo do documento: ${context.documentTitle}` : null,
    context?.documentAuthor ? `- Autor do documento: ${context.documentAuthor}` : null,
    context?.documentLabel ? `- Arquivo ou edicao: ${context.documentLabel}` : null,
  ].filter(Boolean) as string[];

  return [
    "Responda somente em JSON válido.",
    `Palavra portuguesa: ${word}`,
    "",
    ...(contextLines.length
      ? [
          "Contexto bibliografico disponivel:",
          ...contextLines,
          "",
        ]
      : []),
    "Use o contexto bibliografico apenas quando ele realmente ajudar a desfazer ambiguidades de sentido ou referencia.",
    "",
    "Tarefa:",
    "- Identifique a classe gramatical mais provável da forma selecionada.",
    "- Monte dois blocos em Markdown: um sobre a classe gramatical em si; outro sobre a forma selecionada.",
    "",
    "Regras:",
    "- Julgue a forma como ela circula no português contemporâneo.",
    '- Não reduza substantivos, adjetivos ou nomes autônomos a verbos por mera semelhança gráfica. Exemplo: "livraria" é substantivo, não forma de "livrar".',
    "- Se houver particípio com uso adjetival predominante, prefira a leitura de adjetivo.",
    "- Em classMarkdown, explique a classe em si com um pouco de amplitude: o que é, como funciona e que papel costuma exercer. Não despeje ali pessoa, tempo, gênero ou número da palavra selecionada.",
    "- Em conjugationMarkdown, disseque a forma selecionada. Se for verbo, dê infinitivo provável, leitura da flexão e observações úteis. Se não for verbo, registre forma de referência, gênero, número, grau ou traço morfológico pertinente, sem enrolação.",
    "- Use Markdown elegante com **negrito**, listas e *itálico* quando útil.",
    "- Não mencione IA, modelo, prompt ou ferramenta.",
    "- Quando a forma for substantivo próprio, diga isso de modo explícito.",
    "- Em topônimos, antropônimos e etnônimos, se houver mais de um referente conhecido e plausível, mencione brevemente os principais, sem tratar um único referente como exclusivo.",
    '- Em casos como "Mombaça", por exemplo, a nota pode reconhecer o topônimo e mencionar tanto o município cearense quanto a cidade histórica do Quênia, se essa duplicidade for plausível.',
    "",
    "classId deve ser exatamente um destes valores:",
    "substantivo | artigo | adjetivo | pronome | numeral | verbo | adverbio | preposicao | conjuncao | interjeicao",
    "",
    "Formato obrigatório:",
    '{"classId":"...","classMarkdown":"...","conjugationMarkdown":"..."}',
  ].join("\n");
}

async function fetchGeminiGrammar(
  requestedWord: string,
  context?: LookupContext,
): Promise<GrammarResult> {
  const apiKeys = getGeminiApiKeys();
  const failureState = createGeminiFailureState();

  if (apiKeys.length === 0) {
    console.warn("Mathesis grammar: Gemini API key is not available.");
    return { payload: null, quotaLimited: false, serviceUnavailable: false };
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: buildPrompt(requestedWord, context) }],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 1100,
      temperature: 0.05,
      topP: 0.5,
    },
  });

  for (const model of getGeminiModels()) {
    for (const version of GEMINI_API_VERSIONS) {
      for (const [apiKeyIndex, apiKey] of apiKeys.entries()) {
        const url = new URL(
          `${GEMINI_ENDPOINT}/${version}/models/${encodeURIComponent(
            model,
          )}:generateContent`,
        );
        url.searchParams.set("key", apiKey);

        try {
          const response = await fetch(url, {
            body,
            cache: "no-store",
            headers: {
              "content-type": "application/json",
            },
            method: "POST",
            signal: AbortSignal.timeout(22000),
          });

          if (!response.ok) {
            const errorText = await response.text();
            noteGeminiHttpFailure(failureState, response.status, errorText);
            console.warn(
              `GEMINI_GRAMMAR_FAIL status=${response.status} model=${model} version=${version} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=${errorText.slice(0, 160)}`,
            );
            continue;
          }

          const payload = (await response.json()) as GeminiResponse;
          const rawText =
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "";
          const jsonText = extractJsonObject(rawText);

          if (!jsonText) {
            console.warn(
              `GEMINI_GRAMMAR_FAIL model=${model} version=${version} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=no-json-object`,
            );
            continue;
          }

          const parsed = JSON.parse(jsonText) as GrammarPayload;
          return {
            payload: parsed,
            quotaLimited: false,
            serviceUnavailable: false,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (/503|high demand|service unavailable|temporarily unavailable/iu.test(message)) {
            failureState.serviceUnavailable = true;
          }
          console.warn(
            `GEMINI_GRAMMAR_FAIL model=${model} version=${version} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=${message.slice(0, 160)}`,
          );
          continue;
        }
      }
    }
  }

  return {
    payload: null,
    quotaLimited: failureState.quotaLimited,
    serviceUnavailable: failureState.serviceUnavailable,
  };
}

export async function lookupGrammarAi(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const result = await fetchGeminiGrammar(requestedWord, context);
  const classId = normalizeGrammarClassId(result.payload?.classId);
  const classMarkdown = normalizeGrammarMarkdown(result.payload?.classMarkdown);
  const conjugationMarkdown = normalizeGrammarMarkdown(
    result.payload?.conjugationMarkdown,
  );

  if (!classId || !classMarkdown || !conjugationMarkdown) {
    return buildResult(
      requestedWord,
      "unavailable",
      buildGeminiUnavailableNote("gramatica", {
        authFailed: false,
        badRequest: false,
        quotaLimited: result.quotaLimited,
        serviceUnavailable: result.serviceUnavailable,
      }),
      [],
    );
  }

  return buildResult(
    requestedWord,
    "found",
    "Nota gramatical gerada pelo Gemini para apoiar a leitura.",
    [
      buildSection("Classe", classMarkdown),
      buildSection("Classificação", conjugationMarkdown),
    ],
  );
}
