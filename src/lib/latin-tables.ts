import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml, normalizeLineText, repairMojibake } from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const VERB_TABLES_PATH = join(process.cwd(), "data", "latin", "verb-tables.txt");

type TableMatrix = {
  columns: string[];
  rows: Array<{ cells: string[]; header: string }>;
};

declare global {
  // eslint-disable-next-line no-var
  var __latinVerbTablesPromise: Promise<string> | undefined;
}

const DECLINATION_SINGULAR: TableMatrix = {
  columns: ["Casus", "1ª decl.", "2ª decl.", "2ª decl. neut.", "3ª decl.", "3ª decl. neut.", "4ª decl.", "4ª decl. neut.", "5ª decl."],
  rows: [
    { header: "Nominativus", cells: ["-a", "-us, -er, -ir", "-um", "variável", "variável", "-us", "-ū", "-ēs"] },
    { header: "Vocativus", cells: ["-a", "-e, -ī, = nom.", "-um", "= nom.", "= nom.", "= nom.", "-ū", "-ēs"] },
    { header: "Accusativus", cells: ["-am", "-um", "-um", "-em", "= nom.", "-um", "-ū", "-em"] },
    { header: "Genitivus", cells: ["-ae", "-ī", "-ī", "-is", "-is", "-ūs", "-ūs", "-ēī"] },
    { header: "Dativus", cells: ["-ae", "-ō", "-ō", "-ī", "-ī", "-uī / -ū", "-ū", "-ēī"] },
    { header: "Ablativus", cells: ["-ā", "-ō", "-ō", "-e", "-e", "-ū", "-ū", "-ē"] },
  ],
};

const DECLINATION_PLURAL: TableMatrix = {
  columns: ["Casus", "1ª decl.", "2ª decl.", "2ª decl. neut.", "3ª decl.", "3ª decl. neut.", "4ª decl.", "4ª decl. neut.", "5ª decl."],
  rows: [
    { header: "Nominativus", cells: ["-ae", "-ī", "-a", "-ēs", "-a", "-ūs", "-ua", "-ēs"] },
    { header: "Vocativus", cells: ["-ae", "-ī", "-a", "-ēs", "-a", "-ūs", "-ua", "-ēs"] },
    { header: "Accusativus", cells: ["-ās", "-ōs", "-a", "-ēs", "-a", "-ūs", "-ua", "-ēs"] },
    { header: "Genitivus", cells: ["-ārum", "-ōrum", "-ōrum", "-um", "-um", "-uum", "-uum", "-ērum"] },
    { header: "Dativus", cells: ["-īs", "-īs", "-īs", "-ibus", "-ibus", "-ibus", "-ibus", "-ēbus"] },
    { header: "Ablativus", cells: ["-īs", "-īs", "-īs", "-ibus", "-ibus", "-ibus", "-ibus", "-ēbus"] },
  ],
};

