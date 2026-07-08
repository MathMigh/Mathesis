import {
  htmlFromMarkdown,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const LOGEION_API = "https://anastrophe.uchicago.edu/logeion-api";
const USER_AGENT = "Mathesis/1.0 latin grammar";
const NOMINAL_ENDING_RE =
  /(?:a|ae|am|as|e|em|es|i|ibus|is|o|orum|os|u|um|us|uum)$/u;
const FINITE_VERB_ENDING_RE =
  /(?:o|m|s|t|mus|tis|nt|or|ris|re|tur|mur|mini|ntur|i|it|isti|imus|istis|erunt|ere|bam|bas|bat|bamus|batis|bant|bo|bis|bit|bimus|bitis|bunt|am|es|et|emus|etis|ent|iam|ies|iet|iemus|ietis|ient)$/u;
const STRONGLY_NOMINAL_ES_RE = /es$/u;

type LatinGrammarClassId =
  | "substantivo"
  | "adjetivo"
  | "pronome"
  | "numeral"
  | "verbo"
  | "adverbio"
  | "preposicao"
  | "conjuncao"
  | "interjeicao";

type LogeionFindResponse = {
  description?: string;
  parses?: Array<{ lemma?: string; parse?: string }>;
  word?: string;
};

type LatinClassReference = {
  allenEnglish?: string;
  bullets: string[];
  heading: string;
  overview: string;
};

type ParsedEntry = {
  classes: LatinGrammarClassId[];
  isFiniteVerb: boolean;
  isNominal: boolean;
  lemma: string;
  line: string;
  parse: string;
};

const LATIN_CLASS_PRIORITY: LatinGrammarClassId[] = [
  "verbo",
  "pronome",
  "substantivo",
  "adjetivo",
  "numeral",
  "adverbio",
  "preposicao",
  "conjuncao",
  "interjeicao",
];

const LATIN_GRAMMAR_REFERENCES: Record<LatinGrammarClassId, LatinClassReference> = {
  substantivo: {
    allenEnglish:
      "In Allen and Greenough, the noun is treated as an inflected name-word marked chiefly by case, number, and gender.",
    bullets: [
      "Nomeia seres, coisas, lugares, povos, divindades, nocoes ou acoes tratadas como entidades.",
      "Em latim, flexiona-se sobretudo em caso, numero e genero, distribuindo-se pelas cinco declinacoes.",
      "Na frase, costuma preencher funcoes nominais como sujeito, objeto, predicativo e complementos regidos por caso ou preposicao.",
    ],
    heading: "Substantivo",
    overview:
      "O substantivo latino e a classe nominal que designa os seres e se organiza por genero, numero e caso.",
  },
  adjetivo: {
    allenEnglish:
      "Allen and Greenough describe the adjective as a word that agrees with the noun in gender, number, and case while adding quality or relation.",
    bullets: [
      "Qualifica ou classifica o substantivo, concordando com ele em genero, numero e caso.",
      "Pode pertencer ao grupo de primeira/segunda declinacao ou ao grupo de terceira declinacao.",
      "Em muitos contextos, o adjetivo pode substantivar-se, funcionando como nome.",
    ],
    heading: "Adjetivo",
    overview:
      "O adjetivo latino modifica o substantivo e acompanha sua flexao de genero, numero e caso.",
  },
  pronome: {
    allenEnglish:
      "In Allen and Greenough, pronouns retain older forms and serve as substitutes or determiners for nouns inside the sentence.",
    bullets: [
      "Substitui ou acompanha um nome, apontando pessoa, posse, demonstracao, relacao, pergunta ou indefinicao.",
      "No latim, os pronomes tem paradigmas proprios e muitas vezes conservam formas antigas.",
      "Algumas series, como possessivos e demonstrativos, podem agir de modo muito proximo ao adjetivo.",
    ],
    heading: "Pronome",
    overview:
      "O pronome latino funciona como palavra nominal de referencia: retoma, aponta, determina ou substitui um nome.",
  },
  numeral: {
    allenEnglish:
      "Allen and Greenough separate cardinals, ordinals, distributives, and multiplicatives because their syntax and inflection do not coincide perfectly.",
    bullets: [
      "Exprime quantidade, ordem, multiplicacao ou divisao.",
      "Os cardinais, ordinais e distributivos nao se comportam exatamente do mesmo modo na flexao.",
      "Em latim, certos numerais podem ter uso substantivo ou adjetivo conforme o contexto sintatico.",
    ],
    heading: "Numeral",
    overview:
      "O numeral latino e a classe que marca numero e ordenacao, com comportamento morfologico variado conforme a serie.",
  },
  verbo: {
    allenEnglish:
      "Allen and Greenough treat the verb as the center of predication, inflected for person, number, tense, mood, and voice, with a broad system of verbal nouns and participles.",
    bullets: [
      "Exprime acao, processo, estado ou acontecimento situados no tempo.",
      "No latim, o verbo se organiza por voz, modo, tempo, numero e pessoa, alem de formas nominais como infinitivo, participio, gerundio, gerundivo e supino.",
      "A leitura de uma forma verbal fica mais precisa quando observamos ao mesmo tempo o lema e a etiqueta morfologica devolvida pela analise.",
    ],
    heading: "Verbo",
    overview:
      "O verbo latino e a classe central do predicado e carrega a maior parte das marcas temporais e modais da oracao.",
  },
  adverbio: {
    allenEnglish:
      "Allen and Greenough describe the adverb as an invariable modifier of verbs, adjectives, other adverbs, or of the entire statement.",
    bullets: [
      "Modifica sobretudo o verbo, mas tambem pode incidir sobre adjetivos, outros adverbios e a oracao inteira.",
      "E classe invariavel.",
      "Em latim, muitos adverbios se ligam a graus de comparacao e podem formar correlacoes com pronomes e particulas.",
    ],
    heading: "Adverbio",
    overview:
      "O adverbio latino e a classe invariavel que acrescenta circunstancia, intensidade ou modalizacao.",
  },
  preposicao: {
    allenEnglish:
      "Allen and Greenough emphasize that prepositions govern case and gain much of their meaning from the construction they introduce.",
    bullets: [
      "Liga um termo a outro e rege caso, especialmente acusativo ou ablativo.",
      "E classe invariavel.",
      "A escolha do caso apos a preposicao altera o valor sintatico e semantico da construcao.",
    ],
    heading: "Preposicao",
    overview:
      "A preposicao latina e uma palavra invariavel de relacao, normalmente associada a regencia de caso.",
  },
  conjuncao: {
    allenEnglish:
      "In Allen and Greenough, conjunctions are organizing words of the period, either coordinating or subordinating clauses and terms.",
    bullets: [
      "Relaciona oracoes ou termos equivalentes dentro do periodo.",
      "E classe invariavel.",
      "Pode coordenar ou subordinar, influindo diretamente na arquitetura sintatica da frase latina.",
    ],
    heading: "Conjuncao",
    overview:
      "A conjuncao latina e a palavra relacional que costura oracoes e termos dentro do periodo.",
  },
  interjeicao: {
    allenEnglish:
      "Allen and Greenough regard interjections as chiefly expressive rather than syntactic, tied to emotion and exclamation.",
    bullets: [
      "Traduz apelo, espanto, dor, exclamacao ou reacao imediata.",
      "E classe invariavel.",
      "Seu valor depende fortemente do contexto expressivo e da construcao em que aparece.",
    ],
    heading: "Interjeicao",
    overview:
      "A interjeicao latina funciona como explosao expressiva, mais afetiva do que sintatica.",
  },
};

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  sections: LookupSection[],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Gram\u00e1tica",
    note: note ? repairMojibake(note) ?? note : null,
    sections,
    sourceId: "gramatica",
    sourceUrl: null,
    status,
  };
}

