import { htmlFromMarkdown, normalizeInlineText } from "./dictionary-utils";
import { inferPortugueseVerbLemmas } from "./portuguese-verb-lemmas";
import { normalizeLineText } from "./dictionary-utils";
import { lookupAulete } from "./aulete";
import { lookupInfopedia } from "./infopedia";
import { lookupLatinGrammarLocal } from "./latin-grammar-local";
import { detectLookupLanguage } from "./lookup-language";
import { lookupPriberam } from "./priberam";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

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

type GrammarReference = {
  heading: string;
  pages: string;
  overview: string;
  bullets: string[];
  contextHints: string[];
  nuance?: string;
};

type GrammarAnalysis = {
  alternateClassIds: GrammarClassId[];
  baseForm: string;
  confidence: "alta" | "media" | "baixa";
  flexionLines: string[];
  primaryClassId: GrammarClassId;
  primarySummary: string;
  subtype?: string;
};

type SimpleMorphology = {
  gender?: "masculino" | "feminino";
  number: "singular" | "plural";
};

type VerbAnalysis = {
  baseForm: string;
  confidence: "alta" | "media";
  flexionLines: string[];
  summary: string;
};

type GrammarDictionaryEvidence = {
  classes: GrammarClassId[];
  counts: Partial<Record<GrammarClassId, number>>;
};

