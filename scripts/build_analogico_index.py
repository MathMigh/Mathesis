from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader


INDEX_START_PAGE = 541
CONCEPT_START_PAGE = 11
MAX_GROUP_NUMBER = 1000
LETTER_RE = re.compile(r"[A-Za-zÀ-ÿ]")
RAW_REF_RE = re.compile(r"\d{1,4}[a-z]?")


def normalize_lookup_key(value: str) -> str:
    compact = " ".join(value.replace("\u00ad", "").split()).strip().lower()
    return "".join(
        character
        for character in unicodedata.normalize("NFD", compact)
        if unicodedata.category(character) != "Mn"
    )


def clean_page_text(value: str) -> str:
    value = value.replace("\u00ad\n", "")
    value = value.replace("\u00ad", "")
    value = re.sub(r"-\n(?=\w)", "", value)
    value = value.replace("\r", "")
    return value


def normalize_ref(raw_ref: str) -> str | None:
    match = re.fullmatch(r"(\d{1,4})([a-z]?)", raw_ref)

    if not match:
        return None

    numeric = int(match.group(1))
    suffix = match.group(2)

    if numeric < 1 or numeric > MAX_GROUP_NUMBER:
        return None

    return f"{numeric}{suffix}"


def parse_index(reader: PdfReader, index_start_page: int) -> dict[str, list[dict[str, object]]]:
    grouped_entries: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))

    for zero_based_page_index in range(index_start_page - 1, len(reader.pages)):
        text = clean_page_text(reader.pages[zero_based_page_index].extract_text() or "")
        lines = [line.strip() for line in text.splitlines() if line.strip()]

        if not lines:
            continue

        header = lines[0]

        if " I " in header or "|" in header:
            lines = lines[1:]

        for line in lines:
            tokens = line.split()
            current_term_tokens: list[str] = []
            current_refs: list[str] = []
            seen_ref = False

            for token in tokens:
                extracted_refs = [
                    normalized_ref
                    for raw_ref in RAW_REF_RE.findall(token)
                    if (normalized_ref := normalize_ref(raw_ref))
                ]

                if not seen_ref:
                    if extracted_refs:
                        current_refs.extend(extracted_refs)
                        seen_ref = True
                    else:
                        current_term_tokens.append(token)
                    continue

                if extracted_refs:
                    current_refs.extend(extracted_refs)
                    continue

                term = " ".join(current_term_tokens).strip()

                if term and current_refs:
                    normalized_term = normalize_lookup_key(term)

                    if normalized_term and LETTER_RE.search(term):
                        grouped_entries[normalized_term][term].update(current_refs)

                current_term_tokens = [token]
                current_refs = []
                seen_ref = False

            term = " ".join(current_term_tokens).strip()

            if term and current_refs:
                normalized_term = normalize_lookup_key(term)

                if normalized_term and LETTER_RE.search(term):
                    grouped_entries[normalized_term][term].update(current_refs)

    output: dict[str, list[dict[str, object]]] = {}

    for normalized_term, term_map in grouped_entries.items():
        output[normalized_term] = [
            {
                "refs": sorted(
                    refs,
                    key=lambda value: (
                        int(re.match(r"\d+", value).group()),
                        value,
                    ),
                ),
                "term": term,
            }
            for term, refs in sorted(term_map.items(), key=lambda item: item[0].lower())
        ]

    return output


def extract_concept_pages(
    reader: PdfReader,
    concept_start_page: int,
    index_start_page: int,
) -> list[dict[str, object]]:
    concept_pages: list[dict[str, object]] = []

    for page_number in range(concept_start_page, index_start_page):
        text = clean_page_text(reader.pages[page_number - 1].extract_text() or "")
        concept_pages.append(
            {
                "page": page_number,
                "text": text,
            }
        )

    return concept_pages


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extrai um indice leve do dicionario analogico em PDF.",
    )
    parser.add_argument("pdf", type=Path, help="Caminho do PDF de origem.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data") / "analogico",
        help="Diretorio de saida para os arquivos JSON gerados.",
    )
    parser.add_argument(
        "--index-start-page",
        type=int,
        default=INDEX_START_PAGE,
        help="Pagina 1-based onde comeca o indice alfabetico.",
    )
    parser.add_argument(
        "--concept-start-page",
        type=int,
        default=CONCEPT_START_PAGE,
        help="Pagina 1-based onde comeca a parte conceitual.",
    )
    args = parser.parse_args()

    reader = PdfReader(str(args.pdf))
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    index_payload = parse_index(reader, args.index_start_page)
    concept_pages_payload = extract_concept_pages(
        reader,
        args.concept_start_page,
        args.index_start_page,
    )

    metadata_payload = {
        "conceptStartPage": args.concept_start_page,
        "indexStartPage": args.index_start_page,
        "pageCount": len(reader.pages),
        "sourcePdfName": args.pdf.name,
        "termCount": len(index_payload),
    }

    (output_dir / "index.json").write_text(
        json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_dir / "concept-pages.json").write_text(
        json.dumps(concept_pages_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Gerado em: {output_dir}")
    print(f"Termos indexados: {len(index_payload)}")
    print(f"Paginas conceituais: {len(concept_pages_payload)}")


if __name__ == "__main__":
    main()