const PRONOUN_TABLES = [
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["hic", "haec", "hoc"] },
            { header: "Acusativo", cells: ["hunc", "hanc", "hoc"] },
            { header: "Genitivo", cells: ["huius", "huius", "huius"] },
            { header: "Dativo", cells: ["huic", "huic", "huic"] },
            { header: "Ablativo", cells: ["hōc", "hāc", "hōc"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["hī", "hae", "haec"] },
            { header: "Acusativo", cells: ["hōs", "hās", "haec"] },
            { header: "Genitivo", cells: ["hōrum", "hārum", "hōrum"] },
            { header: "Dativo", cells: ["hīs", "hīs", "hīs"] },
            { header: "Ablativo", cells: ["hīs", "hīs", "hīs"] },
          ],
        },
      },
    ],
    heading: "hic, haec, hoc",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["ille", "illa", "illud"] },
            { header: "Acusativo", cells: ["illum", "illam", "illud"] },
            { header: "Genitivo", cells: ["illīus", "illīus", "illīus"] },
            { header: "Dativo", cells: ["illī", "illī", "illī"] },
            { header: "Ablativo", cells: ["illō", "illā", "illō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["illī", "illae", "illa"] },
            { header: "Acusativo", cells: ["illōs", "illās", "illa"] },
            { header: "Genitivo", cells: ["illōrum", "illārum", "illōrum"] },
            { header: "Dativo", cells: ["illīs", "illīs", "illīs"] },
            { header: "Ablativo", cells: ["illīs", "illīs", "illīs"] },
          ],
        },
      },
    ],
    heading: "ille, illa, illud",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["is", "ea", "id"] },
            { header: "Acusativo", cells: ["eum", "eam", "id"] },
            { header: "Genitivo", cells: ["eius", "eius", "eius"] },
            { header: "Dativo", cells: ["eī", "eī", "eī"] },
            { header: "Ablativo", cells: ["eō", "eā", "eō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["eī / iī / ī", "eae", "ea"] },
            { header: "Acusativo", cells: ["eōs", "eās", "ea"] },
            { header: "Genitivo", cells: ["eōrum", "eārum", "eōrum"] },
            { header: "Dativo", cells: ["eīs / iīs / īs", "eīs / iīs / īs", "eīs / iīs / īs"] },
            { header: "Ablativo", cells: ["eīs / iīs / īs", "eīs / iīs / īs", "eīs / iīs / īs"] },
          ],
        },
      },
    ],
    heading: "is, ea, id",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["quī", "quae", "quod"] },
            { header: "Acusativo", cells: ["quem", "quam", "quod"] },
            { header: "Genitivo", cells: ["cuius", "cuius", "cuius"] },
            { header: "Dativo", cells: ["cuī", "cuī", "cuī"] },
            { header: "Ablativo", cells: ["quō", "quā", "quō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["quī", "quae", "quae"] },
            { header: "Acusativo", cells: ["quōs", "quās", "quae"] },
            { header: "Genitivo", cells: ["quōrum", "quārum", "quōrum"] },
            { header: "Dativo", cells: ["quibus", "quibus", "quibus"] },
            { header: "Ablativo", cells: ["quibus", "quibus", "quibus"] },
          ],
        },
      },
    ],
    heading: "quī, quae, quod",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino/Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["quis", "quid"] },
            { header: "Acusativo", cells: ["quem", "quid"] },
            { header: "Genitivo", cells: ["cuius", "cuius"] },
            { header: "Dativo", cells: ["cuī", "cuī"] },
            { header: "Ablativo", cells: ["quō", "quō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["quī", "quae", "quae"] },
            { header: "Acusativo", cells: ["quōs", "quās", "quae"] },
            { header: "Genitivo", cells: ["quōrum", "quārum", "quōrum"] },
            { header: "Dativo", cells: ["quibus", "quibus", "quibus"] },
            { header: "Ablativo", cells: ["quibus", "quibus", "quibus"] },
          ],
        },
      },
    ],
    heading: "quis, quid",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["nullus", "nulla", "nullum"] },
            { header: "Acusativo", cells: ["nullum", "nullam", "nullum"] },
            { header: "Genitivo", cells: ["nullīus", "nullīus", "nullīus"] },
            { header: "Dativo", cells: ["nullī", "nullī", "nullī"] },
            { header: "Ablativo", cells: ["nullō", "nullā", "nullō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["nullī", "nullae", "nulla"] },
            { header: "Acusativo", cells: ["nullōs", "nullās", "nulla"] },
            { header: "Genitivo", cells: ["nullōrum", "nullārum", "nullōrum"] },
            { header: "Dativo", cells: ["nullīs", "nullīs", "nullīs"] },
            { header: "Ablativo", cells: ["nullīs", "nullīs", "nullīs"] },
          ],
        },
      },
    ],
    heading: "nullus, nulla, nullum",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["ipse", "ipsa", "ipsum"] },
            { header: "Acusativo", cells: ["ipsum", "ipsam", "ipsum"] },
            { header: "Genitivo", cells: ["ipsīus", "ipsīus", "ipsīus"] },
            { header: "Dativo", cells: ["ipsī", "ipsī", "ipsī"] },
            { header: "Ablativo", cells: ["ipsō", "ipsā", "ipsō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["ipsī", "ipsae", "ipsa"] },
            { header: "Acusativo", cells: ["ipsōs", "ipsās", "ipsa"] },
            { header: "Genitivo", cells: ["ipsōrum", "ipsārum", "ipsōrum"] },
            { header: "Dativo", cells: ["ipsīs", "ipsīs", "ipsīs"] },
            { header: "Ablativo", cells: ["ipsīs", "ipsīs", "ipsīs"] },
          ],
        },
      },
    ],
    heading: "ipse, ipsa, ipsum",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["iste", "ista", "istud"] },
            { header: "Acusativo", cells: ["istum", "istam", "istud"] },
            { header: "Genitivo", cells: ["istīus", "istīus", "istīus"] },
            { header: "Dativo", cells: ["istī", "istī", "istī"] },
            { header: "Ablativo", cells: ["istō", "istā", "istō"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["istī", "istae", "ista"] },
            { header: "Acusativo", cells: ["istōs", "istās", "ista"] },
            { header: "Genitivo", cells: ["istōrum", "istārum", "istōrum"] },
            { header: "Dativo", cells: ["istīs", "istīs", "istīs"] },
            { header: "Ablativo", cells: ["istīs", "istīs", "istīs"] },
          ],
        },
      },
    ],
    heading: "iste, ista, istud",
  },
  {
    forms: [
      {
        label: "Singular",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["īdem", "eadem", "idem"] },
            { header: "Acusativo", cells: ["eundem", "eandem", "idem"] },
            { header: "Genitivo", cells: ["eiusdem", "eiusdem", "eiusdem"] },
            { header: "Dativo", cells: ["eīdem", "eīdem", "eīdem"] },
            { header: "Ablativo", cells: ["eōdem", "eādem", "eōdem"] },
          ],
        },
      },
      {
        label: "Plural",
        matrix: {
          columns: ["Caso", "Masculino", "Feminino", "Neutro"],
          rows: [
            { header: "Nominativo", cells: ["eīdem / iīdem / īdem", "eaedem", "eadem"] },
            { header: "Acusativo", cells: ["eōsdem", "eāsdem", "eadem"] },
            { header: "Genitivo", cells: ["eōrundem", "eārundem", "eōrundem"] },
            { header: "Dativo", cells: ["eīsdem / iīsdem / īsdem", "eīsdem / iīsdem / īsdem", "eīsdem / iīsdem / īsdem"] },
            { header: "Ablativo", cells: ["eīsdem / iīsdem / īsdem", "eīsdem / iīsdem / īsdem", "eīsdem / iīsdem / īsdem"] },
          ],
        },
      },
    ],
    heading: "īdem, eadem, idem",
  },
  {
    forms: [
      {
        label: "Pessoas",
        matrix: {
          columns: ["Caso", "Ego", "Nós", "Tu", "Vós", "Reflexivo"],
          rows: [
            { header: "Nominativo", cells: ["egō", "nōs", "tū", "vōs", "—"] },
            { header: "Acusativo", cells: ["mē", "nōs", "tē", "vōs", "sē"] },
            { header: "Genitivo", cells: ["meī", "nostrī / nostrum", "tuī", "vestrī / vestrum", "suī"] },
            { header: "Dativo", cells: ["mihi", "nōbīs", "tibi", "vōbīs", "sibi"] },
            { header: "Ablativo", cells: ["mē", "nōbīs", "tē", "vōbīs", "sē"] },
          ],
        },
      },
    ],
    heading: "ego, tū, sē",
  },
];

