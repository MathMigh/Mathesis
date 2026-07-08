from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import fitz

from build_mitologico_index import (
    MAX_BOOK_PAGE,
    build_index,
    clean_column_lines,
    compute_sequence_similarity,
    finalize_entry,
    is_heading_term,
    normalize_heading,
    normalize_lookup_key,
    normalize_space,
    should_keep_entry,
    unique_values,
)


SPANISH_PT_EQUIVALENTS: dict[str, str] = {
    "Afrodita": "Afrodite",
    "Atenea": "Atena",
    "Eneas": "Eneias",
    "Heracles": "Héracles",
    "Hercules": "Hércules",
    "Orfeo": "Orfeu",
    "Perseo": "Perseu",
    "Prometeo": "Prometeu",
    "Teseo": "Teseu",
    "Ulises": "Ulisses",
}

SPANISH_HEADING_RE = re.compile(
    r"^[•·*]?\s*(?P<lemma>[A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ' -]{1,80}?)(?:\s+\([^)]{1,40}\))?\.\s*(?P<body>.*)$"
)


def load_reference_pt_names(path: Path) -> list[str]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    if not isinstance(raw, list):
        return []

    return [normalize_heading(str(value)) for value in raw if normalize_space(str(value))]


def build_reference_lookup(values: list[str]) -> dict[str, str]:
    return {
        normalize_lookup_key(value): value
        for value in values
        if normalize_lookup_key(value)
    }


def localize_heading_pt(
    heading: str,
    reference_lookup: dict[str, str],
    reference_names: list[str],
) -> str:
    normalized = normalize_heading(heading)
    lookup_key = normalize_lookup_key(normalized)

    if not lookup_key:
        return normalized

    exact = reference_lookup.get(lookup_key)

    if exact:
        return exact

    direct = SPANISH_PT_EQUIVALENTS.get(normalized)

    if direct:
        return direct

    variants = {
        normalized,
        normalized.replace("eo", "eu"),
        normalized.replace("EO", "EU"),
    }

    for variant in variants:
        matched = reference_lookup.get(normalize_lookup_key(variant))

        if matched:
            return matched

    best_name = normalized
    best_score = 0.0

    for candidate in reference_names:
        candidate_key = normalize_lookup_key(candidate)

        if not candidate_key or candidate_key[:1] != lookup_key[:1]:
            continue

        if abs(len(candidate_key) - len(lookup_key)) > 4:
            continue

        score = compute_sequence_similarity(candidate_key, lookup_key)

        if score > best_score:
            best_score = score
            best_name = candidate

    return best_name if best_score >= 0.84 else normalized


def extract_book_page_label(blocks: list[tuple]) -> int | None:
    for block in blocks:
        x0, y0, x1, y1, text, *_ = block

        if y0 > 42:
            continue

        lines = [normalize_space(line) for line in text.splitlines() if normalize_space(line)]

        for line in lines[:2]:
            digits = "".join(character for character in line if character.isdigit())

            if digits.isdigit():
                number = int(digits)

                if 1 <= number <= MAX_BOOK_PAGE:
                    return number

    return None


def split_spanish_heading_line(line: str) -> tuple[str, str] | None:
    cleaned = normalize_space(line)
    match = SPANISH_HEADING_RE.match(cleaned)

    if not match:
        return None

    lemma = normalize_space(match.group("lemma") or "").strip(" -")

    if not is_heading_term(lemma):
        return None

    body = normalize_space(match.group("body") or "")
    return normalize_heading(lemma), body


def split_page_blocks_into_columns(page: fitz.Page) -> list[list[str]]:
    rect = page.rect
    midpoint = rect.width / 2
    blocks = sorted(page.get_text("blocks", sort=True), key=lambda item: (item[1], item[0]))
    columns: list[list[str]] = [[], []]

    for block in blocks:
        x0, y0, x1, y1, text, *_ = block
        lines = [normalize_space(line) for line in text.splitlines() if normalize_space(line)]

        if not lines:
            continue

        if y0 <= 35:
            digits = "".join(character for character in lines[0] if character.isdigit())

            if digits.isdigit():
                continue

        column_index = 0 if ((x0 + x1) / 2) < midpoint else 1
        columns[column_index].extend(lines)

    return [clean_column_lines(lines) for lines in columns]


