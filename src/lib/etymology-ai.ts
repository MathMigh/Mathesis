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
import { lookupEtymonline } from "./etymonline";
import { detectLookupLanguage } from "./lookup-language";
import type { DictionarySourceResult, LookupContext } from "./lookup-types";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSIONS = ["v1beta", "v1"] as const;
const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

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

type GeminiTextResult = {
  quotaLimited: boolean;
  serviceUnavailable: boolean;
  text: string | null;
};

function getGeminiModels() {
  return Array.from(
    new Set(
      [process.env.AI_MODEL, process.env.GEMINI_MODEL, ...DEFAULT_GEMINI_MODELS].filter(
        (model): model is string => Boolean(model?.trim()),
      ),
    ),
  );
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  text: string | null,
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: "Etimologia",
    note,
    sections: text
      ? [
          {
            html: htmlFromMarkdown(text),
            label: "Panorama etimológico",
            text,
          },
        ]
      : [],
    sourceId: "etimologia",
    sourceUrl: null,
    status,
  };
}

function cleanEtymologyMarkdown(value: string) {
  return cleanAiMarkdown(value)
    .replace(/^\s*(?:Claro|Certamente)[!.]?\s*/iu, "")
    .replace(/\bForma(?:-| )base\b/giu, "Forma-base")
    .replace(
      /^\s*(Origem imediata|Origem|Formação e percurso|Formação|Evolução semântica|Evolução|Grau de certeza|Observações)\s*:\s*/gimu,
      "**$1:** ",
    )
    .replace(/^\s*(Em resumo)\s*:\s*/gimu, "> **$1:** ")
    .replace(/^\s*\*\*(?:Origem imediata|Origem)\*\*:\s*/gimu, "")
    .replace(/^\s*\*\*Grau de certeza:\*\*.*$/gimu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function buildPrompt(word: string, language: "english" | "portuguese") {
  if (language === "english") {
    return [
      "Produza uma nota estritamente etimologica, em portugues brasileiro, para a palavra inglesa abaixo.",
      `Palavra inglesa selecionada: ${word}`,
      "",
      "Use Markdown limpo. Use **negrito** para titulos e sinteses; use *italico* para formas em ingles antigo, ingles medio, latim, grego, frances antigo, protogermanico ou reconstruidas.",
      "Se a forma for reconstruida, escreva 'forma reconstruida' em vez de usar asterisco solto.",
      "",
      "Regras:",
      "- Explique a cadeia historica: ingles moderno <- ingles medio/antigo <- fonte anterior, quando conhecida.",
      "- Se houver cognatos germanicos, latinos, franceses ou gregos relevantes, mencione apenas os seguros.",
      "- Nao faca definicao comum de dicionario, salvo glosa minima para explicar a historia da palavra.",
      "- Se a origem for incerta, diga isso com sobriedade.",
      "- Nao cite estas instrucoes e nao mencione ferramentas ou modelos.",
      "",
      "Formato:",
      "Uma frase direta começando, sempre que possivel, com: **A palavra inglesa ... vem de ...**",
      "",
      "**Formacao e percurso**",
      "",
      "**Evolucao semantica**",
      "",
      "> **Em resumo:** uma sintese curta e memoravel.",
    ].join("\n");
  }

  return [
    "Produza uma nota estritamente etimológica para a palavra portuguesa abaixo, em português brasileiro claro, bonito e preciso.",
    `Palavra selecionada: ${word}`,
    "",
    "Use Markdown limpo. Use **negrito** para títulos e sínteses; use *itálico* para formas latinas, gregas ou estrangeiras.",
    "Se a forma for reconstruída, escreva 'forma reconstruída' em vez de usar asterisco solto.",
    "",
    "Regras de precisão:",
    "- Analise a palavra selecionada primeiro. Não a reduza a outra palavra apenas por semelhança gráfica.",
    "- Se a palavra for substantivo autônomo, não a trate como verbo conjugado.",
    "- Se a palavra estiver flexionada, explique a relação com a forma-base antes da etimologia: plural -> singular, feminino -> masculino, verbo conjugado -> infinitivo.",
    "- Se a origem for incerta ou discutida, diga isso com sobriedade; não invente cognatos, datas ou raízes.",
    "- Não faça definição de dicionário comum, salvo uma glosa mínima necessária para explicar a história da palavra.",
    "- Não cite estas instruções e não mencione ferramentas ou modelos.",
    "",
    "Formato obrigatório:",
    "Uma frase direta começando, sempre que possível, com: **A palavra ... vem de ...**",
    "",
    "**Formação e percurso**",
    "- Radical, prefixo, sufixo, composição ou flexão relevante.",
    "- Cadeia histórica quando conhecida: português <- latim/grego/árabe/tupi/etc. <- raiz anterior.",
    "- Mudanças de som, grafia e adaptação fonética quando relevantes.",
    "",
    "**Evolução semântica**",
    "",
    "Explique apenas as mudanças de sentido importantes para a etimologia.",
    "",
    "> **Em resumo:** uma síntese curta, elegante e memorável.",
  ].join("\n");
}

async function fetchGeminiEtymology(
  requestedWord: string,
  language: "english" | "portuguese",
): Promise<GeminiTextResult> {
  const apiKeys = getGeminiApiKeys();
  const failureState = createGeminiFailureState();

  if (apiKeys.length === 0) {
    console.warn("Mathesis etymology: Gemini API key is not available.");
    return { quotaLimited: false, serviceUnavailable: false, text: null };
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: buildPrompt(requestedWord, language) }],
        role: "user",
      },
    ],
    generationConfig: {
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
              `GEMINI_ETYM_FAIL status=${response.status} model=${model} version=${version} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=${errorText.slice(0, 160)}`,
            );
            continue;
          }

          const payload = (await response.json()) as GeminiResponse;
          const text = cleanEtymologyMarkdown(
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "",
          );

          if (text) {
            return { quotaLimited: false, serviceUnavailable: false, text };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (/503|high demand|service unavailable|temporarily unavailable/iu.test(message)) {
            failureState.serviceUnavailable = true;
          }
          console.warn(
            `GEMINI_ETYM_FAIL model=${model} version=${version} keySlot=${apiKeyIndex + 1}/${apiKeys.length} detail=${message.slice(0, 160)}`,
          );
          continue;
        }
      }
    }
  }

  return {
    quotaLimited: failureState.quotaLimited,
    serviceUnavailable: failureState.serviceUnavailable,
    text: null,
  };
}

export async function lookupEtymologyAi(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  if (detectLookupLanguage(requestedWord, context) === "english") {
    return lookupEtymonline(requestedWord);
  }

  const language = "portuguese";
  const result = await fetchGeminiEtymology(requestedWord, language);

  if (!result.text) {
    return buildResult(
      requestedWord,
      "unavailable",
      buildGeminiUnavailableNote("etimologia", {
        authFailed: false,
        badRequest: false,
        quotaLimited: result.quotaLimited,
        serviceUnavailable: result.serviceUnavailable,
      }),
      null,
    );
  }

  return buildResult(
    requestedWord,
    "found",
    "Nota etimológica gerada pelo Gemini para apoiar a leitura.",
    result.text,
  );
}