const LOOKUPABLE_WORD_PATTERN = /^[\p{L}\p{M}'-]+$/u;
const GRAMMAR_SOURCE_TITLE = "Nova gramática do português contemporâneo";
const GRAMMAR_SOURCE_AUTHORS = "Celso Cunha e Lindley Cintra";

const GRAMMAR_REFERENCES: Record<GrammarClassId, GrammarReference> = {
  substantivo: {
    bullets: [
      "Nomeia seres em geral: pessoas, lugares, instituiÃ§Ãµes, espÃ©cies, coisas, noÃ§Ãµes, aÃ§Ãµes, estados e qualidades concebidos como seres.",
      "Do ponto de vista funcional, pode servir como nÃºcleo do sujeito, do objeto direto, do objeto indireto e do agente da passiva.",
      "Pode aparecer como substantivo comum, prÃ³prio, concreto, abstrato ou coletivo, conforme o valor assumido no trecho.",
    ],
    contextHints: [
      "Pergunte se a palavra estÃ¡ nomeando um ser, uma coisa, uma ideia, um estado ou uma aÃ§Ã£o tratada como entidade.",
      "Observe se ela funciona como nÃºcleo de um sintagma nominal: geralmente aceita artigo, adjetivo ou complemento nominal.",
      "Se outra classe estiver ocupando esse lugar, ela provavelmente estÃ¡ substantivada no contexto.",
    ],
    heading: "Substantivo",
    nuance:
      "Na leitura local, vale distinguir se o nome aponta para um ser concreto ou para uma noÃ§Ã£o abstrata, e se nomeia uma classe inteira ou um indivÃ­duo determinado.",
    overview:
      "Substantivo Ã© a palavra com que designamos ou nomeamos os seres em geral.",
    pages: "224-246",
  },
  artigo: {
    bullets: [
      "AntepÃµe-se ao substantivo para apresentar o ser como conhecido, definido ou apenas introduzido no discurso.",
      "As formas definidas sÃ£o o, a, os, as; as indefinidas, um, uma, uns, umas.",
      "Participa de contraÃ§Ãµes frequentes com preposiÃ§Ãµes: do, da, no, na, pelo, pela, ao, Ã .",
    ],
    contextHints: [
      "Veja se a palavra aparece imediatamente antes de um substantivo, delimitando sua extensÃ£o.",
      "Se introduz um referente jÃ¡ identificÃ¡vel, a leitura tende ao artigo definido; se apresenta um exemplar qualquer, ao indefinido.",
      "Em formas mÃ­nimas como â€œaâ€, o contexto Ã© decisivo para separar artigo de preposiÃ§Ã£o.",
    ],
    heading: "Artigo",
    overview:
      "Artigo Ã© a palavra que se antepÃµe ao substantivo para indicar se o ser deve ser lido como definido ou indefinido.",
    pages: "252-253",
  },
  adjetivo: {
    bullets: [
      "Caracteriza o substantivo, indicando qualidade, defeito, modo de ser, aspecto, aparÃªncia ou estado.",
      "TambÃ©m pode funcionar como adjetivo de relaÃ§Ã£o, ligando o nome a tempo, espaÃ§o, matÃ©ria, finalidade, propriedade ou procedÃªncia.",
      "A distinÃ§Ã£o entre substantivo e adjetivo pode depender da funÃ§Ã£o exercida dentro da frase.",
    ],
    contextHints: [
      "Pergunte se a palavra estÃ¡ qualificando ou classificando um nome prÃ³ximo.",
      "Teste mentalmente se ela pode ser retirada sem destruir o nÃºcleo nominal: se sim, hÃ¡ boa chance de ser adjetivo.",
      "Se vier como nÃºcleo e receber determinante, talvez esteja substantivada no trecho.",
    ],
    heading: "Adjetivo",
    nuance:
      "Os adjetivos de relaÃ§Ã£o costumam ser classificatÃ³rios, nÃ£o admitem grau com naturalidade e aparecem, em geral, depois do substantivo.",
    overview:
      "O adjetivo Ã©, essencialmente, um modificador do substantivo.",
    pages: "292-293",
  },
  pronome: {
    bullets: [
      "Exerce funÃ§Ãµes equivalentes Ã s dos elementos nominais: pode representar um nome ou acompanhar um nome.",
      "Divide-se em sÃ©ries como pessoais, possessivos, demonstrativos, relativos, interrogativos e indefinidos.",
      "Pode funcionar como pronome substantivo ou pronome adjetivo, conforme apareÃ§a isolado ou junto de um substantivo.",
    ],
    contextHints: [
      "Veja se a palavra retoma um ser jÃ¡ mencionado ou se delimita o alcance de um substantivo prÃ³ximo.",
      "Quando aparece sozinha, tende Ã  leitura substantiva; quando acompanha um nome, Ã  leitura adjetiva.",
      "Nos relativos e interrogativos, a funÃ§Ã£o se esclarece pelo elo que a forma cria dentro da oraÃ§Ã£o.",
    ],
    heading: "Pronome",
    overview:
      "Pronome Ã© a palavra que desempenha funÃ§Ãµes equivalentes Ã s dos elementos nominais.",
    pages: "322-323",
  },
  numeral: {
    bullets: [
      "Indica quantidade exata ou a posiÃ§Ã£o ocupada por seres e coisas em uma sÃ©rie.",
      "Pode ser cardinal, ordinal, multiplicativo ou fracionÃ¡rio.",
      "Os ordinais se aproximam do comportamento do adjetivo e se substantivam com facilidade em certos contextos.",
    ],
    contextHints: [
      "Observe se a palavra estÃ¡ contando, ordenando, multiplicando ou fracionando.",
      "Se acompanha um substantivo, pode funcionar de modo prÃ³ximo ao adjetivo; se aparece sozinha, pode assumir valor substantivo.",
      "Em formas como â€œprimeiroâ€, â€œsegundoâ€ ou â€œquadragÃ©simaâ€, convÃ©m testar a fronteira entre numeral e adjetivo.",
    ],
    heading: "Numeral",
    overview:
      "Numeral Ã© a classe usada para exprimir quantidade precisa ou ordem de sucessÃ£o.",
    pages: "416-424",
  },
  verbo: {
    bullets: [
      "Exprime o que se passa: aÃ§Ã£o, processo, estado ou acontecimento representado no tempo.",
      "Na estrutura oracional, individualiza-se pela funÃ§Ã£o obrigatÃ³ria de predicado.",
      "Admite flexÃµes de nÃºmero, pessoa, modo, tempo, aspecto e voz.",
    ],
    contextHints: [
      "Pergunte se a palavra traz para a frase uma noÃ§Ã£o de processo situada no tempo.",
      "Verifique se ela pode sustentar o predicado da oraÃ§Ã£o; esse Ã© o sinal funcional mais forte do verbo.",
      "SÃ³ depois vale abrir a aba de flexÃ£o para decidir pessoa, tempo, modo ou forma nominal.",
    ],
    heading: "Verbo",
    overview:
      "Verbo Ã© uma palavra de forma variÃ¡vel que exprime o que se passa, isto Ã©, um acontecimento representado no tempo.",
    pages: "426-428",
  },
  adverbio: {
    bullets: [
      "Ã‰, fundamentalmente, um modificador do verbo.",
      "TambÃ©m pode intensificar ou ajustar o sentido de adjetivos, de outros advÃ©rbios e, em certos casos, da oraÃ§Ã£o inteira.",
      "Marca circunstÃ¢ncias como tempo, lugar, modo, intensidade, afirmaÃ§Ã£o, negaÃ§Ã£o e dÃºvida.",
    ],
    contextHints: [
      "Veja qual palavra estÃ¡ sendo modificada: um verbo, um adjetivo, outro advÃ©rbio ou a oraÃ§Ã£o inteira.",
      "Se a forma for invariÃ¡vel e indicar circunstÃ¢ncia, a leitura adverbial ganha forÃ§a.",
      "Em palavras terminadas em â€œ-menteâ€, a hipÃ³tese de advÃ©rbio costuma ser muito forte.",
    ],
    heading: "AdvÃ©rbio",
    overview:
      "O advÃ©rbio Ã©, fundamentalmente, um modificador do verbo, mas pode tambÃ©m incidir sobre adjetivos, outros advÃ©rbios e a oraÃ§Ã£o.",
    pages: "588-594",
  },
  preposicao: {
    bullets: [
      "Relaciona dois termos da oraÃ§Ã£o, de modo que o segundo explica ou completa o sentido do primeiro.",
      "Ã‰ palavra invariÃ¡vel.",
      "Pode aparecer em forma simples ou em locuÃ§Ã£o prepositiva.",
    ],
    contextHints: [
      "Observe se a forma estÃ¡ ligando dois termos e introduzindo um complemento.",
      "Se ela nÃ£o nomeia nem predica, mas apenas estabelece relaÃ§Ã£o, a leitura preposicional tende a ser a correta.",
      "Em itens curtos como â€œaâ€, â€œdeâ€, â€œemâ€ ou â€œporâ€, o entorno sintÃ¡tico decide quase tudo.",
    ],
    heading: "PreposiÃ§Ã£o",
    overview:
      "PreposiÃ§Ã£o Ã© a palavra invariÃ¡vel que relaciona dois termos da oraÃ§Ã£o, fazendo o segundo completar ou explicar o primeiro.",
    pages: "602-603",
  },
  conjuncao: {
    bullets: [
      "Relaciona duas oraÃ§Ãµes ou dois termos semelhantes da mesma oraÃ§Ã£o.",
      "As coordenativas unem elementos de funÃ§Ã£o equivalente.",
      "As subordinativas ligam oraÃ§Ãµes em relaÃ§Ã£o de dependÃªncia, determinaÃ§Ã£o ou completamento.",
    ],
    contextHints: [
      "Veja se a palavra estÃ¡ costurando duas oraÃ§Ãµes ou dois termos paralelos.",
      "Se as partes ligadas tÃªm o mesmo estatuto sintÃ¡tico, pense primeiro em coordenaÃ§Ã£o.",
      "Se uma oraÃ§Ã£o depende semanticamente da outra, a leitura subordinativa costuma ser a melhor.",
    ],
    heading: "ConjunÃ§Ã£o",
    overview:
      "ConjunÃ§Ã£o Ã© o vocÃ¡bulo gramatical que serve para relacionar duas oraÃ§Ãµes ou dois termos semelhantes da mesma oraÃ§Ã£o.",
    pages: "625-626",
  },
  interjeicao: {
    bullets: [
      "Traduz de modo vivo uma emoÃ§Ã£o, um apelo, uma reaÃ§Ã£o ou um impulso.",
      "Seu valor depende fortemente do contexto e da entoaÃ§Ã£o.",
      "Pode aparecer em forma simples ou em locuÃ§Ã£o interjetiva.",
    ],
    contextHints: [
      "Pergunte se a forma funciona como explosÃ£o expressiva, e nÃ£o como termo integrado Ã  sintaxe regular da oraÃ§Ã£o.",
      "A entoaÃ§Ã£o e o contexto imediato ajudam a distinguir espanto, dor, aplauso, desejo, invocaÃ§Ã£o e outros matizes.",
      "Se a expressÃ£o vier em bloco (â€œora, bolas!â€, â€œvalha-me Deus!â€), pode tratar-se de locuÃ§Ã£o interjetiva.",
    ],
    heading: "InterjeiÃ§Ã£o",
    overview:
      "InterjeiÃ§Ã£o Ã© uma espÃ©cie de grito com que traduzimos de modo vivo nossas emoÃ§Ãµes.",
    pages: "637-638",
  },
};

const ARTICLE_FORMS = new Map<
  string,
  { base: string; gender: "masculino" | "feminino"; kind: "definido" | "indefinido"; number: "singular" | "plural" }
>([
  ["o", { base: "o", gender: "masculino", kind: "definido", number: "singular" }],
  ["a", { base: "a", gender: "feminino", kind: "definido", number: "singular" }],
  ["os", { base: "o", gender: "masculino", kind: "definido", number: "plural" }],
  ["as", { base: "a", gender: "feminino", kind: "definido", number: "plural" }],
  ["um", { base: "um", gender: "masculino", kind: "indefinido", number: "singular" }],
  ["uma", { base: "uma", gender: "feminino", kind: "indefinido", number: "singular" }],
  ["uns", { base: "um", gender: "masculino", kind: "indefinido", number: "plural" }],
  ["umas", { base: "uma", gender: "feminino", kind: "indefinido", number: "plural" }],
]);

const PREPOSITIONS = new Set([
  "a",
  "ante",
  "apos",
  "ate",
  "com",
  "contra",
  "de",
  "desde",
  "em",
  "entre",
  "para",
  "perante",
  "por",
  "sem",
  "sob",
  "sobre",
  "tras",
]);

const COORDINATING_CONJUNCTIONS = new Set([
  "e",
  "nem",
  "mas",
  "porem",
  "todavia",
  "contudo",
  "entretanto",
  "ou",
  "ora",
  "logo",
  "portanto",
  "pois",
]);

const SUBORDINATING_CONJUNCTIONS = new Set([
  "que",
  "porque",
  "quando",
  "enquanto",
  "embora",
  "se",
  "como",
  "conforme",
  "segundo",
  "caso",
  "desdeque",
  "aindaque",
]);

const INTERJECTIONS = new Set([
  "ah",
  "oh",
  "oba",
  "opa",
  "ai",
  "ui",
  "chi",
  "ih",
  "ue",
  "uai",
  "puxa",
  "alou",
  "alo",
  "ola",
  "psiu",
  "basta",
]);

const PRONOUNS = new Map<string, { base: string; subtype: string }>([
  ["eu", { base: "eu", subtype: "pronome pessoal" }],
  ["me", { base: "eu", subtype: "pronome pessoal obliquo" }],
  ["mim", { base: "eu", subtype: "pronome pessoal obliquo" }],
  ["comigo", { base: "eu", subtype: "pronome pessoal obliquo" }],
  ["tu", { base: "tu", subtype: "pronome pessoal" }],
  ["te", { base: "tu", subtype: "pronome pessoal obliquo" }],
  ["ti", { base: "tu", subtype: "pronome pessoal obliquo" }],
  ["contigo", { base: "tu", subtype: "pronome pessoal obliquo" }],
  ["ele", { base: "ele", subtype: "pronome pessoal" }],
  ["ela", { base: "ela", subtype: "pronome pessoal" }],
  ["eles", { base: "ele", subtype: "pronome pessoal" }],
  ["elas", { base: "ela", subtype: "pronome pessoal" }],
  ["se", { base: "se", subtype: "pronome pessoal obliquo" }],
  ["si", { base: "si", subtype: "pronome pessoal obliquo" }],
  ["consigo", { base: "si", subtype: "pronome pessoal obliquo" }],
  ["nos", { base: "nos", subtype: "pronome pessoal" }],
  ["conosco", { base: "nos", subtype: "pronome pessoal obliquo" }],
  ["vos", { base: "vos", subtype: "pronome pessoal" }],
  ["convosco", { base: "vos", subtype: "pronome pessoal obliquo" }],
  ["lhe", { base: "lhe", subtype: "pronome pessoal obliquo" }],
  ["lhes", { base: "lhe", subtype: "pronome pessoal obliquo" }],
  ["meu", { base: "meu", subtype: "pronome possessivo" }],
  ["minha", { base: "minha", subtype: "pronome possessivo" }],
  ["meus", { base: "meu", subtype: "pronome possessivo" }],
  ["minhas", { base: "minha", subtype: "pronome possessivo" }],
  ["teu", { base: "teu", subtype: "pronome possessivo" }],
  ["tua", { base: "tua", subtype: "pronome possessivo" }],
  ["teus", { base: "teu", subtype: "pronome possessivo" }],
  ["tuas", { base: "tua", subtype: "pronome possessivo" }],
  ["seu", { base: "seu", subtype: "pronome possessivo" }],
  ["sua", { base: "sua", subtype: "pronome possessivo" }],
  ["seus", { base: "seu", subtype: "pronome possessivo" }],
  ["suas", { base: "sua", subtype: "pronome possessivo" }],
  ["nosso", { base: "nosso", subtype: "pronome possessivo" }],
  ["nossa", { base: "nossa", subtype: "pronome possessivo" }],
  ["nossos", { base: "nosso", subtype: "pronome possessivo" }],
  ["nossas", { base: "nossa", subtype: "pronome possessivo" }],
  ["vosso", { base: "vosso", subtype: "pronome possessivo" }],
  ["vossa", { base: "vossa", subtype: "pronome possessivo" }],
  ["vossos", { base: "vosso", subtype: "pronome possessivo" }],
  ["vossas", { base: "vossa", subtype: "pronome possessivo" }],
  ["este", { base: "este", subtype: "pronome demonstrativo" }],
  ["esta", { base: "esta", subtype: "pronome demonstrativo" }],
  ["estes", { base: "este", subtype: "pronome demonstrativo" }],
  ["estas", { base: "esta", subtype: "pronome demonstrativo" }],
  ["esse", { base: "esse", subtype: "pronome demonstrativo" }],
  ["essa", { base: "essa", subtype: "pronome demonstrativo" }],
  ["esses", { base: "esse", subtype: "pronome demonstrativo" }],
  ["essas", { base: "essa", subtype: "pronome demonstrativo" }],
  ["aquele", { base: "aquele", subtype: "pronome demonstrativo" }],
  ["aquela", { base: "aquela", subtype: "pronome demonstrativo" }],
  ["aqueles", { base: "aquele", subtype: "pronome demonstrativo" }],
  ["aquelas", { base: "aquela", subtype: "pronome demonstrativo" }],
  ["isto", { base: "isto", subtype: "pronome demonstrativo" }],
  ["isso", { base: "isso", subtype: "pronome demonstrativo" }],
  ["aquilo", { base: "aquilo", subtype: "pronome demonstrativo" }],
  ["algum", { base: "algum", subtype: "pronome indefinido" }],
  ["alguma", { base: "alguma", subtype: "pronome indefinido" }],
  ["alguns", { base: "algum", subtype: "pronome indefinido" }],
  ["algumas", { base: "alguma", subtype: "pronome indefinido" }],
  ["nenhum", { base: "nenhum", subtype: "pronome indefinido" }],
  ["nenhuma", { base: "nenhuma", subtype: "pronome indefinido" }],
  ["nenhuns", { base: "nenhum", subtype: "pronome indefinido" }],
  ["nenhumas", { base: "nenhuma", subtype: "pronome indefinido" }],
  ["todo", { base: "todo", subtype: "pronome indefinido" }],
  ["toda", { base: "toda", subtype: "pronome indefinido" }],
  ["todos", { base: "todo", subtype: "pronome indefinido" }],
  ["todas", { base: "toda", subtype: "pronome indefinido" }],
  ["outro", { base: "outro", subtype: "pronome indefinido" }],
  ["outra", { base: "outra", subtype: "pronome indefinido" }],
  ["outros", { base: "outro", subtype: "pronome indefinido" }],
  ["outras", { base: "outra", subtype: "pronome indefinido" }],
  ["quem", { base: "quem", subtype: "pronome interrogativo ou relativo" }],
  ["qual", { base: "qual", subtype: "pronome interrogativo ou relativo" }],
  ["quais", { base: "qual", subtype: "pronome interrogativo ou relativo" }],
  ["cujo", { base: "cujo", subtype: "pronome relativo" }],
  ["cuja", { base: "cuja", subtype: "pronome relativo" }],
  ["cujos", { base: "cujo", subtype: "pronome relativo" }],
  ["cujas", { base: "cuja", subtype: "pronome relativo" }],
  ["quanto", { base: "quanto", subtype: "pronome interrogativo ou indefinido" }],
  ["quanta", { base: "quanta", subtype: "pronome interrogativo ou indefinido" }],
  ["quantos", { base: "quanto", subtype: "pronome interrogativo ou indefinido" }],
  ["quantas", { base: "quanta", subtype: "pronome interrogativo ou indefinido" }],
  ["nada", { base: "nada", subtype: "pronome indefinido" }],
  ["tudo", { base: "tudo", subtype: "pronome indefinido" }],
  ["cada", { base: "cada", subtype: "pronome indefinido" }],
  ["alguem", { base: "alguÃ©m", subtype: "pronome indefinido" }],
  ["ninguem", { base: "ninguÃ©m", subtype: "pronome indefinido" }],
]);

const PRONOUN_CONTRACTIONS = new Map<
  string,
  { base: string; subtype: string; summary: string }
>([
  [
    "daquele",
    {
      base: "aquele",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "daquele" contrai a preposicao "de" com o demonstrativo "aquele".',
    },
  ],
  [
    "daquela",
    {
      base: "aquela",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "daquela" contrai a preposicao "de" com o demonstrativo "aquela".',
    },
  ],
  [
    "daqueles",
    {
      base: "aquele",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "daqueles" contrai a preposicao "de" com o demonstrativo "aqueles".',
    },
  ],
  [
    "daquelas",
    {
      base: "aquela",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "daquelas" contrai a preposicao "de" com o demonstrativo "aquelas".',
    },
  ],
  [
    "naquele",
    {
      base: "aquele",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "naquele" contrai a preposicao "em" com o demonstrativo "aquele".',
    },
  ],
  [
    "naquela",
    {
      base: "aquela",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "naquela" contrai a preposicao "em" com o demonstrativo "aquela".',
    },
  ],
  [
    "naqueles",
    {
      base: "aquele",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "naqueles" contrai a preposicao "em" com o demonstrativo "aqueles".',
    },
  ],
  [
    "naquelas",
    {
      base: "aquela",
      subtype: "pronome demonstrativo em contracao",
      summary: 'A forma "naquelas" contrai a preposicao "em" com o demonstrativo "aquelas".',
    },
  ],
  [
    "aquela",
    {
      base: "aquela",
      subtype: "pronome demonstrativo",
      summary: 'Nesta leitura, "aquela" funciona como demonstrativo feminino singular.',
    },
  ],
  [
    "aquele",
    {
      base: "aquele",
      subtype: "pronome demonstrativo",
      summary: 'Nesta leitura, "aquele" funciona como demonstrativo masculino singular.',
    },
  ],
]);

const NUMERAL_WORDS = new Map<string, { base: string; subtype: string }>([
  ["um", { base: "um", subtype: "numeral cardinal" }],
  ["uma", { base: "uma", subtype: "numeral cardinal" }],
  ["dois", { base: "dois", subtype: "numeral cardinal" }],
  ["duas", { base: "duas", subtype: "numeral cardinal" }],
  ["tres", { base: "tres", subtype: "numeral cardinal" }],
  ["quatro", { base: "quatro", subtype: "numeral cardinal" }],
  ["cinco", { base: "cinco", subtype: "numeral cardinal" }],
  ["seis", { base: "seis", subtype: "numeral cardinal" }],
  ["sete", { base: "sete", subtype: "numeral cardinal" }],
  ["oito", { base: "oito", subtype: "numeral cardinal" }],
  ["nove", { base: "nove", subtype: "numeral cardinal" }],
  ["dez", { base: "dez", subtype: "numeral cardinal" }],
  ["primeiro", { base: "primeiro", subtype: "numeral ordinal" }],
  ["primeira", { base: "primeira", subtype: "numeral ordinal" }],
  ["segundo", { base: "segundo", subtype: "numeral ordinal" }],
  ["segunda", { base: "segunda", subtype: "numeral ordinal" }],
  ["terceiro", { base: "terceiro", subtype: "numeral ordinal" }],
  ["terceira", { base: "terceira", subtype: "numeral ordinal" }],
  ["quarto", { base: "quarto", subtype: "numeral ordinal" }],
  ["quarta", { base: "quarta", subtype: "numeral ordinal" }],
]);

const ADVERB_TYPES = new Map<string, string>([
  ["nao", "adverbio de negacao"],
  ["sim", "adverbio de afirmacao"],
  ["talvez", "adverbio de duvida"],
  ["provavelmente", "adverbio de duvida"],
  ["realmente", "adverbio de afirmacao"],
  ["sempre", "adverbio de tempo"],
  ["nunca", "adverbio de tempo"],
  ["hoje", "adverbio de tempo"],
  ["amanha", "adverbio de tempo"],
  ["ontem", "adverbio de tempo"],
  ["aqui", "adverbio de lugar"],
  ["ali", "adverbio de lugar"],
  ["la", "adverbio de lugar"],
  ["ca", "adverbio de lugar"],
  ["acima", "adverbio de lugar"],
  ["abaixo", "adverbio de lugar"],
  ["dentro", "adverbio de lugar"],
  ["fora", "adverbio de lugar"],
  ["bem", "adverbio de modo"],
  ["mal", "adverbio de modo"],
  ["assim", "adverbio de modo"],
  ["depressa", "adverbio de modo"],
  ["devagar", "adverbio de modo"],
  ["muito", "adverbio de intensidade"],
  ["pouco", "adverbio de intensidade"],
  ["mais", "adverbio de intensidade"],
  ["menos", "adverbio de intensidade"],
  ["quase", "adverbio de intensidade"],
  ["tao", "adverbio de intensidade"],
]);

const STRONG_ABSTRACT_NOUN_SUFFIXES = [
  "dade",
  "ez",
  "eza",
  "cao",
  "sao",
  "xao",
  "ancia",
  "encia",
  "ice",
  "icie",
  "ismo",
  "tude",
  "ura",
  "ezas",
  "dades",
];

const STRONG_NOUN_SUFFIXES = [
  "agem",
  "ismo",
  "ista",
  "mento",
  "mentos",
  "cao",
  "coes",
  "sao",
  "soes",
  "tude",
  "douro",
  "dora",
  "dor",
  "tor",
  "aria",
  "arias",
  "idade",
  "idades",
  "eiro",
  "eira",
  "nte",
];

const STRONG_ADJECTIVE_SUFFIXES = [
  "avel",
  "ivel",
  "oso",
  "osa",
  "al",
  "ar",
  "ica",
  "ico",
  "ivo",
  "iva",
  "ente",
  "ante",
  "udo",
  "uda",
  "ino",
  "ina",
  "esco",
  "esca",
];

const STRONG_VERB_SUFFIXES = [
  "ando",
  "endo",
  "indo",
  "ado",
  "ada",
  "ados",
  "adas",
  "ido",
  "ida",
  "idos",
  "idas",
  "arei",
  "aria",
  "arias",
  "ariamos",
  "ariam",
  "aram",
  "asse",
  "asses",
  "assem",
  "assemos",
  "aste",
  "astes",
  "avam",
  "ava",
  "ou",
  "ei",
  "emos",
  "erei",
  "eria",
  "erias",
  "eriamos",
  "eriam",
  "eram",
  "esse",
  "esses",
  "essem",
  "essemos",
  "este",
  "estes",
  "eu",
  "imos",
  "irei",
  "iria",
  "irias",
  "iriamos",
  "iriam",
  "iram",
  "isse",
  "isses",
  "issem",
  "issemos",
  "iste",
  "istes",
  "iu",
  "izei",
  "ize",
  "izem",
  "izo",
  "izam",
  "izou",
];

const IRREGULAR_VERB_FORMS = new Map<
  string,
  { baseForm: string; flexionLines: string[]; summary: string }
>([
  [
    "sou",
    {
      baseForm: "ser",
      flexionLines: [
        "- **Forma-base:** ser.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "sou" aponta claramente para o verbo **ser**.',
    },
  ],
  [
    "estou",
    {
      baseForm: "estar",
      flexionLines: [
        "- **Forma-base:** estar.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "estou" aponta claramente para o verbo **estar**.',
    },
  ],
  [
    "fui",
    {
      baseForm: "ir",
      flexionLines: [
        "- **Forma-base mais economica:** ir.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** preterito perfeito do indicativo.",
        "- **Observacao:** a forma tambem pode pertencer ao verbo **ser**, conforme o contexto.",
      ],
      summary: 'A forma "fui" e irregular e pode pertencer a **ir** ou **ser**.',
    },
  ],
  [
    "foi",
    {
      baseForm: "ir",
      flexionLines: [
        "- **Forma-base mais economica:** ir.",
        "- **Flexao observada:** 3a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** preterito perfeito do indicativo.",
        "- **Observacao:** a forma tambem pode pertencer ao verbo **ser**, conforme o contexto.",
      ],
      summary: 'A forma "foi" e irregular e pode pertencer a **ir** ou **ser**.',
    },
  ],
  [
    "quero",
    {
      baseForm: "querer",
      flexionLines: [
        "- **Forma-base:** querer.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "quero" funciona como forma conjugada do verbo **querer**.',
    },
  ],
  [
    "quer",
    {
      baseForm: "querer",
      flexionLines: [
        "- **Forma-base:** querer.",
        "- **Flexao observada:** 3a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "quer" funciona como forma conjugada do verbo **querer**.',
    },
  ],
  [
    "posso",
    {
      baseForm: "poder",
      flexionLines: [
        "- **Forma-base:** poder.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "posso" funciona como forma conjugada do verbo **poder**.',
    },
  ],
  [
    "vejo",
    {
      baseForm: "ver",
      flexionLines: [
        "- **Forma-base:** ver.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "vejo" funciona como forma conjugada do verbo **ver**.',
    },
  ],
  [
    "digo",
    {
      baseForm: "dizer",
      flexionLines: [
        "- **Forma-base:** dizer.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "digo" funciona como forma conjugada do verbo **dizer**.',
    },
  ],
  [
    "venho",
    {
      baseForm: "vir",
      flexionLines: [
        "- **Forma-base:** vir.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "venho" funciona como forma conjugada do verbo **vir**.',
    },
  ],
  [
    "dou",
    {
      baseForm: "dar",
      flexionLines: [
        "- **Forma-base:** dar.",
        "- **Flexao observada:** 1a pessoa do singular.",
        "- **Tempo e modo mais provaveis:** presente do indicativo.",
      ],
      summary: 'A forma "dou" funciona como forma conjugada do verbo **dar**.',
    },
  ],
]);

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

const DICTIONARY_GRAMMAR_PATTERNS: Array<{
  classId: GrammarClassId;
  patterns: RegExp[];
}> = [
  {
    classId: "substantivo",
    patterns: [
      /\bsubstantivo\b/iu,
      /\bnome\b/iu,
      /\bs\.?\s*m\.?\b/iu,
      /\bs\.?\s*f\.?\b/iu,
      /\bsm\b/iu,
      /\bsf\b/iu,
      /\bs2g\b/iu,
    ],
  },
  {
    classId: "adjetivo",
    patterns: [/\badjetivo\b/iu, /\badj\.?\b/iu, /^a\.$/iu],
  },
  {
    classId: "verbo",
    patterns: [
      /\bverbo\b/iu,
      /\bdo verbo\b/iu,
      /\bv\.?\s*t\.?\b/iu,
      /\bv\.?\s*i\.?\b/iu,
      /\bv\.?\s*pron\.?\b/iu,
      /\bvt\b/iu,
      /\bvi\b/iu,
    ],
  },
  {
    classId: "adverbio",
    patterns: [/\badv[eÃ©]rbio\b/iu, /\badv\.?\b/iu],
  },
  {
    classId: "pronome",
    patterns: [
      /\bpronome\b/iu,
      /\bpron\.?\b/iu,
      /\bpr\.\s*(?:indef|dem|poss|rel|interrog|interr|pess|trat)\.?/iu,
      /^pr\.$/iu,
    ],
  },
  {
    classId: "preposicao",
    patterns: [/\bpreposi[cÃ§][aÃ£]o\b/iu, /\bprep\.?\b/iu],
  },
  {
    classId: "conjuncao",
    patterns: [
      /\bconjun[cÃ§][aÃ£]o\b/iu,
      /\bconj\.?\b/iu,
      /\bconj\.\s*(?:adit|advers|altern|conclus|explic|integr|compar|condic|concess|caus|temp|final|conform)\.?/iu,
    ],
  },
  {
    classId: "numeral",
    patterns: [/\bnumeral\b/iu, /\bnum\.?\b/iu],
  },
  {
    classId: "interjeicao",
    patterns: [/\binterjei[cÃ§][aÃ£]o\b/iu, /\binterj\.?\b/iu],
  },
  {
    classId: "artigo",
    patterns: [/\bartigo\b/iu],
  },
];

function titleCaseWord(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

function lowerCaseWord(value: string) {
  return normalizeInlineText(value.normalize("NFC")).toLocaleLowerCase("pt-BR");
}

function repairGrammarMojibake(value: string) {
  if (!/(?:\uFFFD|Ã.|Â.|â(?:€|€™|€œ))/u.test(value)) {
    return value;
  }

  return value
    .replaceAll("Ã¡", "á")
    .replaceAll("Ã¢", "â")
    .replaceAll("Ã£", "ã")
    .replaceAll("Ã ", "à")
    .replaceAll("Ã¤", "ä")
    .replaceAll("Ã", "Á")
    .replaceAll("Ã‚", "Â")
    .replaceAll("Ãƒ", "Ã")
    .replaceAll("Ã€", "À")
    .replaceAll("Ã©", "é")
    .replaceAll("Ãª", "ê")
    .replaceAll("Ã¨", "è")
    .replaceAll("Ã‰", "É")
    .replaceAll("ÃŠ", "Ê")
    .replaceAll("Ã­", "í")
    .replaceAll("Ã¬", "ì")
    .replaceAll("Ã", "Í")
    .replaceAll("Ã³", "ó")
    .replaceAll("Ã´", "ô")
    .replaceAll("Ãµ", "õ")
    .replaceAll("Ã²", "ò")
    .replaceAll("Ã“", "Ó")
    .replaceAll("Ã”", "Ô")
    .replaceAll("Ã•", "Õ")
    .replaceAll("Ãº", "ú")
    .replaceAll("Ã¹", "ù")
    .replaceAll("Ãš", "Ú")
    .replaceAll("Ã§", "ç")
    .replaceAll("Ã‡", "Ç")
    .replaceAll("Ã±", "ñ")
    .replaceAll("â€œ", "“")
    .replaceAll("â€", "”")
    .replaceAll("â€˜", "‘")
    .replaceAll("â€™", "’")
    .replaceAll("â€“", "–")
    .replaceAll("â€”", "—")
    .replaceAll("â€¦", "…")
    .replaceAll("Â ", " ")
    .replaceAll("Â", "");
}

function polishGrammarMarkdown(markdown: string) {
  const polished = markdown
    .replaceAll("Classe provavel", "Classe provável")
    .replaceAll("Confianca local", "Segurança local")
    .replaceAll("Definicao", "Definição")
    .replaceAll("Observacao principal", "Observação principal")
    .replaceAll("Observacao", "Observação")
    .replaceAll("Tambem", "Também")
    .replaceAll("Forma de referencia", "Forma de referência")
    .replaceAll("Forma-base mais economica", "Forma-base mais econômica")
    .replaceAll("Flexao observada", "Flexão observada")
    .replaceAll("Genero provavel", "Gênero provável")
    .replaceAll("Genero", "Gênero")
    .replaceAll("Numero", "Número")
    .replaceAll("Subtipo provavel", "Subtipo provável");

  return repairGrammarMojibake(polished);
}

function buildSection(label: string, markdown: string): LookupSection {
  const polished = polishGrammarMarkdown(markdown);

  return {
    html: htmlFromMarkdown(polished),
    label,
    text: polished,
  };
}

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
    note: note ? repairGrammarMojibake(note) : null,
    sections,
    sourceId: "gramatica",
    sourceUrl: null,
    status,
  };
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function guessSingularForm(word: string) {
  if (word.endsWith("oes")) {
    return `${word.slice(0, -3)}ao`;
  }

  if (word.endsWith("aes")) {
    return `${word.slice(0, -3)}ao`;
  }

  if (word.endsWith("aos")) {
    return `${word.slice(0, -1)}`;
  }

  if (word.endsWith("ais")) {
    return `${word.slice(0, -2)}l`;
  }

  if (word.endsWith("eis")) {
    return `${word.slice(0, -2)}l`;
  }

  if (word.endsWith("ois")) {
    return `${word.slice(0, -2)}l`;
  }

  if (word.endsWith("res") || word.endsWith("zes")) {
    return word.slice(0, -2);
  }

  if (word.endsWith("ns")) {
    return `${word.slice(0, -2)}m`;
  }

  if (word.endsWith("es") && word.length > 4) {
    return word.slice(0, -2);
  }

  if (word.endsWith("s") && word.length > 3) {
    return word.slice(0, -1);
  }

  return word;
}

function guessSingularDisplayForm(word: string) {
  const lowered = lowerCaseWord(word);

  if (lowered.endsWith("Ãµes")) {
    return `${lowered.slice(0, -3)}Ã£o`;
  }

  if (lowered.endsWith("Ã£es")) {
    return `${lowered.slice(0, -3)}Ã£o`;
  }

  if (lowered.endsWith("Ã£os")) {
    return lowered.slice(0, -1);
  }

  if (lowered.endsWith("ais")) {
    return `${lowered.slice(0, -2)}al`;
  }

  if (lowered.endsWith("eis")) {
    return `${lowered.slice(0, -2)}el`;
  }

  if (lowered.endsWith("ois")) {
    return `${lowered.slice(0, -2)}ol`;
  }

  if (lowered.endsWith("res") || lowered.endsWith("zes")) {
    return lowered.slice(0, -2);
  }

  if (lowered.endsWith("ns")) {
    return `${lowered.slice(0, -2)}m`;
  }

  if (lowered.endsWith("es") && lowered.length > 4) {
    return lowered.slice(0, -2);
  }

  if (lowered.endsWith("s") && lowered.length > 3) {
    return lowered.slice(0, -1);
  }

  return lowered;
}

function guessSimpleMorphology(word: string): SimpleMorphology {
  const normalized = normalizeSearchText(lowerCaseWord(word));
  const plural = normalized.endsWith("s") && normalized.length > 2;

  if (plural) {
    if (normalized.endsWith("as")) {
      return { gender: "feminino", number: "plural" };
    }

    if (normalized.endsWith("os")) {
      return { gender: "masculino", number: "plural" };
    }

    return { number: "plural" };
  }

  if (normalized.endsWith("a")) {
    return { gender: "feminino", number: "singular" };
  }

  if (normalized.endsWith("o")) {
    return { gender: "masculino", number: "singular" };
  }

  return { number: "singular" };
}

function detectNumeralProfile(word: string) {
  const normalized = normalizeSearchText(word);
  const direct = NUMERAL_WORDS.get(normalized);

  if (direct) {
    return direct;
  }

  if (/^\d+[ÂºÂ°Âª]?$/u.test(word)) {
    return { base: word, subtype: "numeral cardinal" };
  }

  if (
    /(?:primeir|segund|terceir|quart|quint|sext|setim|oitav|non|decim|vigesim|trigesim|quadragesim|quinquagesim|sexagesim|septuagesim|octogesim|nonagesim|centesim|milesim)[oa]s?$/u.test(
      normalized,
    )
  ) {
    return { base: guessSingularDisplayForm(word), subtype: "numeral ordinal" };
  }

  if (/(dobr|triplic|quadrupl|dupl)[oa]s?$/u.test(normalized)) {
    return { base: guessSingularDisplayForm(word), subtype: "numeral multiplicativo" };
  }

  if (/(mei|metad|terc|quart|quint)[oa]s?$/u.test(normalized)) {
    return { base: guessSingularDisplayForm(word), subtype: "numeral fracionario" };
  }

  return null;
}

function detectVerbAnalysis(word: string, lemmaOverride?: string): VerbAnalysis | null {
  const normalized = normalizeSearchText(word);
  const irregular = IRREGULAR_VERB_FORMS.get(normalized);

  if (irregular) {
    return {
      baseForm: irregular.baseForm,
      confidence: "alta",
      flexionLines: irregular.flexionLines,
      summary: irregular.summary,
    };
  }

  if (/^(?:[a-zÃ -Ã¿-]+)(ar|er|ir)$/iu.test(word) && word.length > 3) {
    return {
      baseForm: normalizeInlineText(word),
      confidence: "alta",
      flexionLines: [
        `- **Forma-base:** ${normalizeInlineText(word)}.`,
        "- **Leitura morfologica:** infinitivo.",
        "- **Observacao:** no infinitivo, o verbo aparece na forma de consulta mais neutra.",
      ],
      summary: `A forma "${word}" ja aparece em infinitivo.`,
    };
  }

  const lemmas = uniqueValues(
    lemmaOverride ? [lemmaOverride] : inferPortugueseVerbLemmas(word),
  );

  if (lemmas.length === 0) {
    return null;
  }

  const lemma = lemmas[0] ?? normalizeInlineText(word);
  const normalizedLemma = normalizeSearchText(lemma);

  if (STRONG_VERB_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    if (normalized.endsWith("ando") || normalized.endsWith("endo") || normalized.endsWith("indo")) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Leitura morfologica:** gerundio.",
          "- **Observacao:** o gerundio nao marca pessoa; em geral, apresenta o processo em curso ou simultaneo.",
        ],
        summary: `A forma "${word}" parece um gerundio do verbo **${lemma}**.`,
      };
    }

    if (
      normalized.endsWith("ado") ||
      normalized.endsWith("ada") ||
      normalized.endsWith("ados") ||
      normalized.endsWith("adas") ||
      normalized.endsWith("ido") ||
      normalized.endsWith("ida") ||
      normalized.endsWith("idos") ||
      normalized.endsWith("idas")
    ) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Leitura morfologica:** participio.",
          "- **Observacao:** o participio pode integrar tempos compostos ou funcionar em construcoes adjetivais, conforme o contexto.",
        ],
        summary: `A forma "${word}" parece um participio ligado ao verbo **${lemma}**.`,
      };
    }

    if (
      normalized.endsWith("arei") ||
      normalized.endsWith("erei") ||
      normalized.endsWith("irei")
    ) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Flexao observada:** 1a pessoa do singular.",
          "- **Tempo e modo mais provaveis:** futuro do presente do indicativo.",
        ],
        summary: `A forma "${word}" parece uma flexao futura do verbo **${lemma}**.`,
      };
    }

    if (
      normalized.endsWith("aria") ||
      normalized.endsWith("eria") ||
      normalized.endsWith("iria") ||
      normalized.endsWith("ariam") ||
      normalized.endsWith("eriam") ||
      normalized.endsWith("iriam")
    ) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Tempo e modo mais provaveis:** futuro do preterito do indicativo.",
          "- **Observacao:** a pessoa e o numero variam conforme a terminacao exata da forma.",
        ],
        summary: `A forma "${word}" parece uma flexao condicional ligada ao verbo **${lemma}**.`,
      };
    }

    if (normalized.endsWith("ou") || normalized.endsWith("eu") || normalized.endsWith("iu")) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Flexao observada:** 3a pessoa do singular.",
          "- **Tempo e modo mais provaveis:** preterito perfeito do indicativo.",
        ],
        summary: `A forma "${word}" parece uma flexao acabada do verbo **${lemma}**.`,
      };
    }

    if (
      normalized.endsWith("aram") ||
      normalized.endsWith("eram") ||
      normalized.endsWith("iram")
    ) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Flexao observada:** 3a pessoa do plural.",
          "- **Tempo e modo mais provaveis:** preterito perfeito do indicativo.",
        ],
        summary: `A forma "${word}" parece uma flexao verbal concluida ligada a **${lemma}**.`,
      };
    }

    if (normalized.endsWith("ei")) {
      return {
        baseForm: lemma,
        confidence: "alta",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Flexao observada:** 1a pessoa do singular.",
          "- **Tempo e modo mais provaveis:** preterito perfeito do indicativo.",
        ],
        summary: `A forma "${word}" parece uma flexao verbal concluida ligada a **${lemma}**.`,
      };
    }

    if (normalized.endsWith("ize") || normalized.endsWith("izem") || normalized.endsWith("izo")) {
      return {
        baseForm: lemma,
        confidence: "media",
        flexionLines: [
          `- **Forma-base:** ${lemma}.`,
          "- **Observacao principal:** a terminacao em **-iz-** aponta fortemente para leitura verbal.",
          "- **Modo/tempo possiveis:** presente do subjuntivo, imperativo ou presente do indicativo, conforme a forma exata e o contexto.",
        ],
        summary: `A forma "${word}" aponta para uma leitura verbal ligada a **${lemma}**.`,
      };
    }

    return {
      baseForm: lemma,
      confidence: "media",
      flexionLines: [
        `- **Forma-base:** ${lemma}.`,
        "- **Observacao:** a terminacao indica flexao verbal provavel, mas o contexto ainda ajuda a fechar pessoa, tempo ou modo.",
      ],
      summary: `A forma "${word}" aponta para uma leitura verbal ligada a **${lemma}**.`,
    };
  }

  if (normalizedLemma.endsWith("izar") && (normalized.endsWith("iza") || normalized.endsWith("izo"))) {
    return {
      baseForm: lemma,
      confidence: "media",
      flexionLines: [
        `- **Forma-base:** ${lemma}.`,
        "- **Observacao principal:** a familia em **-izar** costuma gerar formas verbais nitidas.",
        "- **Tempo/modo mais provaveis:** presente do indicativo ou do subjuntivo, conforme o contexto.",
      ],
      summary: `A forma "${word}" parece pertencer ao verbo **${lemma}**.`,
    };
  }

  return null;
}

