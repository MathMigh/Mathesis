import {
  loadPortugueseCorpusData,
  type PortugueseCorpusDocument,
  type PortugueseCorpusGenre,
  type PortugueseCorpusPayload,
} from "./portuguese-corpus-data";
import {
  escapeHtml,
  normalizeInlineText,
} from "./dictionary-utils";
import { buildPortugueseLookupCandidates } from "./portuguese-word-candidates";
import type {
  DictionarySourceResult,
  LookupContext,
  LookupSection,
} from "./lookup-types";

const LOCAL_RESULT_LIMIT = 80;
const LOCAL_RESULT_LIMIT_BY_GENRE = 40;
const LOCAL_RESULT_LIMIT_PER_WORK = 6;

type LocalCorpusOccurrence = {
  author: string;
  chunkId: number;
  document: PortugueseCorpusDocument;
  genre: PortugueseCorpusGenre;
  page: number;
  snippet: string;
  title: string;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function normalizeLookupKey(value: string) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "");
}

function stripCorpusOcrNoise(value: string) {
  return value
    .replace(/(\p{L})\d{1,4}[a-z]?\b/giu, "$1")
    .replace(/(\p{L})[•·]\b/gu, "$1")
    .replace(/\(\s*o\s+ui\/>\s+iria\b[^)\n]*/giu, "")
    .replace(/\b\d{1,3}\.\s+(?=\p{Lu})/gu, "")
    .replace(/\b\d{1,4}\s+(?=\p{Lu})/gu, "")
    .replace(/\bO\s+P[.'’]?\b/gu, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function capitalizeTitleStart(value: string) {
  return value.replace(/^\p{Ll}/u, (match) =>
    match.toLocaleUpperCase("pt-BR"),
  );
}

function toDisplayTitleCase(value: string) {
  const lowerParticles = new Set([
    "a",
    "ao",
    "aos",
    "as",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "em",
    "na",
    "nas",
    "no",
    "nos",
    "o",
    "os",
    "para",
    "por",
  ]);

  return value
    .split(/\s+/u)
    .map((word, index) => {
      const normalized = normalizeSearchText(word);

      if (index > 0 && lowerParticles.has(normalized)) {
        return normalized;
      }

      if (/^[ivxlcdm]+$/iu.test(word)) {
        return word.toUpperCase();
      }

      return word
        .split(/(-)/u)
        .map((part) =>
          part === "-"
            ? part
            : part.charAt(0).toLocaleUpperCase("pt-BR") +
              part.slice(1).toLocaleLowerCase("pt-BR"),
        )
        .join("");
    })
    .join(" ");
}

function cleanWorkTitle(value: string) {
  let cleaned = stripCorpusOcrNoise(value)
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/gu, "")
    .replace(/\b\d{4}\b/gu, "")
    .replace(/\bD\.?\s*$/u, "")
    .replace(/\b(?:Senhor|Senhora|Meu|Minha)\b\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();

  if (/^carta\b/iu.test(cleaned)) {
    cleaned = cleaned
      .replace(
        /\b(?:Excelent[ií]ssimo|Reverend[ií]ssimo|Seren[ií]ssimo|Muito\s+Reverendo|Senhor|Senhora|Meu|Minha)\b.*$/iu,
        "",
      )
      .replace(/\s+/gu, " ")
      .trim();
  }

  if (!cleaned) {
    return "";
  }

  const letters = cleaned.replace(/[^\p{L}]+/gu, "");
  const uppercaseLetters = letters.match(/\p{Lu}/gu)?.length ?? 0;

  if (letters.length > 0 && uppercaseLetters / letters.length > 0.75) {
    return toDisplayTitleCase(cleaned);
  }

  return capitalizeTitleStart(
    cleaned.replace(
      /\b(Ao|Aos|Da|Das|De|Do|Dos|E|Em|Na|Nas|No|Nos|O|Os|Para|Por)\b/gu,
      (match) => match.toLocaleLowerCase("pt-BR"),
    ),
  );
}

function isGenericDocumentTitle(value: string) {
  const normalized = normalizeSearchText(value);

  return (
    normalized.startsWith("obra completa") ||
    normalized.startsWith("obras completas") ||
    normalized.startsWith("poesia completa") ||
    normalized.startsWith("obra poetica completa") ||
    normalized.includes("antologia poetica")
  );
}

function isJunkWorkTitle(value: string) {
  const normalized = normalizeSearchText(value);
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  const letters = value.match(/\p{L}/gu) ?? [];
  const digits = value.match(/\d/gu) ?? [];
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const singleLetterTokens = tokens.filter((token) => token.length === 1).length;

  if (
    /\bobras?\s+g?ompletas?\b/u.test(normalized) ||
    normalized.startsWith("introducao")
  ) {
    return true;
  }

  return (
    normalized.length < 2 ||
    /\bcole[cç][cç]?[aã]o\b/u.test(normalized) ||
    /\bclassicos?\b/u.test(normalized) ||
    /\bpo\s*esi\b/u.test(normalized) ||
    /\bantologia\b/u.test(normalized) ||
    /\bvol\.?\b/u.test(normalized) ||
    /\bsa da costa\b/u.test(normalized) ||
    /\\\s*$/u.test(value) ||
    /^\W/u.test(value.trim()) ||
    /\bs\s*e\s*r\s*m?\s*a\s*o\b/u.test(normalized) ||
    /\bser\s+mao\b/u.test(normalized) ||
    normalized.startsWith("obra completa") ||
    normalized.startsWith("obras completas") ||
    normalized === "prefacio" ||
    normalized === "nota previa" ||
    normalized === "correccoes" ||
    normalized === "correcoes" ||
    normalized === "cecilia meireles" ||
    /\bvieira\s+(?:antecipa|afirma|diz|escreve|observa)\b/u.test(normalized) ||
    /\baqui se encontram\b/u.test(normalized) ||
    /\bna acusacao\b/u.test(normalized) ||
    /\bparecer do mundo\b/u.test(normalized) ||
    /\bimpossivel\b/u.test(normalized) ||
    /\bdiscursos?\b.*\bvida\b/u.test(normalized) ||
    /\b(de|da|do|das|dos|e|a|o|que|em|para)$/u.test(normalized) ||
    /^[ivxlcdm0-9 .-]+$/u.test(normalized) ||
    compact.length <= 3 ||
    tokens.length > 10 ||
    singleLetterTokens >= 3 ||
    (singleLetterTokens >= 2 && tokens.length <= 4) ||
    (digits.length > 0 && digits.length >= letters.length)
  );
}

function tidyWorkTitle(value: string) {
  return cleanWorkTitle(
    normalizeInlineText(value)
    .replace(/^[("'\u201c\u2018\s]+/u, "")
    .replace(/[)"'\u201d\u2019\s,.;:]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim(),
  );
}

function hasReliableTitlePrefix(value: string) {
  const normalized = normalizeSearchText(value);

  return /^(?:sermao|carta|parecer|representacao|relacao|resposta|discurso|voto|memorial|apologia|defesa|consulta|informacao|instrucao|oficio|proposta|razoes|auto|elegia|egloga|ode|soneto|cancao)\b/u.test(
    normalized,
  );
}

function extractQuotedWorkTitle(value: string) {
  const quotedMatch = value.match(/[("'\u201c\u2018]\s*([^"'\u201d\u2019),;:.]{3,90})/u);
  const quoted = tidyWorkTitle(quotedMatch?.[1] ?? "");

  if (quoted && hasReliableTitlePrefix(quoted) && !isJunkWorkTitle(quoted)) {
    return quoted;
  }

  return null;
}

function extractLeadingFormalWorkTitle(value: string) {
  const trimmed = tidyWorkTitle(value);
  const match = trimmed.match(
    /^(serm[aã]o\s+(?:[ivxlcdm]+|\d+|de|da|do|das|dos)\b[^,;:.]{0,70}|carta\b[^,;:.]{3,70}|parecer\b[^,;:.]{3,70}|representa[cç][aã]o\b[^,;:.]{3,70}|discurso\b[^,;:.]{3,70})/iu,
  );
  const title = tidyWorkTitle(match?.[1] ?? "");

  if (title && hasReliableTitlePrefix(title) && !isJunkWorkTitle(title)) {
    return title;
  }

  return null;
}

function normalizeTitleIdentity(value: string) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "");
}

function extractReliableWorkTitle(
  workTitle: string | undefined,
  document: PortugueseCorpusDocument,
) {
  const candidate = tidyWorkTitle(workTitle ?? "");

  if (!candidate) {
    return null;
  }

  if (
    normalizeTitleIdentity(candidate) === normalizeTitleIdentity(document.author) ||
    normalizeTitleIdentity(candidate) === normalizeTitleIdentity(document.title) ||
    normalizeTitleIdentity(document.author).includes(normalizeTitleIdentity(candidate)) ||
    normalizeTitleIdentity(candidate).includes("antoniovieira")
  ) {
    return null;
  }

  return (
    extractQuotedWorkTitle(candidate) ??
    extractLeadingFormalWorkTitle(candidate) ??
    (!isJunkWorkTitle(candidate) ? candidate : null)
  );
}

function isNonLiteraryWorkTitle(value: string | undefined) {
  const normalized = normalizeSearchText(value ?? "");
  const compact = normalized.replace(/[^a-z0-9]+/g, " ").trim();

  return [
    "a frustracao das esperancas",
    "a polissemica",
    "breve biografia da organizadora",
    "conteudos os textos da vida",
    "introducao",
    "nota do autor",
    "nota do editor",
    "nota do organizador",
    "nota previa",
    "o discurso",
    "iii poesia e prosa",
    "ill poesia e prosa",
  ].includes(compact) ||
    compact.includes("poesia completa") ||
    compact.includes("obra completa") ||
    compact.includes("obras completas") ||
    compact.startsWith("introducao ") ||
    compact.startsWith("prefacio ") ||
    compact.startsWith("fortuna critica") ||
    compact.startsWith("conteudos ") ||
    compact.startsWith("domingos leitao") ||
    compact.startsWith("estevao de brito") ||
    compact.startsWith("jose cardoso notario") ||
    compact.startsWith("m bispo") ||
    compact.startsWith("breve biografia");
}

function displayTitleForOccurrence(
  workTitle: string | undefined,
  document: PortugueseCorpusDocument,
) {
  const candidate = extractReliableWorkTitle(workTitle, document);

  if (candidate) {
    return candidate;
  }

  if (
    !isGenericDocumentTitle(document.title) &&
    normalizeTitleIdentity(document.title) !== normalizeTitleIdentity(document.author)
  ) {
    return cleanWorkTitle(document.title);
  }

  if (normalizeSearchText(document.author).includes("vieira")) {
    return "Trecho de Vieira";
  }

  if (normalizeSearchText(document.author).includes("camoes")) {
    return "Lírica";
  }

  return "Trecho do corpus";
}

function uniqueValues<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function buildCandidateKeys(word: string) {
  return uniqueValues(
    buildPortugueseLookupCandidates(word).map(normalizeLookupKey),
  ).filter(Boolean);
}

function buildCandidateWords(word: string) {
  return uniqueValues([
    normalizeInlineText(word.normalize("NFC")),
    ...buildPortugueseLookupCandidates(word),
  ]).filter(Boolean);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsRequestedWord(value: string, requestedWord: string) {
  const normalizedValue = normalizeSearchText(value);
  const normalizedWord = normalizeSearchText(requestedWord);
  const expression = new RegExp(
    `(^|[^\\p{L}\\p{M}])${escapeRegExp(normalizedWord)}([^\\p{L}\\p{M}]|$)`,
    "u",
  );

  return expression.test(normalizedValue);
}

function containsAnyRequestedWord(value: string, requestedWords: string[]) {
  return requestedWords.some((requestedWord) =>
    containsRequestedWord(value, requestedWord),
  );
}

function isStandaloneCorpusHeadingLine(value: string) {
  const trimmed = normalizeInlineText(value).trim();
  const normalized = normalizeSearchText(trimmed);
  const letters = trimmed.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = trimmed.match(/\p{Lu}/gu) ?? [];

  if (trimmed.length < 3 || trimmed.length > 54 || letters.length < 3) {
    return false;
  }

  return (
    uppercaseLetters.length / letters.length > 0.72 ||
    [
      "barcarola",
      "filodemo",
      "idilios e cantatas",
      "idllios e cantatas",
      "sadino",
      "tagano",
    ].includes(normalized)
  );
}

function isDetachedCorpusCueLine(value: string) {
  const trimmed = normalizeInlineText(value).trim();
  const words = trimmed.split(/\s+/u).filter(Boolean);

  if (isStandaloneCorpusHeadingLine(trimmed)) {
    return true;
  }

  if (
    trimmed.length < 3 ||
    trimmed.length > 42 ||
    words.length > 4 ||
    /[.!?,;:]/u.test(trimmed)
  ) {
    return false;
  }

  return words.every((word) => /^\p{Lu}/u.test(word));
}

function trimDetachedCueLines(lines: string[], requestedWords: string[]) {
  const selected = [...lines];

  while (
    selected.length > 1 &&
    !containsAnyRequestedWord(selected[0] ?? "", requestedWords) &&
    isDetachedCorpusCueLine(selected[0] ?? "")
  ) {
    selected.shift();
  }

  while (
    selected.length > 1 &&
    !containsAnyRequestedWord(selected[selected.length - 1] ?? "", requestedWords) &&
    isDetachedCorpusCueLine(selected[selected.length - 1] ?? "")
  ) {
    selected.pop();
  }

  return selected;
}

function isCorpusSnippetLikelyJunk(value: string) {
  const normalized = normalizeSearchText(value).replace(/\s+/gu, " ");

  return (
    /[<>/]{2,}/u.test(value) ||
    /\.{4,}/u.test(value) ||
    /\bibid\b/u.test(normalized) ||
    /\bdicionario de (?:filosofia|losoa)\b/u.test(normalized) ||
    /\bp[aá]g(?:ina)?\b/u.test(normalized) ||
    /\beds?\b/u.test(normalized) ||
    /\bms\b/u.test(normalized) ||
    /\bmanuscrito\b/u.test(normalized) ||
    /\bprefacio\b/u.test(normalized) ||
    /\bescorco biografico\b/u.test(normalized) ||
    /\bbiografia de\b/u.test(normalized) ||
    /\barvore genealogica\b/u.test(normalized) ||
    /\bcontemporaneos do poeta\b/u.test(normalized) ||
    /\bconfrades do parnaso\b/u.test(normalized) ||
    /\bcervantes\b/u.test(normalized) ||
    /\bdiogo de couto\b/u.test(normalized) ||
    /\blessing\b/u.test(normalized) ||
    /\beste poema\b/u.test(normalized) ||
    /\bpoeta[- ]origem\b/u.test(normalized) ||
    /\bpessoa[- ]poetas?\b/u.test(normalized) ||
    /\bverso seguinte\b/u.test(normalized) ||
    /\bpublicado in\b/u.test(normalized) ||
    /\bcf antologia\b/u.test(normalized) ||
    /\bpessoa f\b/u.test(normalized) ||
    /\bdicionarios gerais\b/u.test(normalized) ||
    /\batitude da imprensa\b/u.test(normalized) ||
    /\bdois primeiros poemas\b/u.test(normalized) ||
    /\bmensagens semelhantes\b/u.test(normalized) ||
    /\bcarta a casais monteiro\b/u.test(normalized) ||
    /\bmestre e discipulo\b/u.test(normalized) ||
    /\bpoema se fecha\b/u.test(normalized) ||
    /\btrata se de um texto\b/u.test(normalized) ||
    /\bmelhor compreensao\b/u.test(normalized) ||
    /\bproducao poetica\b/u.test(normalized) ||
    /\brealidade literaria\b/u.test(normalized) ||
    /\bmodernismo brasileiro\b/u.test(normalized) ||
    /\bgeracao modernista\b/u.test(normalized) ||
    /\bpoetica do autor\b/u.test(normalized) ||
    /\bprincipais linhas de forca\b/u.test(normalized) ||
    /\bcomo temos visto e revisto\b/u.test(normalized) ||
    /\blivro\s+como\b/u.test(normalized) ||
    /\bdesempenha\s+nessa\s+obra\b/u.test(normalized) ||
    /\bverso novo\b/u.test(normalized) ||
    /\bdecassilabo\b/u.test(normalized) ||
    /\bredondilha\b/u.test(normalized) ||
    /\bestudo da sonoridade\b/u.test(normalized) ||
    /\bprofessora de lingua portuguesa\b/u.test(normalized) ||
    /\bensino fundamental\b/u.test(normalized) ||
    /\broman jakobson\b/u.test(normalized) ||
    /\bescrevi esta carta\b/u.test(normalized) ||
    /\brelendo a\b/u.test(normalized) ||
    /\btexto de um poema\b/u.test(normalized) ||
    /\bpalavras de uma cancao\b/u.test(normalized) ||
    /\bnegro spirituals\b/u.test(normalized) ||
    /\bcunho popular ou erudito\b/u.test(normalized) ||
    /\blinguagem profunda de uma raca\b/u.test(normalized) ||
    /\bcomplexidade da condicao humana\b/u.test(normalized) ||
    /\bpara terminar prefiro\b/u.test(normalized) ||
    /\beste livro e\b/u.test(normalized) ||
    /\bexegetas?\b/u.test(normalized) ||
    /\bcamonianos?\b/u.test(normalized) ||
    /\besta hipotese\b/u.test(normalized) ||
    /\boutros problemas\b/u.test(normalized) ||
    /\bao longo de sua .* obra\b/u.test(normalized) ||
    /\bnota do (?:organizador|editor|tradutor)\b/u.test(normalized) ||
    /\ba partir da .*protagonistas\b/u.test(normalized) ||
    /\bpor vezes beirar o barroco\b/u.test(normalized) ||
    /\bestao aqui\b/u.test(normalized) ||
    /\ba admiracao por pessoa\b/u.test(normalized) ||
    /\bsa carneiro\b/u.test(normalized) ||
    /\borg\.\s*[a-z]/u.test(normalized) ||
    /\bantologia de antologias\b/u.test(normalized) ||
    /\bpoetas brasileiros\b/u.test(normalized) ||
    /\binstituto cultural itau\b/u.test(normalized) ||
    /\bcadernos poesia brasileira\b/u.test(normalized) ||
    /\bpedras de toque da poesia brasileira\b/u.test(normalized) ||
    /\bvol\.\s*[ivxlcdm0-9]+\b/u.test(normalized) ||
    /\bcartas dele recebidas\b/u.test(normalized) ||
    /\bcomo visto ambos se falam\b/u.test(normalized) ||
    /\bde uma conversa com maximiano campos\b/u.test(normalized) ||
    /\btransformando se\b/u.test(normalized) ||
    /\bs o rriso\b/u.test(normalized) ||
    /\bum m ar\b/u.test(normalized) ||
    /\bui\s+iria\b/u.test(normalized) ||
    /\bclarividencia e o sentido prospetivo\b/u.test(normalized) ||
    /\brefletido nestes escritos\b/u.test(normalized) ||
    /\bo trabalho era arduo\b/u.test(normalized) ||
    /\bcomposicoes deste grande homem\b/u.test(normalized) ||
    /\baprovacao do undecimo\b/u.test(normalized) ||
    /\bgenio lusitano\b/u.test(normalized) ||
    /\buniversalidade\b.*\bfronteiras\b/u.test(normalized) ||
    /\bregularmente lembrada\b/u.test(normalized) ||
    /\bhemiplegico\b/u.test(normalized) ||
    /\bcancioneiro geral\b/u.test(normalized) ||
    /\bpetrarca\b/u.test(normalized) ||
    /\bvid\b/u.test(normalized) ||
    /\btenca\b/u.test(normalized) ||
    /\bcoisas da india\b/u.test(normalized) ||
    /\btesouro do luso\b/u.test(normalized) ||
    /\bmonarca perante\b/u.test(normalized) ||
    /\bentenda se\b/u.test(normalized) ||
    /\bapesar das aparencias\b/u.test(normalized)
  );
}

function cleanPoetryLine(value: string) {
  return stripCorpusOcrNoise(
    value
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/^\d+[.)]?\s+/u, "")
      .replace(/^[iI]\s+(?=\p{Ll})/u, "")
      .replace(/^(?:ro|r0)\s+(?=\p{Lu})/iu, "")
      .replace(/\b\d{1,3}\.\s+(?=\p{Lu})/gu, "")
      .trim(),
  );
}

function isPoetryMetadataLine(value: string) {
  const normalized = normalizeSearchText(value);

  return (
    /\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*\b\d{4}\b/u.test(
      normalized,
    ) ||
    /^[\p{Lu}\p{M} .,'-]{4,}\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/u.test(value) ||
    /^lisboa\b.*\b\d{4}\b/u.test(normalized)
  );
}

function normalizeSnippetText(value: string, preserveLineBreaks: boolean) {
  if (!preserveLineBreaks) {
    return stripCorpusOcrNoise(normalizeInlineText(value));
  }

  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanPoetryLine)
    .filter((line) => {
      const normalized = normalizeSearchText(line);
      const letters = line.match(/\p{L}/gu) ?? [];

      return (
        letters.length > 2 &&
        !/^([ivxlcdm]+|i[o0]|[o0]?\d+)$/u.test(normalized) &&
        !normalized.includes("obras completas") &&
        !normalized.includes("coleccao") &&
        !normalized.includes("colecao") &&
        !normalized.includes("classicos sa da costa") &&
        !isStandaloneCorpusHeadingLine(line)
      );
    })
    .filter((line) => !isPoetryMetadataLine(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isPoetryContextLikelyEditorialProse(value: string) {
  const normalized = normalizeSearchText(value).replace(/\s+/gu, " ");

  if (
    /\b(?:p\.?\s*s\.?|post scriptum)\b/u.test(normalized) ||
    /\bescrevi esta carta\b/u.test(normalized) ||
    /\brelendo a\b/u.test(normalized) ||
    /\btexto de um poema\b/u.test(normalized) ||
    /\bpalavras de uma cancao\b/u.test(normalized) ||
    /\bnegro spirituals\b/u.test(normalized) ||
    /\bcunho popular ou erudito\b/u.test(normalized) ||
    /\blinguagem profunda de uma raca\b/u.test(normalized) ||
    /\bcomplexidade da condicao humana\b/u.test(normalized)
  ) {
    return true;
  }

  const lines = normalizeSnippetText(value, true).split("\n").filter(Boolean);

  if (lines.length < 4) {
    return false;
  }

  const longLines = lines.filter((line) => line.length > 92).length;
  const sentenceLikeLines = lines.filter((line) => /[.!?;:]/u.test(line)).length;

  return longLines >= Math.ceil(lines.length * 0.55) && sentenceLikeLines >= 3;
}

function wrapPoetryLine(line: string) {
  return line;
}

function restorePoetryLineBreaks(value: string) {
  const normalized = normalizeSnippetText(value, true);

  if (normalized || normalized === "") {
    return normalized;
  }

  const punctuated = normalized
    .split("\n")
    .filter(Boolean)
    .flatMap((line) =>
      line
        .replace(/([;.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/gu, "$1\n")
        .split("\n"),
    );

  return punctuated
    .flatMap((line) => wrapPoetryLine(line.trim()).split("\n"))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function findNormalizedWordPosition(value: string, requestedWords: string[]) {
  const normalizedValue = normalizeSearchText(value);
  const rankedWords = uniqueValues(requestedWords)
    .map((requestedWord) => ({
      original: requestedWord,
      normalized: normalizeSearchText(requestedWord),
    }))
    .filter((entry) => entry.normalized)
    .sort((left, right) => right.normalized.length - left.normalized.length);

  for (const entry of rankedWords) {
    const expression = new RegExp(
      `(^|[^\\p{L}\\p{M}])${escapeRegExp(entry.normalized)}(?=[^\\p{L}\\p{M}]|$)`,
      "u",
    );
    const match = normalizedValue.match(expression);

    if (match?.index !== undefined) {
      return {
        index: match.index + (match[1]?.length ?? 0),
        length: entry.normalized.length,
        word: entry.original,
      };
    }
  }

  return null;
}

function isSentenceBoundary(character: string) {
  return /[.!?]/u.test(character);
}

function trimSentenceStart(value: string, start: number) {
  let next = start;

  while (next < value.length && /[\s"'“”‘’»«()[\]-]/u.test(value[next] ?? "")) {
    next += 1;
  }

  return next;
}

function trimSentenceEnd(value: string, end: number) {
  let next = end;

  while (next < value.length && /["'”’»)\]]/u.test(value[next] ?? "")) {
    next += 1;
  }

  return next;
}

function findSentenceStart(value: string, position: number) {
  for (let index = Math.max(0, position - 1); index >= 0; index -= 1) {
    if (isSentenceBoundary(value[index] ?? "")) {
      return trimSentenceStart(value, index + 1);
    }
  }

  return 0;
}

function findSentenceEnd(value: string, position: number) {
  for (let index = Math.max(0, position); index < value.length; index += 1) {
    if (isSentenceBoundary(value[index] ?? "")) {
      return trimSentenceEnd(value, index + 1);
    }
  }

  return value.length;
}

function cropOversizedSentence(
  compact: string,
  position: number,
  wordLength: number,
  maxLength: number,
) {
  const radius = Math.floor(maxLength / 2);
  let start = Math.max(0, position - radius);
  let end = Math.min(compact.length, position + wordLength + radius);

  if (start > 0) {
    const nextBoundary = compact.slice(start, position).search(/[,;:]\s+/u);

    if (nextBoundary > -1) {
      start += nextBoundary + 1;
    } else {
      const nextSpace = compact.indexOf(" ", start);
      start = nextSpace > -1 && nextSpace < position ? nextSpace + 1 : start;
    }
  }

  if (end < compact.length) {
    const boundaryCandidates = [
      compact.indexOf(". ", position + wordLength),
      compact.indexOf("; ", position + wordLength),
      compact.indexOf(", ", position + wordLength),
    ].filter((candidate) => candidate > position && candidate < end);

    if (boundaryCandidates.length > 0) {
      end = Math.max(...boundaryCandidates) + 1;
    } else {
      const previousSpace = compact.lastIndexOf(" ", end);
      end = previousSpace > position ? previousSpace : end;
    }
  }

  return `${start > 0 ? "... " : ""}${compact.slice(start, end).trim()}${
    end < compact.length ? " ..." : ""
  }`;
}

function cropProseAroundWord(
  value: string,
  requestedWords: string[],
  maxLength = 1100,
) {
  const compact = normalizeSnippetText(value, false);
  const match = findNormalizedWordPosition(compact, requestedWords);

  if (!match) {
    const prefix = compact.slice(0, maxLength);
    const lastSpace = prefix.lastIndexOf(" ");
    return `${prefix.slice(0, lastSpace > -1 ? lastSpace : prefix.length)}...`;
  }

  const start = findSentenceStart(compact, match.index);
  const end = findSentenceEnd(compact, match.index + match.length);

  if (end - start > maxLength) {
    return cropOversizedSentence(compact, match.index, match.length, maxLength);
  }

  return stripCorpusOcrNoise(compact.slice(start, end).trim());
}

function cropPoetryAroundWord(
  value: string,
  requestedWords: string[],
  maxLength = 1300,
) {
  const normalized = normalizeSnippetText(value, true);
  const lines = normalized.split("\n").filter(Boolean);
  const matchIndex = lines.findIndex((line) =>
    containsAnyRequestedWord(line, requestedWords),
  );

  if (matchIndex === -1) {
    return restorePoetryLineBreaks(cropProseAroundWord(value, requestedWords, maxLength));
  }

  let start = matchIndex;
  let end = matchIndex + 1;

  for (let index = matchIndex - 1; index >= 0; index -= 1) {
    start = index;

    if (/[.!?…]\s*["')\]]?\s*$/u.test(lines[index] ?? "")) {
      start = index + 1;
      break;
    }
  }

  for (let index = matchIndex; index < lines.length; index += 1) {
    end = index + 1;

    if (/[.!?…]\s*["')\]]?\s*$/u.test(lines[index] ?? "")) {
      break;
    }
  }

  if (end <= start) {
    start = Math.max(0, matchIndex - 2);
    end = Math.min(lines.length, matchIndex + 5);
  }

  let selectedLines = trimDetachedCueLines(lines.slice(start, end), requestedWords);
  let selected = selectedLines.join("\n");

  while (selected.length > maxLength && end - start > 5) {
    if (matchIndex - start > end - matchIndex) {
      start += 1;
    } else {
      end -= 1;
    }

    selectedLines = trimDetachedCueLines(lines.slice(start, end), requestedWords);
    selected = selectedLines.join("\n");
  }

  while (/[,;:]\s*$/u.test(selected) && end < lines.length) {
    end += 1;
    selectedLines = trimDetachedCueLines(lines.slice(start, end), requestedWords);
    selected = selectedLines.join("\n");

    if (/[.!?…]\s*["')\]]?\s*$/u.test(lines[end - 1] ?? "")) {
      break;
    }
  }

  return selected.trim();
}

function stripAuthorSignature(value: string, author: string) {
  let cleaned = value;
  const normalizedAuthor = normalizeSearchText(author);

  if (normalizedAuthor.includes("antonio vieira")) {
    cleaned = cleaned
      .replace(
        /\s*(?:Roma,\s*\d{1,2}\s+de\s+[^.]{3,40}\.\s*)?(?:Capel[aã]o\s+e\s+criado\s+de\s+Vossa\s+Senhoria\s*)?ANT[ÓO]NIO\s+VIEIRA\s*$/iu,
        "",
      )
      .trim();
  }

  return cleaned;
}

function cleanupOccurrenceSnippet(
  value: string,
  document: PortugueseCorpusDocument,
) {
  return stripCorpusOcrNoise(stripAuthorSignature(value, document.author))
    .replace(/\s+\.\.\.$/u, " ...")
    .trim();
}

function isDanglingCorpusSnippet(value: string) {
  return /[,;:]\s*$/u.test(value.trim());
}

function cropTextAroundWord(
  value: string,
  requestedWords: string[],
  maxLength = 1100,
  preserveLineBreaks = false,
) {
  return preserveLineBreaks
    ? cropPoetryAroundWord(value, requestedWords, maxLength)
    : cropProseAroundWord(value, requestedWords, maxLength);
}

function chunkContextMatches(
  baseChunk: PortugueseCorpusPayload["chunks"][number],
  candidateChunk: PortugueseCorpusPayload["chunks"][number] | undefined,
) {
  if (!candidateChunk) {
    return false;
  }

  const [baseDocumentId, baseGenre, basePage, , baseWorkTitle] = baseChunk;
  const [candidateDocumentId, candidateGenre, candidatePage, , candidateWorkTitle] =
    candidateChunk;

  return (
    baseDocumentId === candidateDocumentId &&
    baseGenre === candidateGenre &&
    Math.abs(basePage - candidatePage) <= 1 &&
    (baseWorkTitle ?? "") === (candidateWorkTitle ?? "")
  );
}

function buildExpandedChunkText(
  data: PortugueseCorpusPayload,
  chunkId: number,
  preserveLineBreaks = false,
  maxContextLength = 4600,
) {
  const chunk = data.chunks[chunkId];

  if (!chunk) {
    return "";
  }

  const pieces = [chunk[3]];
  let totalLength = chunk[3].length;

  for (let index = chunkId - 1; index >= Math.max(0, chunkId - 8); index -= 1) {
    const previousChunk = data.chunks[index];

    if (!chunkContextMatches(chunk, previousChunk)) {
      break;
    }

    pieces.unshift(previousChunk[3]);
    totalLength += previousChunk[3].length;

    if (totalLength >= maxContextLength) {
      break;
    }
  }

  for (
    let index = chunkId + 1;
    index <= Math.min(data.chunks.length - 1, chunkId + 8);
    index += 1
  ) {
    const nextChunk = data.chunks[index];

    if (!chunkContextMatches(chunk, nextChunk)) {
      break;
    }

    pieces.push(nextChunk[3]);
    totalLength += nextChunk[3].length;

    if (totalLength >= maxContextLength) {
      break;
    }
  }

  return pieces.join(preserveLineBreaks ? "\n" : " ");
}

function highlightWord(text: string, requestedWord: string) {
  const escapedText = escapeHtml(text);
  const candidateWords = buildCandidateWords(requestedWord)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);

  if (candidateWords.length === 0) {
    return escapedText;
  }

  const expression = new RegExp(
    `(^|[^\\p{L}\\p{M}])(${candidateWords.join("|")})(?=[^\\p{L}\\p{M}]|$)`,
    "giu",
  );

  return escapedText.replace(expression, "$1<mark>$2</mark>");
}

function documentContextScore(document: PortugueseCorpusDocument, context?: LookupContext) {
  const contextAuthor = normalizeSearchText(context?.documentAuthor ?? "");
  const contextTitle = normalizeSearchText(context?.documentTitle ?? "");
  const contextLabel = normalizeSearchText(context?.documentLabel ?? "");
  const documentAuthor = normalizeSearchText(document.author);
  const documentTitle = normalizeSearchText(document.title);
  const documentSource = normalizeSearchText(document.sourcePdfName);
  let score = 0;

  if (
    contextTitle &&
    (documentTitle.includes(contextTitle) || contextTitle.includes(documentTitle))
  ) {
    score += 6;
  }

  if (contextLabel && documentSource.includes(contextLabel)) {
    score += 4;
  }

  if (contextAuthor && documentAuthor.includes(contextAuthor)) {
    score += 2;
  }

  return score;
}

function authorPriority(author: string) {
  const normalizedAuthor = normalizeSearchText(author);
  const priorities = [
    "padre antonio vieira",
    "machado de assis",
    "camoes",
    "eca de queiroz",
    "joao guimaraes rosa",
    "jose de alencar",
    "fernando pessoa",
    "carlos drummond de andrade",
    "cecilia meireles",
    "camilo castelo branco",
  ];
  const index = priorities.findIndex((priority) => normalizedAuthor.includes(priority));
  return index === -1 ? priorities.length + 1 : index;
}

function collectChunkIds(
  data: PortugueseCorpusPayload,
  candidateKeys: string[],
  genre?: PortugueseCorpusGenre,
) {
  const ids: number[] = [];

  for (const key of candidateKeys) {
    const groups = data.terms[key];

    if (!groups) {
      continue;
    }

    if (genre) {
      ids.push(...(groups[genre] ?? []));
      continue;
    }

    ids.push(...(groups.poesia ?? []), ...(groups.prosa ?? []));
  }

  return uniqueValues(ids);
}

function collectContextChunkIds(
  data: PortugueseCorpusPayload,
  requestedWords: string[],
  context?: LookupContext,
  genre?: PortugueseCorpusGenre,
) {
  if (!context?.documentAuthor && !context?.documentTitle && !context?.documentLabel) {
    return [];
  }

  const rankedDocuments = data.documents
    .map((document) => ({
      document,
      score: documentContextScore(document, context),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  const strongestScore = rankedDocuments[0]?.score ?? 0;

  if (strongestScore === 0) {
    return [];
  }

  const documentIds = new Set(
    rankedDocuments
      .filter((entry) => entry.score === strongestScore)
      .map((entry) => entry.document.id),
  );
  const ids: number[] = [];

  data.chunks.forEach((chunk, chunkId) => {
    const [documentId, chunkGenre, , text] = chunk;

    if (!documentIds.has(documentId)) {
      return;
    }

    if (genre && chunkGenre !== genre) {
      return;
    }

    if (!containsAnyRequestedWord(text, requestedWords)) {
      return;
    }

    ids.push(chunkId);
  });

  return ids;
}

function rankCandidateChunkIds(
  data: PortugueseCorpusPayload,
  ids: number[],
  context?: LookupContext,
  limit = 320,
) {
  return uniqueValues(ids)
    .map((id) => {
      const chunk = data.chunks[id];

      if (!chunk) {
        return null;
      }

      const document = data.documents[chunk[0]];

      if (!document) {
        return null;
      }

      return {
        authorRank: authorPriority(document.author),
        contextScore: documentContextScore(document, context),
        documentTitlePenalty: isGenericDocumentTitle(document.title) ? 1 : 0,
        id,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        authorRank: number;
        contextScore: number;
        documentTitlePenalty: number;
        id: number;
      } => Boolean(entry),
    )
    .sort(
      (left, right) =>
        right.contextScore - left.contextScore ||
        left.authorRank - right.authorRank ||
        left.documentTitlePenalty - right.documentTitlePenalty ||
        left.id - right.id,
    )
    .slice(0, limit)
    .map((entry) => entry.id);
}

function shouldPreferCorpusCanonicalAlternative(requestedWord: string) {
  const normalized = normalizeSearchText(requestedWord);

  return (
    (normalized.endsWith("s") && normalized.length > 3) ||
    /(ei|aste|ou|amos|aram|eram|iram|ava|avam|ia|iam|asse|esse|isse|ara|aras|arao|era|eras|erao|ira|iras|irao|aria|arias|ariam|eria|erias|eriam|iria|irias|iriam|ize|izes|izou|izava)$/u.test(
      normalized,
    )
  );
}

function resolveCorpusCanonicalWord(
  data: PortugueseCorpusPayload,
  requestedWord: string,
  candidateWords: string[],
) {
  const hasCorpusEntries = (candidate: string) => {
    const key = normalizeLookupKey(candidate);
    const groups = data.terms[key];

    return Boolean(groups?.poesia?.length || groups?.prosa?.length);
  };
  const exactCandidate = candidateWords.find(
    (candidate) =>
      normalizeSearchText(candidate) === normalizeSearchText(requestedWord) &&
      hasCorpusEntries(candidate),
  );

  if (!exactCandidate || shouldPreferCorpusCanonicalAlternative(requestedWord)) {
    for (const candidate of candidateWords) {
      if (
        normalizeSearchText(candidate) !== normalizeSearchText(requestedWord) &&
        hasCorpusEntries(candidate)
      ) {
        return candidate;
      }
    }
  }

  return exactCandidate ?? requestedWord;
}

function buildOccurrences(
  data: PortugueseCorpusPayload,
  ids: number[],
  requestedWords: string[],
  context?: LookupContext,
  limit = LOCAL_RESULT_LIMIT,
) {
  const sortedOccurrences = ids
    .map((id) => {
      const chunk = data.chunks[id];

      if (!chunk) {
        return null;
      }

      const [documentId, genre, page, , workTitle] = chunk;
      const document = data.documents[documentId];

      if (!document) {
        return null;
      }

      if (isNonLiteraryWorkTitle(workTitle)) {
        return null;
      }

      const isPoetry = genre === "poesia";
      const expandedText = buildExpandedChunkText(data, id, isPoetry);

      if (isPoetry && isPoetryContextLikelyEditorialProse(expandedText)) {
        return null;
      }

      if (isCorpusSnippetLikelyJunk(expandedText)) {
        return null;
      }

      const snippet = cleanupOccurrenceSnippet(
        cropTextAroundWord(
          expandedText,
          requestedWords,
          isPoetry ? 1100 : 900,
          isPoetry,
        ),
        document,
      );

      if (!containsAnyRequestedWord(snippet, requestedWords)) {
        return null;
      }

      if (isDanglingCorpusSnippet(snippet)) {
        return null;
      }

      if (isCorpusSnippetLikelyJunk(snippet)) {
        return null;
      }

      const title = displayTitleForOccurrence(workTitle, document);

      if (
        normalizeSearchText(document.author).includes("vieira") &&
        title === "Trecho de Vieira"
      ) {
        return null;
      }

      return {
        author: document.author,
        chunkId: id,
        document,
        genre,
        page,
        snippet,
        title,
      } satisfies LocalCorpusOccurrence;
    })
    .filter((entry): entry is LocalCorpusOccurrence => Boolean(entry))
    .sort((left, right) => {
      const leftContext = documentContextScore(left.document, context);
      const rightContext = documentContextScore(right.document, context);

      if (leftContext !== rightContext) {
        return rightContext - leftContext;
      }

      return (
        authorPriority(left.author) - authorPriority(right.author) ||
        left.author.localeCompare(right.author, "pt-BR") ||
        left.title.localeCompare(right.title, "pt-BR") ||
        left.page - right.page
      );
    });

  return selectDiverseOccurrences(sortedOccurrences, limit);
}

function mergeOccurrenceLists(...lists: LocalCorpusOccurrence[][]) {
  const seen = new Set<string>();
  const merged: LocalCorpusOccurrence[] = [];

  for (const list of lists) {
    for (const occurrence of list) {
      const key = normalizeLookupKey(occurrence.snippet).slice(0, 320);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(occurrence);
    }
  }

  return merged;
}

function selectDiverseOccurrences(
  occurrences: LocalCorpusOccurrence[],
  limit: number,
) {
  const selected: LocalCorpusOccurrence[] = [];
  const deferred: LocalCorpusOccurrence[] = [];
  const countsByWork = new Map<string, number>();
  const seenSnippets = new Set<string>();

  for (const occurrence of occurrences) {
    const key = `${occurrence.author}|${occurrence.title}|${occurrence.genre}`;
    const snippetKey = normalizeLookupKey(occurrence.snippet).slice(0, 320);
    const authorSnippetKey = `${occurrence.author}|${snippetKey}`;
    const count = countsByWork.get(key) ?? 0;

    if (seenSnippets.has(snippetKey) || seenSnippets.has(authorSnippetKey)) {
      continue;
    }

    seenSnippets.add(snippetKey);
    seenSnippets.add(authorSnippetKey);

    if (count < LOCAL_RESULT_LIMIT_PER_WORK) {
      selected.push(occurrence);
      countsByWork.set(key, count + 1);
    } else {
      deferred.push(occurrence);
    }

    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const occurrence of deferred) {
    selected.push(occurrence);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function genreLabel(genre: PortugueseCorpusGenre) {
  return genre === "poesia" ? "Poesia" : "Prosa";
}

function buildOccurrenceSection(
  label: string,
  occurrences: LocalCorpusOccurrence[],
  requestedWord: string,
): LookupSection | null {
  if (occurrences.length === 0) {
    return null;
  }

  const html = occurrences
    .map(
      (entry) => `
        <article class="lookupEntry corpusHitCard">
          <div class="corpusHitMetaRow">
            <div>
              <p class="lookupEntryMeta">${escapeHtml(entry.author)} · p. ${entry.page}</p>
              <p class="lookupEntryTitle">${escapeHtml(entry.title)}</p>
            </div>
            <div class="corpusTagCluster">
              <span class="corpusGenreTag">${genreLabel(entry.genre)}</span>
            </div>
          </div>
          <blockquote class="corpusSnippet ${
            entry.genre === "poesia" ? "corpusSnippetPoetry" : ""
          }">${highlightWord(
            entry.snippet,
            requestedWord,
          )}</blockquote>
        </article>
      `,
    )
    .join("");

  const text = occurrences
    .map(
      (entry) =>
        `${entry.author} - ${entry.title} (${genreLabel(entry.genre)}, p. ${
          entry.page
        })\n${entry.snippet}`,
    )
    .join("\n\n");

  return {
    html,
    label,
    text,
  };
}

function buildAcervoSection(data: PortugueseCorpusPayload): LookupSection {
  const authors = uniqueValues(
    data.documents.map((document) => document.author).sort((left, right) =>
      left.localeCompare(right, "pt-BR"),
    ),
  );
  const poetryCount = data.metadata.genreCounts.poesia ?? 0;
  const proseCount = data.metadata.genreCounts.prosa ?? 0;

  const html = `
    <article class="analogCategoryCard">
      <h4 class="analogCategoryTitle">Corpus local em português</h4>
      <p class="lookupEntryMeta">
        ${data.metadata.termCount.toLocaleString("pt-BR")} formas · ${poetryCount.toLocaleString(
          "pt-BR",
        )} trechos de poesia · ${proseCount.toLocaleString("pt-BR")} trechos de prosa.
      </p>
      <div class="analogPillList">
        ${authors
          .map(
            (author) =>
              `<span class="lookupPill lookupPillAnalogico lookupPillStatic">${escapeHtml(
                author,
              )}</span>`,
          )
          .join("")}
      </div>
    </article>
  `;

  return {
    html,
    label: "Acervo",
    text: `Corpus local em português\nAutores: ${authors.join(
      " · ",
    )}`,
  };
}

export async function lookupLocalPortugueseCorpus(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult | null> {
  const data = await loadPortugueseCorpusData();

  if (!data) {
    return null;
  }

  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const candidateWords = buildCandidateWords(requestedWord);
  const canonicalWord = resolveCorpusCanonicalWord(data, requestedWord, candidateWords);
  const candidateKeys = buildCandidateKeys(requestedWord);
  const contextPoetryIds = collectContextChunkIds(data, candidateWords, context, "poesia");
  const contextProseIds = collectContextChunkIds(data, candidateWords, context, "prosa");
  const poetryIds = rankCandidateChunkIds(
    data,
    uniqueValues([...contextPoetryIds, ...collectChunkIds(data, candidateKeys, "poesia")]),
    context,
  );
  const proseIds = rankCandidateChunkIds(
    data,
    uniqueValues([...contextProseIds, ...collectChunkIds(data, candidateKeys, "prosa")]),
    context,
  );
  const poetryOccurrences = buildOccurrences(
    data,
    poetryIds,
    candidateWords,
    context,
    LOCAL_RESULT_LIMIT_BY_GENRE,
  );
  const proseOccurrences = buildOccurrences(
    data,
    proseIds,
    candidateWords,
    context,
    LOCAL_RESULT_LIMIT_BY_GENRE,
  );
  const allOccurrences = mergeOccurrenceLists(poetryOccurrences, proseOccurrences);

  if (
    allOccurrences.length === 0 &&
    poetryOccurrences.length === 0 &&
    proseOccurrences.length === 0
  ) {
    return null;
  }

  const sections = [
    buildOccurrenceSection("Tudo", allOccurrences, requestedWord),
    buildOccurrenceSection("Poesia", poetryOccurrences, requestedWord),
    buildOccurrenceSection("Prosa", proseOccurrences, requestedWord),
    buildAcervoSection(data),
  ].filter((section): section is LookupSection => Boolean(section));

  return {
    canonicalWord,
    label: "Corpus",
    note:
      "Corpus literário em português, com resultados distribuídos entre poesia e prosa.",
    sections,
    sourceId: "corpus",
    sourceUrl: null,
    status: "found",
  };
}