def finalize_localized_entry(
    raw_entry: dict[str, object],
    reference_lookup: dict[str, str],
    reference_names: list[str],
) -> dict[str, object]:
    entry = finalize_entry(raw_entry)
    canonical = str(entry["canonicalTerm"])
    localized = localize_heading_pt(canonical, reference_lookup, reference_names)

    if localized == canonical:
        return entry

    entry["aliases"] = unique_values(
        [
            localized,
            canonical,
            *[str(alias) for alias in entry.get("aliases", [])],
        ]
    )
    entry["canonicalTerm"] = localized
    entry["displayHeading"] = localized
    entry["id"] = f"{normalize_lookup_key(localized)}-{int(entry['startPage'])}"
    return entry


def extract_entries_from_text_layer(
    document: fitz.Document,
    start_pdf_page: int,
    end_pdf_page: int,
    reference_lookup: dict[str, str],
    reference_names: list[str],
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    current_entry: dict[str, object] | None = None

    for pdf_page_number in range(start_pdf_page, end_pdf_page + 1):
        page = document.load_page(pdf_page_number - 1)
        blocks = page.get_text("blocks", sort=True)
        book_page = extract_book_page_label(blocks)

        if not book_page or not (1 <= book_page <= MAX_BOOK_PAGE):
            continue

        for column_lines in split_page_blocks_into_columns(page):
            for line in column_lines:
                parsed_heading = split_spanish_heading_line(line)

                if parsed_heading:
                    heading, body = parsed_heading

                    if current_entry and current_entry.get("body_lines"):
                        entries.append(
                            finalize_localized_entry(
                                current_entry,
                                reference_lookup,
                                reference_names,
                            )
                        )

                    current_entry = {
                        "aliases": [heading],
                        "body_lines": [body] if body else [],
                        "canonicalTerm": heading,
                        "displayHeading": heading,
                        "endPage": book_page,
                        "startPage": book_page,
                    }
                    continue

                if current_entry:
                    current_entry["body_lines"].append(line)
                    current_entry["endPage"] = book_page

    if current_entry and current_entry.get("body_lines"):
        entries.append(
            finalize_localized_entry(
                current_entry,
                reference_lookup,
                reference_names,
            )
        )

    return entries


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extrai um índice local do Grimal em espanhol usando a camada textual do PDF.",
    )
    parser.add_argument("pdf", type=Path, help="Caminho do PDF espanhol de origem.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data") / "mitologico",
        help="Diretório de saída do índice.",
    )
    parser.add_argument(
        "--start-pdf-page",
        type=int,
        default=1,
        help="Primeira página 1-based do PDF a considerar.",
    )
    parser.add_argument(
        "--end-pdf-page",
        type=int,
        default=0,
        help="Última página 1-based do PDF a considerar. Use 0 para ir até o fim.",
    )
    parser.add_argument(
        "--reference-pt-names",
        type=Path,
        default=Path("data") / "mitologico" / "reference-pt-names.json",
        help="JSON com formas portuguesas de referência para os nomes mitológicos.",
    )
    args = parser.parse_args()

    document = fitz.open(args.pdf)
    end_pdf_page = args.end_pdf_page or len(document)
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    reference_names = load_reference_pt_names(args.reference_pt_names)
    reference_lookup = build_reference_lookup(reference_names)

    entries = extract_entries_from_text_layer(
        document,
        args.start_pdf_page,
        end_pdf_page,
        reference_lookup,
        reference_names,
    )

    filtered_entries = [
        entry
        for entry in entries
        if 1 <= int(entry["startPage"]) <= MAX_BOOK_PAGE
        and int(entry["endPage"]) <= MAX_BOOK_PAGE
        and should_keep_entry(entry)
    ]
    index = build_index(filtered_entries)
    metadata = {
        "entryCount": len(filtered_entries),
        "endPage": MAX_BOOK_PAGE,
        "ocrEngine": "PDF text layer",
        "pageCount": len(document),
        "renderScale": None,
        "sourcePdfName": args.pdf.name,
        "startPage": 1,
        "termCount": len(index),
    }

    (output_dir / "entries.json").write_text(
        json.dumps(filtered_entries, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Gerado em: {output_dir}")
    print(f"Verbetes: {len(filtered_entries)}")
    print(f"Chaves de busca: {len(index)}")


if __name__ == "__main__":
    main()