function isParticipleLikeAnalysis(analysis: VerbAnalysis | null) {
  if (!analysis) {
    return false;
  }

  return analysis.flexionLines.some((line) =>
    normalizeSearchText(line).includes("participio"),
  );
}

function detectNominalClass(word: string) {
  const normalized = normalizeSearchText(word);

  if (STRONG_ABSTRACT_NOUN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return {
      classId: "substantivo" as const,
      summary: `A terminacao de "${word}" aponta para leitura nominal, com matiz abstrato.`,
      subtype: "substantivo abstrato",
    };
  }

  if (STRONG_NOUN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return {
      classId: "substantivo" as const,
      summary: `A forma "${word}" traz uma terminacao muito produtiva em substantivos.`,
      subtype: "substantivo comum",
    };
  }

  if (STRONG_ADJECTIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return {
      classId: "adjetivo" as const,
      summary: `A terminacao de "${word}" favorece uma leitura adjetiva.`,
      subtype: "adjetivo qualificativo",
    };
  }

  return null;
}

function buildClosedClassAnalysis(word: string): GrammarAnalysis | null {
  const normalized = normalizeSearchText(word);

  const article = ARTICLE_FORMS.get(normalized);

  if (article) {
    const alternateClassIds = normalized === "a" ? (["preposicao"] as GrammarClassId[]) : [];
    return {
      alternateClassIds,
      baseForm: article.base,
      confidence: alternateClassIds.length > 0 ? "media" : "alta",
      flexionLines: [
        `- **Forma de referencia:** ${article.base}.`,
        `- **Tipo:** artigo ${article.kind}.`,
        `- **Genero:** ${article.gender}.`,
        `- **Numero:** ${article.number}.`,
        ...(normalized === "a"
          ? ["- **Observacao:** isoladamente, a forma **a** tambem pode funcionar como preposicao."]
          : []),
      ],
      primaryClassId: "artigo",
      primarySummary:
        normalized === "a"
          ? 'Sem contexto, "a" pode oscilar entre artigo e preposicao; aqui a leitura inicial de artigo e a mais neutra.'
          : `A forma "${word}" pertence ao paradigma do artigo ${article.kind}.`,
      subtype: `artigo ${article.kind}`,
    };
  }

  const contraction = PRONOUN_CONTRACTIONS.get(normalized);

  if (contraction) {
    return {
      alternateClassIds: ["preposicao"],
      baseForm: contraction.base,
      confidence: "alta",
      flexionLines: [
        `- **Forma de referencia:** ${contraction.base}.`,
        `- **Leitura principal:** ${contraction.subtype}.`,
        "- **Observacao:** a forma ja traz a preposicao incorporada.",
      ],
      primaryClassId: "pronome",
      primarySummary: contraction.summary,
      subtype: contraction.subtype,
    };
  }

  const pronoun = PRONOUNS.get(normalized);

  if (pronoun) {
    return {
      alternateClassIds: [],
      baseForm: pronoun.base,
      confidence: "alta",
      flexionLines: [
        `- **Forma de referencia:** ${pronoun.base}.`,
        `- **Subtipo provavel:** ${pronoun.subtype}.`,
        "- **Observacao:** nos pronomes, a funcao sintatica costuma depender fortemente do contexto da frase.",
      ],
      primaryClassId: "pronome",
      primarySummary: `A forma "${word}" se encaixa no sistema pronominal do portugues.`,
      subtype: pronoun.subtype,
    };
  }

  const numeral = detectNumeralProfile(word);

  if (numeral) {
    const morphology = guessSimpleMorphology(word);
    return {
      alternateClassIds: numeral.subtype === "numeral ordinal" ? ["adjetivo"] : [],
      baseForm: numeral.base,
      confidence: "alta",
      flexionLines: [
        `- **Forma de referencia:** ${numeral.base}.`,
        `- **Subtipo:** ${numeral.subtype}.`,
        `- **Numero:** ${morphology.number}.`,
        ...(morphology.gender ? [`- **Genero:** ${morphology.gender}.`] : []),
        ...(numeral.subtype === "numeral ordinal"
          ? [
              "- **Observacao:** os ordinais frequentemente funcionam como adjetivos e tambem podem substantivar-se.",
            ]
          : []),
      ],
      primaryClassId: "numeral",
      primarySummary: `A forma "${word}" tem comportamento numeral, associado a quantidade ou ordem.`,
      subtype: numeral.subtype,
    };
  }

  if (INTERJECTIONS.has(normalized)) {
    return {
      alternateClassIds: [],
      baseForm: lowerCaseWord(word),
      confidence: "alta",
      flexionLines: [
        "- **Classe invariavel:** a interjeicao nao se flexiona em genero, numero ou conjugacao.",
        "- **Valor principal:** depende da entoacao e do contexto.",
      ],
      primaryClassId: "interjeicao",
      primarySummary: `A forma "${word}" se comporta como interjeicao.`,
      subtype: "interjeicao",
    };
  }

  if (COORDINATING_CONJUNCTIONS.has(normalized) || SUBORDINATING_CONJUNCTIONS.has(normalized)) {
    return {
      alternateClassIds: [],
      baseForm: lowerCaseWord(word),
      confidence: "alta",
      flexionLines: [
        "- **Classe invariavel:** a conjuncao nao se flexiona.",
        `- **Subtipo provavel:** ${
          COORDINATING_CONJUNCTIONS.has(normalized)
            ? "conjuncao coordenativa"
            : "conjuncao subordinativa"
        }.`,
      ],
      primaryClassId: "conjuncao",
      primarySummary: `A forma "${word}" funciona como elemento de ligacao sintatica.`,
      subtype: COORDINATING_CONJUNCTIONS.has(normalized)
        ? "conjuncao coordenativa"
        : "conjuncao subordinativa",
    };
  }

  if (ADVERB_TYPES.has(normalized) || normalized.endsWith("mente")) {
    return {
      alternateClassIds: [],
      baseForm: lowerCaseWord(word),
      confidence: "alta",
      flexionLines: [
        "- **Classe invariavel:** o adverbio nao varia em genero ou numero.",
        `- **Subtipo provavel:** ${ADVERB_TYPES.get(normalized) ?? "adverbio em -mente"}.`,
      ],
      primaryClassId: "adverbio",
      primarySummary:
        normalized.endsWith("mente")
          ? `A terminacao em "-mente" favorece com muita forca a leitura adverbial de "${word}".`
          : `A forma "${word}" pertence a um grupo adverbial muito recorrente.`,
      subtype: ADVERB_TYPES.get(normalized) ?? "adverbio",
    };
  }

  if (PREPOSITIONS.has(normalized)) {
    return {
      alternateClassIds: [],
      baseForm: lowerCaseWord(word),
      confidence: "alta",
      flexionLines: [
        "- **Classe invariavel:** a preposicao nao se flexiona.",
        "- **Leitura principal:** relacao entre dois termos da oracao.",
      ],
      primaryClassId: "preposicao",
      primarySummary: `A forma "${word}" pertence ao conjunto basico das preposicoes do portugues.`,
      subtype: "preposicao simples",
    };
  }

  return null;
}