function fixLatinText(value: string) {
  const repaired = repairMojibake(value) ?? value;
  const replacements: Array<[string, string]> = [
    ["Ã§", "ç"],
    ["Ã£", "ã"],
    ["Ã¡", "á"],
    ["Ã¢", "â"],
    ["Ã©", "é"],
    ["Ãª", "ê"],
    ["Ã­", "í"],
    ["Ã³", "ó"],
    ["Ã´", "ô"],
    ["Ãº", "ú"],
    ["Âª", "ª"],
    ["Âº", "º"],
    ["Âª", "ª"],
    ["Ã§", "ç"],
    ["Ã£", "ã"],
    ["Ã¡", "á"],
    ["Ã¢", "â"],
    ["Ã©", "é"],
    ["Ãª", "ê"],
    ["Ã­", "í"],
    ["Ã³", "ó"],
    ["Ã´", "ô"],
    ["Ãº", "ú"],
    ["Ã‰", "É"],
    ["Ã“", "Ó"],
    ["Ãš", "Ú"],
    ["â€”", "—"],
    ["â†’", "→"],
    ["Â·", "·"],
    ["Å", "ō"],
    ["Å", "Ō"],
    ["Å«", "ū"],
    ["Åª", "Ū"],
    ["Å", "ō"],
    ["Ä", "ā"],
    ["Ä€", "Ā"],
    ["Ä“", "ē"],
    ["Ä’", "Ē"],
    ["Ä«", "ī"],
    ["Äª", "Ī"],
    ["Ä•", "ĕ"],
    ["Ä”", "Ĕ"],
  ];

  return replacements.reduce((current, [search, replacement]) => {
    return current.split(search).join(replacement);
  }, repaired).normalize("NFC");
}