function buildSection(label: string, markdown: string): LookupSection {
  const text = (repairMojibake(markdown) ?? markdown)
    .normalize("NFC")
    .replace(/\r/g, "")
    .trim();
  return {
    html: htmlFromMarkdown(text),
    label,
    text,
  };
}

function normalizeParse(value: string) {
  return normalizeInlineText(value.replace(/\s+/g, " "));
}

function toSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function classifyParse(parse: string) {
  const normalized = toSearchText(parse);
  const classes = new Set<LatinGrammarClassId>();

  if (/\bnoun\b/u.test(normalized)) {
    classes.add("substantivo");
  }
  if (/\badjective\b/u.test(normalized)) {
    classes.add("adjetivo");
  }
  if (/\bpronoun\b/u.test(normalized)) {
    classes.add("pronome");
  }
  if (/\bnumeral\b/u.test(normalized)) {
    classes.add("numeral");
  }
  if (/\bpreposition\b/u.test(normalized)) {
    classes.add("preposicao");
  }
  if (/\bconjunction\b/u.test(normalized)) {
    classes.add("conjuncao");
  }
  if (/\badverb\b/u.test(normalized)) {
    classes.add("adverbio");
  }
  if (/\binterjection\b/u.test(normalized)) {
    classes.add("interjeicao");
  }
  if (
    /\b(?:indicative|subjunctive|imperative|infinitive|participle|gerund|gerundive|supine)\b/u.test(
      normalized,
    )
  ) {
    classes.add("verbo");
  }

  return [...classes];
}