function buildNominalFlexionLines(word: string, classId: GrammarClassId, subtype?: string) {
  const morphology = guessSimpleMorphology(word);
  const singular =
    morphology.number === "plural" ? guessSingularDisplayForm(word) : lowerCaseWord(word);
  const baseLines = [
    `- **Forma de referencia:** ${titleCaseWord(singular)}.`,
    `- **Numero:** ${morphology.number}.`,
    ...(morphology.gender ? [`- **Genero provavel:** ${morphology.gender}.`] : []),
  ];

  if (classId === "substantivo") {
    return [
      ...baseLines,
      ...(subtype ? [`- **Leitura interna:** ${subtype}.`] : []),
      "- **Observacao:** em substantivos, o genero lexical nao deve ser forcado ao masculino apenas para consulta.",
    ];
  }

  return [
    ...baseLines,
    ...(subtype ? [`- **Leitura interna:** ${subtype}.`] : []),
  ];
}

function analyzeWord(word: string): GrammarAnalysis {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const normalized = normalizeSearchText(requestedWord);
  const closedClass = buildClosedClassAnalysis(requestedWord);

  if (closedClass) {
    return closedClass;
  }

  const numeral = detectNumeralProfile(requestedWord);

  if (numeral) {
    const morphology = guessSimpleMorphology(requestedWord);
    return {
      alternateClassIds: numeral.subtype === "numeral ordinal" ? ["adjetivo"] : [],
      baseForm: numeral.base,
      confidence: "alta",
      flexionLines: [
        `- **Forma de referencia:** ${titleCaseWord(numeral.base)}.`,
        `- **Subtipo:** ${numeral.subtype}.`,
        `- **Numero:** ${morphology.number}.`,
        ...(morphology.gender ? [`- **Genero:** ${morphology.gender}.`] : []),
      ],
      primaryClassId: "numeral",
      primarySummary: `A forma "${requestedWord}" tem comportamento numeral.`,
      subtype: numeral.subtype,
    };
  }

  const nominalProfile = detectNominalClass(requestedWord);
  const verbAnalysis = detectVerbAnalysis(requestedWord);

  if (isParticipleLikeAnalysis(verbAnalysis)) {
    const morphology = guessSimpleMorphology(requestedWord);
    const baseReference = guessSingularDisplayForm(requestedWord);
    const verbBase = verbAnalysis?.baseForm ?? baseReference;

    return {
      alternateClassIds: ["verbo"],
      baseForm: baseReference,
      confidence: nominalProfile?.classId === "adjetivo" ? "alta" : "media",
      flexionLines: [
        `- **Forma de referÃªncia:** ${titleCaseWord(baseReference)}.`,
        ...(morphology.gender ? [`- **GÃªnero provÃ¡vel:** ${morphology.gender}.`] : []),
        `- **NÃºmero:** ${morphology.number}.`,
        `- **Forma-base verbal:** ${verbBase}.`,
        "- **Leitura morfolÃ³gica:** particÃ­pio com uso adjetival provÃ¡vel.",
        "- **ObservaÃ§Ã£o:** em portuguÃªs, muitos particÃ­pios entram no uso corrente como adjetivos.",
      ],
      primaryClassId: "adjetivo",
      primarySummary:
        `Em formas como "${requestedWord}", a consulta gramatical costuma ficar mais Ãºtil quando a leitura inicial Ã© adjetiva, sem perder o vÃ­nculo com o verbo de origem.`,
      subtype: "adjetivo qualificativo",
    };
  }

  if (nominalProfile && (!verbAnalysis || verbAnalysis.confidence !== "alta")) {
    return {
      alternateClassIds: verbAnalysis ? ["verbo"] : [],
      baseForm:
        nominalProfile.classId === "substantivo"
          ? guessSingularDisplayForm(requestedWord)
          : lowerCaseWord(requestedWord),
      confidence: "alta",
      flexionLines: buildNominalFlexionLines(
        requestedWord,
        nominalProfile.classId,
        nominalProfile.subtype,
      ),
      primaryClassId: nominalProfile.classId,
      primarySummary: nominalProfile.summary,
      subtype: nominalProfile.subtype,
    };
  }

  if (verbAnalysis) {
    return {
      alternateClassIds: nominalProfile ? [nominalProfile.classId] : [],
      baseForm: verbAnalysis.baseForm,
      confidence: verbAnalysis.confidence,
      flexionLines: verbAnalysis.flexionLines,
      primaryClassId: "verbo",
      primarySummary: verbAnalysis.summary,
      subtype: "forma verbal",
    };
  }

  const defaultMorphology = guessSimpleMorphology(requestedWord);

  return {
    alternateClassIds: defaultMorphology.gender ? ["adjetivo"] : [],
    baseForm: guessSingularDisplayForm(requestedWord),
    confidence: "media",
    flexionLines: buildNominalFlexionLines(requestedWord, "substantivo"),
    primaryClassId: "substantivo",
    primarySummary:
      `Sem um contexto sintatico maior, a leitura nominal de "${requestedWord}" e a mais segura para consulta imediata.`,
    subtype: STRONG_ABSTRACT_NOUN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
      ? "substantivo abstrato"
      : "substantivo comum",
  };
}

