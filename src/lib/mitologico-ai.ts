import { cleanAiMarkdown, normalizeInlineText } from "./dictionary-utils";
import { getGeminiApiKeys } from "./gemini-keys";
import { findPortugueseMitologicoNameHints } from "./mitologico-name-reference";
import type { MitologicoEntry } from "./mitologico-data";
import type { MitologicoSupportBlock } from "./mitologico-support";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSIONS = ["v1beta"] as const;
const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
] as const;
const MITOLOGICO_AI_TOTAL_BUDGET_MS = 45000;
const MITOLOGICO_AI_REQUEST_TIMEOUT_MS = 24000;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type MitologicoAiPayload = {
  aliases?: string[];
  canonicalTerm?: string;
  originalLabel?: string;
  status?: string;
  text?: string;
};

export type MitologicoAiAdaptation = {
  aliases: string[];
  canonicalTerm: string;
  originalLabel: string | null;
  text: string;
};

export type MitologicoAiDirectEntry = {
  aliases: string[];
  canonicalTerm: string;
  originalLabel: string | null;
  text: string;
};

type MitologicoAiAdaptationOptions = {
  referenceEntry?: MitologicoEntry | null;
  supportBlocks?: MitologicoSupportBlock[];
};

type MitologicoTextPolishOptions = {
  canonicalTerm: string;
  supportBlocks?: MitologicoSupportBlock[];
};