function translateParseToPortuguese(parse: string) {
  return normalizeParse(parse)
    .replace(/\bPossessive pronoun\b/giu, "pronome possessivo")
    .replace(/\bPronoun\b/giu, "pronome")
    .replace(/\bNoun\b/giu, "substantivo")
    .replace(/\bAdjective\b/giu, "adjetivo")
    .replace(/\bNumeral\b/giu, "numeral")
    .replace(/\bPreposition\b/giu, "preposicao")
    .replace(/\bConjunction\b/giu, "conjuncao")
    .replace(/\bAdverb\b/giu, "adverbio")
    .replace(/\bInterjection\b/giu, "interjeicao")
    .replace(/\bpresent active participle\b/giu, "participio presente ativo")
    .replace(/\bperfect active participle\b/giu, "participio perfeito ativo")
    .replace(/\bperfect passive participle\b/giu, "participio perfeito passivo")
    .replace(/\bfuture active participle\b/giu, "participio futuro ativo")
    .replace(/\bfuture passive participle\b/giu, "participio futuro passivo")
    .replace(/\bpresent passive participle\b/giu, "participio presente passivo")
    .replace(/\bparticiple\b/giu, "participio")
    .replace(/\bgerundive\b/giu, "gerundivo")
    .replace(/\bgerund\b/giu, "gerundio")
    .replace(/\bsupine\b/giu, "supino")
    .replace(/\binfinitive\b/giu, "infinitivo")
    .replace(/\bindicative\b/giu, "indicativo")
    .replace(/\bsubjunctive\b/giu, "subjuntivo")
    .replace(/\bimperative\b/giu, "imperativo")
    .replace(/\bactive\b/giu, "ativo")
    .replace(/\bpassive\b/giu, "passivo")
    .replace(/\bpresent\b/giu, "presente")
    .replace(/\bimperfect\b/giu, "imperfeito")
    .replace(/\bperfect\b/giu, "perfeito")
    .replace(/\bpluperfect\b/giu, "mais-que-perfeito")
    .replace(/\bfuture perfect\b/giu, "futuro perfeito")
    .replace(/\bfuture\b/giu, "futuro")
    .replace(/\b1st person\b/giu, "1a pessoa")
    .replace(/\b2nd person\b/giu, "2a pessoa")
    .replace(/\b3rd person\b/giu, "3a pessoa")
    .replace(/\bsingular\b/giu, "singular")
    .replace(/\bplural\b/giu, "plural")
    .replace(/\bmasculine\b/giu, "masculino")
    .replace(/\bfeminine\b/giu, "feminino")
    .replace(/\bneuter\b/giu, "neutro")
    .replace(/\bnominative\b/giu, "nominativo")
    .replace(/\bgenitive\b/giu, "genitivo")
    .replace(/\bdative\b/giu, "dativo")
    .replace(/\baccusative\b/giu, "acusativo")
    .replace(/\bablative\b/giu, "ablativo")
    .replace(/\bvocative\b/giu, "vocativo")
    .replace(/\s+,/gu, ",")
    .replace(/\s+-\s+/gu, " - ")
    .trim();
}

function sortClasses(classes: LatinGrammarClassId[]) {
  return [...classes].sort(
    (left, right) =>
      LATIN_CLASS_PRIORITY.indexOf(left) - LATIN_CLASS_PRIORITY.indexOf(right),
  );
}

function isFiniteVerbParse(parse: string) {
  const normalized = toSearchText(parse);
  return (
    /\b(?:indicative|subjunctive|imperative)\b/u.test(normalized) &&
    /\b(?:1st|2nd|3rd) person\b/u.test(normalized)
  );
}