function extractDictionaryGrammarText(source: DictionarySourceResult) {
  return [
    source.note ?? "",
    ...source.sections.map((section) => section.text ?? ""),
  ]
    .map((value) => normalizeInlineText(value))
    .filter(Boolean)
    .join("\n");
}

function extractGrammarCueLines(source: DictionarySourceResult) {
  const sections = source.sections
    .map((section) => normalizeInlineText(section.text ?? ""))
    .filter(Boolean);
  const allLines = sections
    .flatMap((section) => section.split("\n"))
    .map((line) => normalizeInlineText(line))
    .filter(Boolean);

  if (source.sourceId === "priberam") {
    return allLines
      .slice(0, 6)
      .filter((line) =>
        /^(?:nome|adjetivo|adv[eÃ©]rbio|verbo|pronome|numeral|preposi[cÃ§][aÃ£]o|conjun[cÃ§][aÃ£]o|interjei[cÃ§][aÃ£]o|artigo)\b/i.test(
          line,
        ),
      );
  }

  if (source.sourceId === "infopedia") {
    return allLines
      .slice(0, 10)
      .filter(
        (line) =>
          /^(?:nome|adjetivo|adv[eÃ©]rbio|verbo|determinante|pronome|numeral|preposi[cÃ§][aÃ£]o|conjun[cÃ§][aÃ£]o|interjei[cÃ§][aÃ£]o|artigo)\b/i.test(
            line,
          ),
      );
  }

  if (source.sourceId === "aulete") {
    const cueLines: string[] = [];

    for (const line of allLines.slice(0, 12)) {
      if (/^\d+[.)]?\s/u.test(line)) {
        break;
      }

      if (
        /^(?:v\.\s*$|v\.\s*(?:intr|int|tr|td|ti|ta|t[dp]|pron)\b|s\.\s*(?:m|f|2g)\.?\s*$|sm\.?\s*$|sf\.?\s*$|s2g\.?\s*$|adj\.?\s*$|a\.\s*$|a2g\.?\s*$|pron\.?\s*$|pr\.\s*(?:indef|dem|poss|rel|interrog|interr|pess|trat)\.?\s*$|prep\.?\s*$|conj\.?\s*$|conj\.\s*(?:adit|advers|altern|conclus|explic|integr|compar|condic|concess|caus|temp|final|conform)\.?\s*$|interj\.?\s*$|adv\.?\s*$)$/iu.test(
          line,
        )
      ) {
        cueLines.push(line);
      }
    }

    return cueLines;
  }

  return allLines.slice(0, 6);
}