function getGeminiModels() {
  return Array.from(
    new Set(
      [process.env.GEMINI_MODEL_MITOLOGIA, ...DEFAULT_GEMINI_MODELS].filter(
        (model): model is string => Boolean(model?.trim()),
      ),
    ),
  );
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

function normalizeAliasList(values: string[], canonicalTerm: string) {
  return Array.from(
    new Set(
      [canonicalTerm, ...values]
        .map((value) => normalizeInlineText(value.normalize("NFC")))
        .filter(Boolean),
    ),
  );
}

function cleanMitologicoBody(value: string) {
  return cleanAiMarkdown(value)
    .replace(
      /^\s*(?:Claro|Segue(?: abaixo)?|Texto(?: reconstru[ií]do)?|Verbete(?: reconstru[ií]do)?)[:.]?\s*/iu,
      "",
    )
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function cleanMitologicoPlainText(value: string) {
  return cleanAiMarkdown(value)
    .replace(/^\s*```(?:text|txt)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function buildDirectMitologicoPrompt(
  requestedWord: string,
  portugueseHints: string[],
) {
  return [
    "Responda somente em JSON valido.",
    "Voce esta montando uma nota mitologica em portugues para apoiar a leitura.",
    "",
    "Regras obrigatorias:",
    "- O termo consultado ja passou por uma whitelist mitologica curada; portanto, trate-o como forte candidato a nome mitologico serio, inclusive em tradicoes menos canônicas no repertório ocidental.",
    "- Trabalhe apenas com mitologia em sentido proprio: deuses, herois, criaturas, entidades, lugares miticos, episodios e nomes tradicionais ligados a mitologias reconhecidas.",
    "- Considere tambem mitologias indígenas, afro-atlânticas, semíticas, orientais e outras tradições historicamente atestadas, não apenas a greco-romana.",
    "- Ignore autores modernos, personagens literarios nao mitologicos, pessoas historicas comuns e falsos cognatos.",
    "- Se o termo nao puder ser identificado com boa confianca como verbete mitologico, devolva apenas {\"status\":\"not_found\"}.",
    "- Se o termo puder ser identificado, devolva um texto enciclopedico claro, em portugues, sem falar de IA, sem markdown excessivo e sem inventar fatos.",
    "- Corrija a forma do nome para o portugues quando isso for claro.",
    "- Pode incluir variantes gregas, latinas ou equivalentes tradicionais em aliases, mas priorize a forma portuguesa.",
    "- Entregue uma nota substantiva: nao seja telegráfico. Em geral, escreva entre 2 e 4 paragrafos curtos ou o equivalente em blocos bem cheios.",
    "- Diga de que tradicao mitica se trata e qual o papel principal da figura ou entidade.",
    "- Quando couber, mencione relacoes decisivas, atributos, episodios ou associacoes simbolicas importantes.",
    "- Nao acrescente bibliografia, notas de edicao, indices nem listas tecnicas.",
    portugueseHints.length
      ? `- Formas portuguesas de referencia para orientar a resposta: ${portugueseHints.join(" | ")}.`
      : null,
    "",
    "Formato obrigatorio:",
    "{\"status\":\"found\",\"canonicalTerm\":\"...\",\"originalLabel\":\"...\",\"aliases\":[\"...\"],\"text\":\"...\"}",
    "",
    `Termo consultado: ${requestedWord}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function stripEmbeddedPageMarkers(
  text: string,
  pageNumbers: number[],
) {
  let cleaned = text;

  for (const pageNumber of pageNumbers) {
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      continue;
    }

    const token = String(pageNumber).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    cleaned = cleaned.replace(
      new RegExp(
        `(?<!pág\\.\\s)(?<!pag\\.\\s)(?<!p\\.\\s)(?<!pp\\.\\s)\\b${token}\\b`,
        "gu",
      ),
      "",
    );
  }

  return cleaned.replace(/\s{2,}/gu, " ").replace(/\s+([,.;:!?)])/gu, "$1").trim();
}

function countPatternMatches(value: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function looksLikeSpanishMitologicoText(value: string) {
  const spanishSignals = [
    /\bhijo\b/iu,
    /\bhija\b/iu,
    /\bdonde\b/iu,
    /\bmientras\b/iu,
    /\bhab[ií]a\b/iu,
    /\bllamado\b/iu,
    /\bllamada\b/iu,
    /\bestaba\b/iu,
    /\bestuvieron\b/iu,
    /\bpero\b/iu,
    /\basi\b/iu,
    /\bsolo\b/iu,
    /\bdiosa\b/iu,
  ];
  return countPatternMatches(value, spanishSignals) >= 2;
}

function looksLikeSpanishMitologicoHeading(value: string) {
  return /\b(?:Afrodita|Atenea|Eneas|Heracles|Hercules|Ulises|Teseo|Perseo|Orfeo|Prometeo)\b/iu.test(
    value,
  );
}

function shouldAttemptMitologicoAdaptation(
  entry: MitologicoEntry,
  options?: MitologicoAiAdaptationOptions,
) {
  const normalizedText = normalizeInlineText(entry.text);
  const isCrossReference = /^(?:v|vs)\.\s/iu.test(normalizedText);

  if (!normalizedText) {
    return false;
  }

  if (isCrossReference) {
    return Boolean(options?.referenceEntry);
  }

  return true;
}

function buildPrompt(
  entry: MitologicoEntry,
  portugueseHints: string[],
  options?: MitologicoAiAdaptationOptions,
) {
  const referenceEntry = options?.referenceEntry ?? null;
  const supportBlocks = options?.supportBlocks ?? [];

  return [
    "Responda somente em JSON valido.",
    "Reconstrua um verbete do Dicionario da Mitologia Grega e Romana de Pierre Grimal.",
    "Se o material estiver em espanhol, traduza integralmente para portugues.",
    "Se ja estiver em portugues, apenas corrija OCR, acentuacao, hifenizacao errada, letras comidas e nomes proprios deformados.",
    "",
    "Regras obrigatorias:",
    "- Entregue tudo em portugues.",
    "- O titulo do verbete deve ficar em portugues, sem manter a forma espanhola como principal.",
    "- Preserve o tom enciclopedico e o conteudo do verbete.",
    "- Nao resuma, nao invente fatos e nao acrescente comentarios seus.",
    "- Nao transforme o verbete em sintese, panorama, resumo ou ficha curta.",
    "- Se o texto bruto tiver varios periodos ou varios paragrafos, preserve praticamente toda essa extensao, corrigindo-a em vez de condensar.",
    "- Entregue o verbete completo, reconstruindo as frases e os nomes faltantes quando a leitura mais plausivel for clara.",
    "- Mantenha uma extensao proxima da materia bruta util; nao encolha o verbete desnecessariamente.",
    "- Se o verbete for curto por natureza, mantenha-o curto, mas correto, limpo e sem palavras truncadas.",
    "- Nao deixe restos de OCR como letras faltando, palavras em espanhol, nomes partidos ou sequencias absurdas.",
    "- Remova numeros de pagina, restos de cabecalho, notas de rodape vazadas e marcas tipograficas que tenham invadido o corpo do verbete.",
    "- Refaça palavras partidas por quebra de linha ou OCR, como 'epi teto', 'nom bre', 'Ate nea' e semelhantes.",
    "- Corrija nomes mitologicos para a forma portuguesa usual quando isso for claro.",
    "- Corrija tambem formas gregas ou latinas corrompidas que aparecam logo apos o lema, entre parenteses ou em destaque.",
    "- Se a forma grega ou latina estiver demasiado corrompida e nao puder ser reconstruida com alta confianca, omita essa forma em vez de deixar lixo visual.",
    "- Nos aliases, mantenha a forma portuguesa como principal. Variantes gregas ou latinas podem aparecer quando forem tradicionais e uteis, mas nao liste formas em espanhol.",
    "- Se alguma passagem continuar parcialmente incerta, escolha a leitura mais plausivel e conservadora.",
    referenceEntry
      ? "- Quando houver um verbete principal de apoio, mantenha como canonicalTerm o termo consultado, mas use o verbete principal para reconstituir uma nota mais completa, correta e fluida sobre esse termo."
      : null,
    supportBlocks.length
      ? "- Quando houver excertos em portugues vindos de outras edicoes do Grimal, trate-os como apoio prioritario para corrigir palavras partidas, trechos apagados, nomes proprios e falsas leituras."
      : null,
    "- Nao cite IA, OCR, modelo, prompt nem justificativas.",
    portugueseHints.length
      ? `- Use, quando couber, estas formas portuguesas de referencia para nomes proprios: ${portugueseHints.join(" | ")}.`
      : null,
    "",
    "Formato obrigatorio:",
    '{"canonicalTerm":"...","originalLabel":"...","aliases":["..."],"text":"..."}',
    "",
    `Verbete atual: ${entry.canonicalTerm}`,
    entry.aliases.length ? `Aliases atuais: ${entry.aliases.join(" | ")}` : "Aliases atuais:",
    "",
    "Texto bruto:",
    normalizeInlineText(entry.text),
    ...(referenceEntry
      ? [
          "",
          `Verbete principal de apoio: ${referenceEntry.canonicalTerm}`,
          referenceEntry.aliases.length
            ? `Aliases de apoio: ${referenceEntry.aliases.join(" | ")}`
            : "Aliases de apoio:",
          "",
          "Texto bruto de apoio:",
          normalizeInlineText(referenceEntry.text),
        ]
      : []),
    ...(supportBlocks.length
      ? [
          "",
          "Excerto(s) portugueses de apoio:",
          ...supportBlocks.flatMap((block) => [
            `[${block.label}]`,
            normalizeInlineText(block.text),
            "",
          ]),
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}

function looksLikeUsefulMitologicoAdaptation(
  entry: MitologicoEntry,
  payload: MitologicoAiPayload,
  options?: MitologicoAiAdaptationOptions,
) {
  const canonicalTerm = normalizeInlineText((payload.canonicalTerm ?? "").normalize("NFC"));
  const text = cleanMitologicoBody(payload.text ?? "");

  if (!canonicalTerm || !text) {
    return false;
  }

  const originalLength = normalizeInlineText(entry.text).length;
  const adaptedLength = normalizeInlineText(text).length;
  const originalParagraphCount = normalizeInlineText(entry.text)
    .split(/\n{2,}/u)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean).length;
  const adaptedParagraphCount = text
    .split(/\n{2,}/u)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean).length;

  const minimumLength =
    originalLength <= 180
      ? Math.max(34, Math.floor(originalLength * 0.72))
      : options?.referenceEntry
        ? Math.max(120, Math.floor(originalLength * 0.82))
        : originalLength >= 1400
          ? Math.max(900, Math.floor(originalLength * 0.92))
          : originalLength >= 800
            ? Math.max(520, Math.floor(originalLength * 0.88))
            : Math.max(180, Math.floor(originalLength * 0.8));

  if (adaptedLength < minimumLength) {
    return false;
  }

  if (
    originalParagraphCount >= 3 &&
    adaptedParagraphCount > 0 &&
    adaptedParagraphCount < Math.max(2, Math.floor(originalParagraphCount * 0.6))
  ) {
    return false;
  }

  return true;
}

function looksLikeUsefulMitologicoPolish(
  originalText: string,
  polishedText: string,
) {
  const original = normalizeInlineText(originalText);
  const polished = cleanMitologicoPlainText(polishedText);

  if (!original || !polished) {
    return false;
  }

  const originalLength = original.length;
  const polishedLength = normalizeInlineText(polished).length;
  const originalParagraphCount = original
    .split(/\n{2,}/u)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean).length;
  const polishedParagraphCount = polished
    .split(/\n{2,}/u)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean).length;
  const minimumLength =
    originalLength >= 12000
      ? Math.floor(originalLength * 0.95)
      : originalLength >= 6000
        ? Math.floor(originalLength * 0.93)
        : originalLength >= 1800
          ? Math.floor(originalLength * 0.9)
          : Math.max(70, Math.floor(originalLength * 0.76));

  if (polishedLength < minimumLength) {
    return false;
  }

  if (
    originalParagraphCount >= 3 &&
    polishedParagraphCount > 0 &&
    polishedParagraphCount < Math.max(2, Math.floor(originalParagraphCount * 0.55))
  ) {
    return false;
  }

  if (/^(?:claro|segue|verbete|texto reconstru[ií]do)[:.]?/iu.test(polished)) {
    return false;
  }

  return true;
}

function buildPolishPrompt(
  text: string,
  portugueseHints: string[],
  options: MitologicoTextPolishOptions,
) {
  const supportBlocks = options.supportBlocks ?? [];

  return [
    "Corrija um verbete do Dicionario da Mitologia Grega e Romana de Pierre Grimal.",
    "Responda somente com o texto final corrigido, em portugues, sem JSON, sem comentarios e sem introducao.",
    "",
    "Regras obrigatorias:",
    "- Preserve o verbete inteiro.",
    "- Nao resuma.",
    "- Nao encurte.",
    "- Nao transforme em sintese.",
    "- Corrija OCR, acentos, palavras partidas, nomes deformados e pontuacao quebrada.",
    "- Reconstitua as palavras faltantes quando a leitura mais plausivel for clara.",
    "- Preserve a extensao e o numero de paragrafos tanto quanto possivel.",
    "- Se o texto estiver em portugues ruim por OCR, apenas limpe e reconstrua.",
    "- Se aparecer algo em espanhol, traduza para portugues.",
    "- Nao acrescente informacoes novas.",
    "- Nao elimine trechos validos do verbete.",
    "- Nao explique o que fez.",
    "- Se houver uma forma grega ou latina ilegivel no inicio do verbete, corrija-a; se isso nao for possivel com seguranca, remova-a.",
    portugueseHints.length
      ? `- Use, quando couber, estas formas portuguesas de referencia para nomes proprios: ${portugueseHints.join(" | ")}.`
      : null,
    supportBlocks.length
      ? "- Os excertos de apoio abaixo sao prioritarios para nomes proprios, palavras partidas e leituras apagadas."
      : null,
    "",
    `Verbete: ${options.canonicalTerm}`,
    "",
    "Texto bruto:",
    normalizeInlineText(text),
    ...(supportBlocks.length
      ? [
          "",
          "Excerto(s) portugueses de apoio:",
          ...supportBlocks.flatMap((block) => [
            `[${block.label}]`,
            normalizeInlineText(block.text),
            "",
          ]),
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function adaptMitologicoEntry(
  entry: MitologicoEntry,
  options?: MitologicoAiAdaptationOptions,
): Promise<MitologicoAiAdaptation | null> {
  if (!shouldAttemptMitologicoAdaptation(entry, options)) {
    return null;
  }

  const apiKeys = getGeminiApiKeys();
  const portugueseHints = await findPortugueseMitologicoNameHints([
    entry.canonicalTerm,
    ...entry.aliases,
  ]);

  if (apiKeys.length === 0) {
    return null;
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: buildPrompt(entry, portugueseHints, options) }],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 3200,
      temperature: 0.08,
      topP: 0.45,
    },
  });
  const startedAt = Date.now();

  for (const model of getGeminiModels()) {
    for (const version of GEMINI_API_VERSIONS) {
      for (const apiKey of apiKeys) {
        if (Date.now() - startedAt >= MITOLOGICO_AI_TOTAL_BUDGET_MS) {
          return null;
        }

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
            signal: AbortSignal.timeout(MITOLOGICO_AI_REQUEST_TIMEOUT_MS),
          });

          if (!response.ok) {
            continue;
          }

          const payload = (await response.json()) as GeminiResponse;
          const rawText =
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "";
          const jsonText = extractJsonObject(rawText);

          if (!jsonText) {
            continue;
          }

          const parsed = JSON.parse(jsonText) as MitologicoAiPayload;

          if (!looksLikeUsefulMitologicoAdaptation(entry, parsed, options)) {
            continue;
          }

          const canonicalTerm = normalizeInlineText(
            (parsed.canonicalTerm ?? "").normalize("NFC"),
          );
          const aliases = normalizeAliasList(parsed.aliases ?? [], canonicalTerm);
          const originalLabel = normalizeInlineText(
            (parsed.originalLabel ?? "").normalize("NFC"),
          );
          const text = stripEmbeddedPageMarkers(
            cleanMitologicoBody(parsed.text ?? ""),
            [entry.startPage, entry.endPage],
          );

          return {
            aliases,
            canonicalTerm,
            originalLabel: originalLabel || null,
            text,
          };
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

export async function polishMitologicoText(
  text: string,
  options: MitologicoTextPolishOptions,
) {
  const apiKeys = getGeminiApiKeys();
  const portugueseHints = await findPortugueseMitologicoNameHints([
    options.canonicalTerm,
  ]);

  if (apiKeys.length === 0) {
    return null;
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: buildPolishPrompt(text, portugueseHints, options) }],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 7000,
      temperature: 0.05,
      topP: 0.4,
    },
  });
  const startedAt = Date.now();

  for (const model of getGeminiModels()) {
    for (const version of GEMINI_API_VERSIONS) {
      for (const apiKey of apiKeys) {
        if (Date.now() - startedAt >= MITOLOGICO_AI_TOTAL_BUDGET_MS) {
          return null;
        }

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
            signal: AbortSignal.timeout(MITOLOGICO_AI_REQUEST_TIMEOUT_MS),
          });

          if (!response.ok) {
            continue;
          }

          const payload = (await response.json()) as GeminiResponse;
          const rawText =
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "";

          if (!looksLikeUsefulMitologicoPolish(text, rawText)) {
            continue;
          }

          return cleanMitologicoPlainText(rawText);
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

export async function generateMitologicoEntry(
  requestedWord: string,
): Promise<MitologicoAiDirectEntry | null> {
  const apiKeys = getGeminiApiKeys();
  const portugueseHints = await findPortugueseMitologicoNameHints([requestedWord], 10);

  if (apiKeys.length === 0) {
    return null;
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: buildDirectMitologicoPrompt(requestedWord, portugueseHints),
          },
        ],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 1500,
      temperature: 0.15,
      topP: 0.5,
    },
  });
  const startedAt = Date.now();

  for (const model of getGeminiModels()) {
    for (const version of GEMINI_API_VERSIONS) {
      for (const apiKey of apiKeys) {
        if (Date.now() - startedAt >= MITOLOGICO_AI_TOTAL_BUDGET_MS) {
          return null;
        }

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
            signal: AbortSignal.timeout(MITOLOGICO_AI_REQUEST_TIMEOUT_MS),
          });

          if (!response.ok) {
            continue;
          }

          const payload = (await response.json()) as GeminiResponse;
          const rawText =
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "";
          const jsonText = extractJsonObject(rawText);

          if (!jsonText) {
            continue;
          }

          const parsed = JSON.parse(jsonText) as MitologicoAiPayload;

          if ((parsed.status ?? "").toLowerCase() === "not_found") {
            return null;
          }

          const canonicalTerm = normalizeInlineText(
            (parsed.canonicalTerm ?? "").normalize("NFC"),
          );
          const text = cleanMitologicoBody(parsed.text ?? "");

          if (!canonicalTerm || !text || text.length < 80) {
            continue;
          }

          return {
            aliases: normalizeAliasList(parsed.aliases ?? [], canonicalTerm),
            canonicalTerm,
            originalLabel: normalizeInlineText(
              (parsed.originalLabel ?? "").normalize("NFC"),
            ) || null,
            text,
          };
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}