function fixMatrix(matrix: TableMatrix): TableMatrix {
  return {
    columns: matrix.columns.map(fixLatinText),
    rows: matrix.rows.map((row) => ({
      cells: row.cells.map(fixLatinText),
      header: fixLatinText(row.header),
    })),
  };
}

function escape(value: string) {
  return escapeHtml(fixLatinText(value));
}

function renderInline(value: string) {
  const escaped = escape(value);
  return escaped.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}

function renderMatrix(matrix: TableMatrix) {
  const fixed = fixMatrix(matrix);
  return [
    `<div class="lookupMatrixWrap">`,
    `<table class="lookupMatrix">`,
    "<thead>",
    "<tr>",
    ...fixed.columns.map((column) => `<th>${escape(column)}</th>`),
    "</tr>",
    "</thead>",
    "<tbody>",
    ...fixed.rows.map(
      (row) =>
        `<tr><th scope="row">${escape(row.header)}</th>${row.cells
          .map((cell) => `<td>${escape(cell)}</td>`)
          .join("")}</tr>`,
    ),
    "</tbody>",
    "</table>",
    "</div>",
  ].join("");
}

function renderDeclinationesHtml() {
  return [
    `<div class="lookupEntry">`,
    `<div class="lookupEntryTitle">Singular</div>`,
    renderMatrix(DECLINATION_SINGULAR),
    `</div>`,
    `<div class="lookupEntry">`,
    `<div class="lookupEntryTitle">Plural</div>`,
    renderMatrix(DECLINATION_PLURAL),
    `</div>`,
  ].join("");
}

function renderPronounsHtml() {
  return PRONOUN_TABLES.map((table) =>
    [
      `<div class="lookupEntry">`,
      `<div class="lookupEntryTitle">${escape(fixLatinText(table.heading))}</div>`,
      ...table.forms.map((form) => [
        `<div class="lookupEntryMeta">${escape(fixLatinText(form.label))}</div>`,
        renderMatrix(form.matrix),
      ].join("")),
      `</div>`,
    ].join(""),
  ).join("");
}

function stringifyMatrix(matrix: TableMatrix) {
  const fixed = fixMatrix(matrix);
  const lines = [
    fixed.columns.join("\t"),
    ...fixed.rows.map((row) => [row.header, ...row.cells].join("\t")),
  ];
  return lines.join("\n");
}