function inferAuleteClasses(source: DictionarySourceResult): GrammarDictionaryEvidence {
  const updatedSection = source.sections.find((section) => section.label === "Atualizado");
  const traditionalSection = source.sections.find((section) => section.label === "Tradicional");
  const text = normalizeSearchText(
    normalizeLineText(
      [updatedSection?.text ?? "", traditionalSection?.text ?? ""].filter(Boolean).join("\n"),
    ),
  );
  const classes = new Set<GrammarClassId>();
  const counts: Partial<Record<GrammarClassId, number>> = {};
  const addClass = (classId: GrammarClassId) => {
    classes.add(classId);
    counts[classId] = (counts[classId] ?? 0) + 1;
  };

  const separatorBoundary = String.raw`(?:^|[|\n])\s*(?:-\s*,?\s*)?`;
  const matchAndAdd = (pattern: RegExp, classId: GrammarClassId) => {
    if (pattern.test(text)) {
      addClass(classId);
    }
  };

  matchAndAdd(
    new RegExp(
      String.raw`${separatorBoundary}v\.(?:\s*(?:intr|int|tr|td|ti|ta|t[dp]|pron))?\s*(?=[|\n]|$)`,
      "iu",
    ),
    "verbo",
  );
  matchAndAdd(
    new RegExp(
      String.raw`${separatorBoundary}(?:sm\.|sf\.|s2g\.|s\.m\.|s\.f\.|s\. ?2g\.|s\.\s*(?:m|f|2g)\.?)\s*(?=[|\n]|$)`,
      "iu",
    ),
    "substantivo",
  );
  matchAndAdd(
    new RegExp(String.raw`${separatorBoundary}(?:adj\.|a\.|a2g\.)\s*(?=[|\n]|$)`, "iu"),
    "adjetivo",
  );
  matchAndAdd(
    new RegExp(String.raw`${separatorBoundary}adv\.\s*(?=[|\n]|$)`, "iu"),
    "adverbio",
  );
  matchAndAdd(
    new RegExp(String.raw`${separatorBoundary}prep\.\s*(?=[|\n]|$)`, "iu"),
    "preposicao",
  );
  matchAndAdd(
    new RegExp(
      String.raw`${separatorBoundary}(?:pron\.|pr\.(?:indef|dem|poss|rel|interrog|interr|pess|trat)\.?)\s*(?=[|\n]|$)`,
      "iu",
    ),
    "pronome",
  );
  matchAndAdd(
    new RegExp(
      String.raw`${separatorBoundary}(?:conj\.|conj\.(?:adit|advers|altern|conclus|explic|integr|compar|condic|concess|caus|temp|final|conform)\.?)\s*(?=[|\n]|$)`,
      "iu",
    ),
    "conjuncao",
  );
  matchAndAdd(
    new RegExp(String.raw`${separatorBoundary}interj\.\s*(?=[|\n]|$)`, "iu"),
    "interjeicao",
  );
  matchAndAdd(
    new RegExp(String.raw`${separatorBoundary}art\.\s*(?=[|\n]|$)`, "iu"),
    "artigo",
  );

  return { classes: [...classes], counts };
}