function buildParsedEntry(item: { lemma?: string; parse?: string }, fallbackLemma: string): ParsedEntry {
  const lemma = normalizeInlineText(item.lemma ?? fallbackLemma);
  const translated = translateParseToPortuguese(item.parse ?? "");
  const classes = classifyParse(item.parse ?? "");
  return {
    classes,
    isFiniteVerb: isFiniteVerbParse(item.parse ?? ""),
    isNominal: classes.some((classId) =>
      ["substantivo", "adjetivo", "pronome", "numeral"].includes(classId),
    ),
    lemma,
    line: translated ? `${lemma} - ${translated.replace(/^-?\s*/u, "")}` : lemma,
    parse: item.parse ?? "",
  };
}

function filterCompetingParses(entries: ParsedEntry[], requestedWord: string) {
  const hasNominal = entries.some((entry) => entry.isNominal);
  const hasFiniteVerb = entries.some((entry) => entry.isFiniteVerb);
  const lowerWord = toSearchText(requestedWord);
  const looksNominal = NOMINAL_ENDING_RE.test(lowerWord);
  const looksFiniteVerb = FINITE_VERB_ENDING_RE.test(lowerWord);
  const hasPluralNominalParse = entries.some(
    (entry) => entry.isNominal && /\bplural\b/u.test(toSearchText(entry.parse)),
  );

  if (hasNominal && hasFiniteVerb && looksNominal && !looksFiniteVerb) {
    return entries.filter((entry) => !entry.isFiniteVerb || entry.isNominal);
  }

  if (hasNominal && hasFiniteVerb && STRONGLY_NOMINAL_ES_RE.test(lowerWord) && hasPluralNominalParse) {
    return entries.filter((entry) => !entry.isFiniteVerb || entry.isNominal);
  }

  return entries;
}

function buildClassSection(classIds: LatinGrammarClassId[], parseLines: string[]) {
  const blocks = classIds.flatMap((classId, index) => {
    const reference = LATIN_GRAMMAR_REFERENCES[classId];
    return [
      ...(index > 0 ? ["", ""] : []),
      `**${reference.heading}** - ${reference.overview}`,
      "",
      ...reference.bullets.map((bullet) => `- ${bullet}`),
      ...(reference.allenEnglish
        ? ["", `*Allen and Greenough:* ${reference.allenEnglish}`]
        : []),
    ];
  });

  const lines = [
    classIds.length > 0
      ? `**Classes poss\u00edveis:** ${classIds
          .map((classId) => LATIN_GRAMMAR_REFERENCES[classId].heading)
          .join(", ")}.`
      : "**Classes poss\u00edveis:** n\u00e3o definidas com seguran\u00e7a.",
    ...(parseLines.length > 0
      ? [
          "",
          "**Leitura morfol\u00f3gica da forma:**",
          ...parseLines.map((line) => `- ${line}`),
        ]
      : []),
    ...(blocks.length > 0 ? ["", ...blocks] : []),
  ];

  return buildSection("Classe", lines.join("\n"));
}

async function fetchLogeionFind(word: string) {
  const url = new URL(`${LOGEION_API}/find`);
  url.searchParams.set("w", word);

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Logeion respondeu com status ${response.status}.`);
  }

  return (await response.json()) as LogeionFindResponse;
}

export async function lookupLatinGrammarLocal(
  word: string,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));

  let payload: LogeionFindResponse;

  try {
    payload = await fetchLogeionFind(requestedWord);
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar a base gramatical latina nesta tentativa.",
      [],
    );
  }

  const parses = payload.parses ?? [];

  if (parses.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `Não encontrei uma leitura gramatical latina segura para "${requestedWord}".`,
      [],
    );
  }

  const canonicalWord =
    normalizeInlineText(parses[0]?.lemma ?? payload.word ?? requestedWord) ||
    requestedWord;

  const parsedEntries = filterCompetingParses(
    parses.map((item) => buildParsedEntry(item, canonicalWord)),
    requestedWord,
  );
  const classIds = sortClasses(
    [...new Set(parsedEntries.flatMap((entry) => entry.classes))],
  );
  const parseLines = parsedEntries.slice(0, 6).map((entry) => entry.line).filter(Boolean);

  return buildResult(
    requestedWord,
    classIds.length > 0 ? "found" : "not_found",
    "Verbete gramatical latino organizado a partir da Gramática Latina, de Napoleão Mendes de Almeida, com apoio de Allen and Greenough.",
    classIds.length > 0 ? [buildClassSection(classIds, parseLines)] : [],
    canonicalWord,
  );
}