function renderVerbCodeBlock(rawBlock: string) {
  const lines = fixLatinText(rawBlock)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const tableRows = lines.map((line) => line.split(/\s{2,}/u).filter(Boolean));
  const isUniformTable =
    tableRows.length >= 2 &&
    tableRows[0]!.length >= 2 &&
    tableRows.every((row) => row.length === tableRows[0]!.length) &&
    tableRows[0]!.length <= 6;

  if (tableRows.length >= 2 && tableRows.every((row) => row.length === 1)) {
    const [heading, ...items] = lines;

    return [
      `<div class="latinVerbList">`,
      heading?.startsWith("→")
        ? `<div class="lookupEntryMeta">${escape(heading)}</div>`
        : `<div class="lookupSectionLabel">${escape(heading ?? "Formas")}</div>`,
      `<table class="lookupMatrix latinVerbListTable">`,
      "<tbody>",
      ...items.map((item) => `<tr><td>${renderInline(item)}</td></tr>`),
      "</tbody>",
      "</table>",
      "</div>",
    ].join("");
  }

  if (!isUniformTable) {
    return [
      `<div class="latinVerbList">`,
      `<table class="lookupMatrix latinVerbListTable">`,
      "<tbody>",
      ...lines.map((line) => `<tr><td>${renderInline(line)}</td></tr>`),
      "</tbody>",
      "</table>",
      "</div>",
    ].join("");
  }

  const [header, ...body] = tableRows;

  return [
    `<div class="lookupMatrixWrap">`,
    `<table class="lookupMatrix">`,
    "<thead>",
    "<tr>",
    ...header.map((column) => `<th>${escape(column)}</th>`),
    "</tr>",
    "</thead>",
    "<tbody>",
    ...body.map(
      (row) =>
        `<tr><th scope="row">${escape(row[0] ?? "")}</th>${row
          .slice(1)
          .map((cell) => `<td>${escape(cell)}</td>`)
          .join("")}</tr>`,
    ),
    "</tbody>",
    "</table>",
    "</div>",
  ].join("");
}

function renderVerbTablesHtml(raw: string) {
  const text = fixLatinText(raw).replace(/\r/g, "").trim();
  const lines = text.split("\n");
  const htmlParts: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "```text") {
      inCode = true;
      codeLines = [];
      continue;
    }

    if (trimmed === "```") {
      htmlParts.push(renderVerbCodeBlock(codeLines.join("\n")));
      inCode = false;
      codeLines = [];
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed || /^---+$/u.test(trimmed)) {
      continue;
    }

    if (/^#{1,3}\s+/u.test(trimmed)) {
      const level = trimmed.match(/^#+/u)?.[0].length ?? 1;
      const label = trimmed.replace(/^#{1,3}\s+/u, "").replace(/\*\*/gu, "").trim();
      const className =
        level === 1 ? "lookupEntryTitle" : level === 2 ? "lookupEntryMeta" : "lookupSectionLabel";
      htmlParts.push(`<div class="${className}">${escape(label)}</div>`);
      continue;
    }

    htmlParts.push(`<p>${renderInline(trimmed)}</p>`);
  }

  return `<div class="lookupEntry">${htmlParts.join("")}</div>`;
}

function buildSection(label: string, html: string, text: string): LookupSection {
  return {
    html,
    label,
    text,
  };
}

function buildResult(requestedWord: string, sections: LookupSection[]): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: "Tabelas Latinas",
    note: fixLatinText("Quadro morfológico latino para consulta rápida."),
    sections,
    sourceId: "tabelas",
    sourceUrl: null,
    status: "found",
  };
}

async function loadVerbTables() {
  if (!globalThis.__latinVerbTablesPromise) {
    globalThis.__latinVerbTablesPromise = readFile(VERB_TABLES_PATH, "utf8").then((raw) =>
      fixLatinText(raw.normalize("NFC").replace(/\r/g, "").trim()),
    );
  }

  return globalThis.__latinVerbTablesPromise;
}

export async function lookupLatinTables(word: string): Promise<DictionarySourceResult> {
  const requestedWord = word.normalize("NFC").trim();
  const verbTables = await loadVerbTables();

  return buildResult(requestedWord, [
    buildSection(
      "Declinationes",
      renderDeclinationesHtml(),
      normalizeLineText(
        ["Singular", stringifyMatrix(DECLINATION_SINGULAR), "", "Plural", stringifyMatrix(DECLINATION_PLURAL)].join("\n"),
      ),
    ),
    buildSection(
      "Pronomina",
      renderPronounsHtml(),
      normalizeLineText(
        PRONOUN_TABLES.map((table) =>
          [
            fixLatinText(table.heading),
            ...table.forms.map((form) => `${fixLatinText(form.label)}\n${stringifyMatrix(form.matrix)}`),
          ].join("\n\n"),
        ).join("\n\n"),
      ),
    ),
    buildSection("Verba", renderVerbTablesHtml(verbTables), normalizeLineText(verbTables)),
  ]);
}