function isInfinitiveLikeWord(value: string) {
  const normalized = lowerCaseWord(value);
  return /(?:ar|er|ir)$/.test(normalized);
}

function chooseGrammarCanonicalWord(
  requestedWord: string,
  analysis: GrammarAnalysis,
  sources: DictionarySourceResult[],
) {
  const preferredSourceOrder = ["Aulete", "Priberam", "Infopédia"];
  const normalizedRequested = normalizeSearchText(requestedWord);
  const auleteSource = sources.find((source) => source.label === "Aulete");
  const auleteCanonical = normalizeInlineText(auleteSource?.canonicalWord ?? "");

  if (auleteSource?.status === "found" && auleteCanonical) {
    return auleteCanonical;
  }

  const rankedSources = [...sources]
    .filter((source) => source.status === "found")
    .sort(
      (left, right) =>
        preferredSourceOrder.indexOf(left.label) - preferredSourceOrder.indexOf(right.label),
    );

  for (const source of rankedSources) {
    const candidate = normalizeInlineText(source.canonicalWord ?? "");

    if (!candidate) {
      continue;
    }

    if (
      isInfinitiveLikeWord(candidate) &&
      normalizeSearchText(candidate) !== normalizedRequested
    ) {
      return candidate;
    }
  }

  return analysis.baseForm || requestedWord;
}

function inferClassesFromDictionarySource(
  source: DictionarySourceResult,
): GrammarDictionaryEvidence {
  if (source.status !== "found") {
    return { classes: [], counts: {} };
  }

  if (source.sourceId === "aulete") {
    return inferAuleteClasses(source);
  }

  const text = extractGrammarCueLines(source).join("\n");
  const found: GrammarClassId[] = [];
  const counts: Partial<Record<GrammarClassId, number>> = {};

  for (const entry of DICTIONARY_GRAMMAR_PATTERNS) {
    const hits = entry.patterns.reduce(
      (total, pattern) => total + (pattern.test(text) ? 1 : 0),
      0,
    );

    if (hits > 0) {
      found.push(entry.classId);
      counts[entry.classId] = hits;
    }
  }

  return { classes: [...new Set(found)], counts };
}

function resolveGrammarClassPossibilities(
  analysis: GrammarAnalysis,
  word: string,
  sources: DictionarySourceResult[],
) {
  const auleteSource = sources.find((source) => source.sourceId === "aulete");
  const auleteEvidence = auleteSource
    ? inferClassesFromDictionarySource(auleteSource)
    : { classes: [], counts: {} };

  if (auleteEvidence.classes.length > 0) {
    return auleteEvidence.classes;
  }

  const scoreMap = new Map<GrammarClassId, number>();
  const dictionaryEvidenceCount = new Map<GrammarClassId, number>();
  const addScore = (classId: GrammarClassId, score: number) => {
    scoreMap.set(classId, (scoreMap.get(classId) ?? 0) + score);
  };

  addScore(analysis.primaryClassId, 2);

  for (const classId of analysis.alternateClassIds) {
    addScore(classId, 1);
  }

  for (const sourceResult of sources) {
    const evidence = inferClassesFromDictionarySource(sourceResult);

    for (const classId of evidence.classes) {
      addScore(classId, 4);
      dictionaryEvidenceCount.set(
        classId,
        (dictionaryEvidenceCount.get(classId) ?? 0) + (evidence.counts[classId] ?? 1),
      );
    }
  }

  const hasDictionaryClasses = dictionaryEvidenceCount.size > 0;

  if (
    sources.some(
      (source) =>
        source.status === "found" &&
        isInfinitiveLikeWord(source.canonicalWord ?? "") &&
        normalizeSearchText(source.canonicalWord ?? "") !== normalizeSearchText(word),
    )
  ) {
    addScore("verbo", 6);
  }

  const ranked = [...scoreMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([classId, score]) => ({ classId, score }));

  if (ranked.length === 0) {
    return [analysis.primaryClassId];
  }

  const bestScore = ranked[0]?.score ?? 0;

  return ranked
    .filter((item, index) => {
      if (index === 0) {
        return true;
      }

      const dictionaryHits = dictionaryEvidenceCount.get(item.classId) ?? 0;

      if (hasDictionaryClasses) {
        return dictionaryHits >= 1;
      }

      return (
        (item.score >= bestScore - 1 && item.score >= 3) ||
        dictionaryHits >= 1
      );
    })
    .slice(0, 6)
    .map((item) => item.classId);
}

function buildSingleClassDefinition(classId: GrammarClassId) {
  const reference = GRAMMAR_REFERENCES[classId];
  const overview = repairGrammarMojibake(reference.overview);
  const bullets = reference.bullets.map((bullet) => repairGrammarMojibake(bullet));
  const nuance = reference.nuance ? repairGrammarMojibake(reference.nuance) : null;

  return [
    overview,
    "",
    ...bullets.map((bullet) => `- ${bullet}`),
    nuance ? "" : null,
    nuance,
  ].filter((line): line is string => Boolean(line));
}

function buildClassSection(classIds: GrammarClassId[]) {
  const possibleClassesLine =
    classIds.length > 0
      ? `Classes poss\u00edveis: ${classIds
          .map((classId) => repairGrammarMojibake(GRAMMAR_REFERENCES[classId].heading))
          .join(", ")}.`
      : null;

  const classBlocks = classIds.flatMap((classId, index) => [
    ...(index > 0 ? ["", ""] : []),
    ...buildSingleClassDefinition(classId),
  ]);

  const lines = [
    ...(possibleClassesLine ? [possibleClassesLine, ""] : []),
    ...classBlocks,
  ];

  return buildSection("Classe", lines.join("\n"));
}

function buildConjugationSectionFromAnalysis(analysis: GrammarAnalysis) {
  const sanitizedFlexionLines = analysis.flexionLines.filter(
    (line) => !/\*\*Observa(?:cao|ç(?:a|ã)o)(?: principal)?:\*\*/iu.test(line),
  );
  const lines = [...sanitizedFlexionLines];

  return buildSection("Classifica\u00e7\u00e3o", lines.join("\n"));
}

export function buildGrammarConjugationSection(word: string) {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const analysis = analyzeWord(requestedWord);
  return buildConjugationSectionFromAnalysis(analysis);
}

export async function lookupGrammarLocal(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));

  if (detectLookupLanguage(requestedWord, context) === "latin") {
    return lookupLatinGrammarLocal(requestedWord);
  }

  if (!requestedWord || !LOOKUPABLE_WORD_PATTERN.test(requestedWord)) {
    return buildResult(
      requestedWord,
      "not_found",
      "NÃ£o consegui montar um recorte gramatical seguro para esta seleÃ§Ã£o.",
      [],
    );
  }

  const analysis = analyzeWord(requestedWord);
  const dictionarySources = (
    await Promise.allSettled([
      lookupAulete(requestedWord),
      lookupPriberam(requestedWord),
      lookupInfopedia(requestedWord),
    ])
  )
    .filter(
      (
        item,
      ): item is PromiseFulfilledResult<DictionarySourceResult> =>
        item.status === "fulfilled",
    )
    .map((item) => item.value);
  const auleteSource = dictionarySources.find((source) => source.sourceId === "aulete");

  if (auleteSource?.status === "not_found") {
    return buildResult(
      requestedWord,
      "not_found",
      `O Aulete nao encontrou um verbete direto para "${requestedWord}".`,
      [],
      requestedWord,
    );
  }
  const classIds = resolveGrammarClassPossibilities(
    analysis,
    requestedWord,
    dictionarySources,
  );
  const canonicalWord = chooseGrammarCanonicalWord(
    requestedWord,
    analysis,
    dictionarySources,
  );
  const forcedVerbAnalysis =
    classIds.includes("verbo") &&
    analysis.primaryClassId !== "verbo" &&
    isInfinitiveLikeWord(canonicalWord)
      ? detectVerbAnalysis(requestedWord, canonicalWord)
      : null;
  const effectiveAnalysis =
    forcedVerbAnalysis
      ? {
          alternateClassIds: analysis.alternateClassIds,
          baseForm: forcedVerbAnalysis.baseForm,
          confidence: forcedVerbAnalysis.confidence,
          flexionLines: forcedVerbAnalysis.flexionLines,
          primaryClassId: "verbo" as const,
          primarySummary: forcedVerbAnalysis.summary,
          subtype: "forma verbal",
        }
      : analysis;
  const sections = [buildClassSection(classIds)];

  return buildResult(
    requestedWord,
    "found",
    `Recorte gramatical organizado a partir da ${GRAMMAR_SOURCE_TITLE}, de ${GRAMMAR_SOURCE_AUTHORS}.`,
    sections,
    canonicalWord,
  );
}

