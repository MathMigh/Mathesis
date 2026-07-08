from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import subprocess
import unicodedata
from collections import Counter
from pathlib import Path

import fitz
from PIL import Image


RENDER_SCALE = 2.0
HEADER_PATTERNS = [
    re.compile(r"^\s*(?P<page>\d{1,4})\s*/\s*(?P<label>.+?)\s*$"),
    re.compile(r"^\s*(?P<label>.+?)\s*/\s*(?P<page>\d{1,4})\s*$"),
]
HEADING_MAX_WORDS = 6
OCR_SCRIPT = Path(__file__).with_name("windows_ocr_lines.ps1")
SMALL_WORDS = {"a", "as", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou"}
TOKEN_RE = re.compile(r"[\wÀ-ÿ'-]+", re.UNICODE)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00ad", "")).strip()


def normalize_lookup_key(value: str) -> str:
    compact = normalize_space(value).lower()
    stripped = "".join(
        character
        for character in unicodedata.normalize("NFD", compact)
        if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", "", stripped)


def unique_values(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()

    for value in values:
        cleaned = normalize_space(value)
        key = normalize_lookup_key(cleaned)

        if not cleaned or not key or key in seen:
            continue

        seen.add(key)
        output.append(cleaned)

    return output


def build_index_terms(aliases: list[str]) -> list[str]:
    return unique_values(aliases)


def smart_title_case(value: str) -> str:
    pieces = re.split(r"(\s+|-)", normalize_space(value).lower())
    output: list[str] = []
    seen_word = False

    for piece in pieces:
        if not piece:
            continue

        if piece.isspace() or piece == "-":
            output.append(piece)
            continue

        bare = re.sub(r"[^0-9a-zà-ÿ]", "", piece, flags=re.IGNORECASE)

        if bare and re.fullmatch(r"[ivxlcdm]+", bare, flags=re.IGNORECASE):
            output.append(piece.upper())
            seen_word = True
            continue

        if bare and seen_word and bare in SMALL_WORDS:
            output.append(piece)
            seen_word = True
            continue

        output.append(piece[:1].upper() + piece[1:])
        seen_word = True

    return "".join(output)


def normalize_heading(line: str) -> str:
    line = normalize_space(line).strip(" .,:;")
    words = line.split()

    if len(words) >= 2 and len(words[0]) == 1 and words[0].isalpha():
        words = [words[0] + words[1]] + words[2:]
        line = " ".join(words)

    return smart_title_case(line)


def split_alias_terms(value: str) -> list[str]:
    cleaned = normalize_space(value)

    if not cleaned:
        return []

    parts = re.split(r"\s*(?:/|;|, ou | ou )\s*", cleaned)
    return unique_values(parts + [cleaned])


def parse_page_header(line: str) -> tuple[int | None, str | None]:
    cleaned = normalize_space(line)

    for pattern in HEADER_PATTERNS:
        match = pattern.match(cleaned)

        if match:
            page_text = match.group("page")
            label = normalize_space(match.group("label"))

            try:
                return int(page_text), label
            except ValueError:
                return None, label

    return None, None


def is_heading_line(line: str) -> bool:
    cleaned = normalize_space(line).strip(" .,:;")

    if not cleaned or len(cleaned) > 80:
        return False

    if "/" in cleaned or cleaned.startswith(("(", "[", "“", '"', "—")):
        return False

    if any(character in cleaned for character in "()[]{}"):
        return False

    if cleaned.endswith(("-", "—", ".", ",", ";", ":", "!", "?")):
        return False

    if len(cleaned.split()) > HEADING_MAX_WORDS:
        return False

    comma_groups = [part.strip() for part in cleaned.split(",") if part.strip()]

    if (
        len(comma_groups) >= 3
        and sum(len(normalize_lookup_key(part)) <= 6 for part in comma_groups) >= 2
    ):
        return False

    letters = [character for character in cleaned if character.isalpha()]

    if len(letters) < 3:
        return False

    upper_ratio = sum(character.isupper() for character in letters) / len(letters)

    if upper_ratio < 0.82:
        return False

    if any(character.isdigit() for character in cleaned):
        return False

    return True


def maybe_correct_heading_with_header(heading: str, header_label: str | None) -> str:
    if not header_label:
        return heading

    cleaned_header = normalize_heading(header_label)

    if not cleaned_header or any(character.isdigit() for character in cleaned_header):
        return heading

    ratio = difflib.SequenceMatcher(
        None,
        normalize_lookup_key(heading),
        normalize_lookup_key(cleaned_header),
    ).ratio()

    heading_key = normalize_lookup_key(heading)
    header_key = normalize_lookup_key(cleaned_header)

    if heading_key and header_key.startswith(heading_key) and len(header_key) > len(heading_key):
        if len(heading_key) <= 4 or ratio >= 0.5:
            return cleaned_header

    if ratio >= 0.72:
        return cleaned_header

    return heading


def compute_sequence_similarity(left: str, right: str) -> float:
    return difflib.SequenceMatcher(None, left, right).ratio()


def is_ordered_subsequence(shorter: str, longer: str) -> bool:
    shorter_index = 0

    for character in longer:
        if shorter_index < len(shorter) and character == shorter[shorter_index]:
            shorter_index += 1

        if shorter_index == len(shorter):
            return True

    return False


def is_simple_plural_pair(left: str, right: str) -> bool:
    return (
        left == right + "s"
        or right == left + "s"
        or left == right + "es"
        or right == left + "es"
    )


def collect_body_token_stats(text: str) -> tuple[Counter[str], dict[str, Counter[str]]]:
    key_counts: Counter[str] = Counter()
    display_forms: dict[str, Counter[str]] = {}

    for match in TOKEN_RE.finditer(text):
        token = normalize_space(match.group(0)).strip("-'")

        if len(token) < 3 or not any(character.isalpha() for character in token):
            continue

        key = normalize_lookup_key(token)

        if not key:
            continue

        key_counts[key] += 1
        display_forms.setdefault(key, Counter())[token] += 1

    return key_counts, display_forms


def pick_preferred_display_form(forms: Counter[str]) -> str:
    best_form, _ = max(
        forms.items(),
        key=lambda item: (item[1], len(item[0]), item[0]),
    )
    return best_form


def maybe_correct_heading_with_body_tokens(heading: str, text: str) -> str:
    cleaned_heading = normalize_heading(heading)

    if not cleaned_heading or " " in cleaned_heading or "/" in cleaned_heading:
        return cleaned_heading

    heading_key = normalize_lookup_key(cleaned_heading)

    if not heading_key:
        return cleaned_heading

    key_counts, display_forms = collect_body_token_stats(text)

    if key_counts.get(heading_key, 0) > 0:
        return cleaned_heading

    best_key: str | None = None
    best_score = 0.0

    for token_key, count in key_counts.items():
        if count < 3:
            continue

        if len(token_key) <= len(heading_key) or len(token_key) - len(heading_key) > 2:
            continue

        if token_key[0] != heading_key[0]:
            continue

        if is_simple_plural_pair(token_key, heading_key):
            continue

        if not is_ordered_subsequence(heading_key, token_key):
            continue

        similarity = compute_sequence_similarity(heading_key, token_key)
        score = similarity + min(count, 12) * 0.01

        if score > best_score:
            best_key = token_key
            best_score = score

    if not best_key or best_score < 0.92:
        return cleaned_heading

    corrected_form = pick_preferred_display_form(display_forms[best_key])
    return smart_title_case(corrected_form)


def merge_body_lines(lines: list[str]) -> str:
    merged: list[str] = []

    for raw_line in lines:
        line = normalize_space(raw_line)

        if not line:
            continue

        line = line.lstrip("[")

        if not merged:
            merged.append(line)
            continue

        previous = merged[-1]

        if previous.endswith("-"):
            merged[-1] = previous[:-1] + line
            continue

        merged.append(line)

    text = " ".join(merged)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def run_windows_ocr(image_path: Path, cache_path: Path) -> list[str]:
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))["lines"]

    command = [
        "powershell",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(OCR_SCRIPT),
        "-ImagePath",
        str(image_path),
    ]
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        encoding="utf-8",
        text=True,
    )
    payload = json.loads(completed.stdout)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    return payload["lines"]


def render_half_images(
    document: fitz.Document,
    page_number: int,
    render_dir: Path,
) -> tuple[Path, Path]:
    page = document.load_page(page_number - 1)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    midpoint = image.width // 2

    left_path = render_dir / f"page-{page_number:04d}-left.png"
    right_path = render_dir / f"page-{page_number:04d}-right.png"
    image.crop((0, 0, midpoint, image.height)).save(left_path)
    image.crop((midpoint, 0, image.width, image.height)).save(right_path)
    return left_path, right_path


def finalize_entry(entry: dict[str, object]) -> dict[str, object]:
    text = merge_body_lines(entry.pop("body_lines", []))
    aliases = [str(alias) for alias in entry.pop("aliases", [])]
    start_page = int(entry["startPage"])
    end_page = int(entry["endPage"])
    canonical_heading = str(entry["canonicalTerm"])
    display_heading = str(entry["displayHeading"])
    corrected_heading = maybe_correct_heading_with_body_tokens(canonical_heading, text)

    if start_page > end_page:
        start_page = end_page

    if corrected_heading != canonical_heading:
        aliases = unique_values([corrected_heading, canonical_heading, display_heading, *aliases])
        canonical_heading = corrected_heading
        display_heading = corrected_heading
    else:
        aliases = unique_values(aliases)

    return {
        "aliases": aliases,
        "canonicalTerm": canonical_heading,
        "displayHeading": display_heading,
        "endPage": end_page,
        "id": f"{normalize_lookup_key(canonical_heading)}-{start_page}",
        "sourceBookPageLabel": entry.get("sourceBookPageLabel"),
        "startPage": start_page,
        "text": text,
    }


def extract_entries(
    document: fitz.Document,
    start_page: int,
    end_page: int,
    ocr_cache_dir: Path,
    render_dir: Path,
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    current_entry: dict[str, object] | None = None
    last_book_page: int | None = None

    for pdf_page_number in range(start_page, end_page + 1):
        left_path, right_path = render_half_images(document, pdf_page_number, render_dir)

        side_payloads: list[dict[str, object]] = []

        for side_name, image_path in (("left", left_path), ("right", right_path)):
            cache_path = ocr_cache_dir / f"page-{pdf_page_number:04d}-{side_name}.json"
            raw_lines = run_windows_ocr(image_path, cache_path)
            book_page: int | None = None
            header_label: str | None = None
            cleaned_lines: list[str] = []

            for raw_line in raw_lines:
                normalized_line = normalize_space(raw_line)

                if not normalized_line:
                    continue

                header_page, parsed_header_label = parse_page_header(normalized_line)

                if header_page is not None:
                    if book_page is None:
                        book_page = header_page
                    if header_label is None and parsed_header_label:
                        header_label = parsed_header_label
                    continue

                cleaned_lines.append(normalized_line)

            side_payloads.append(
                {
                    "book_page": book_page,
                    "cleaned_lines": cleaned_lines,
                    "header_label": header_label,
                    "side_name": side_name,
                }
            )

        left_payload = side_payloads[0]
        right_payload = side_payloads[1]
        left_page = left_payload["book_page"]
        right_page = right_payload["book_page"]

        if left_page is None and right_page is not None:
            left_payload["book_page"] = max(1, int(right_page) - 1)
        elif right_page is None and left_page is not None:
            right_payload["book_page"] = int(left_page) + 1
        elif left_page is None and right_page is None and last_book_page is not None:
            left_payload["book_page"] = last_book_page + 1
            right_payload["book_page"] = last_book_page + 2

        if right_payload["book_page"] is not None:
            last_book_page = int(right_payload["book_page"])
        elif left_payload["book_page"] is not None:
            last_book_page = int(left_payload["book_page"])

        for side_payload in side_payloads:
            book_page = (
                int(side_payload["book_page"])
                if side_payload["book_page"] is not None
                else None
            )
            header_label = (
                str(side_payload["header_label"])
                if side_payload["header_label"] is not None
                else None
            )

            for line in side_payload["cleaned_lines"]:
                if is_heading_line(line):
                    heading = maybe_correct_heading_with_header(
                        normalize_heading(line),
                        header_label,
                    )
                    aliases = split_alias_terms(heading)
                    canonical_heading = aliases[0] if aliases else heading
                    canonical_heading_key = normalize_lookup_key(canonical_heading)

                    if current_entry:
                        current_heading_key = normalize_lookup_key(
                            str(current_entry["canonicalTerm"])
                        )

                        if canonical_heading_key == current_heading_key:
                            continue

                    if current_entry and current_entry.get("body_lines"):
                        entries.append(finalize_entry(current_entry))

                    page_reference = book_page if book_page is not None else pdf_page_number
                    current_entry = {
                        "aliases": aliases,
                        "body_lines": [],
                        "canonicalTerm": canonical_heading,
                        "displayHeading": heading,
                        "endPage": page_reference,
                        "id": f"{canonical_heading_key}-{page_reference}",
                        "sourceBookPageLabel": str(page_reference),
                        "startPage": page_reference,
                    }
                    continue

                if current_entry:
                    current_entry.setdefault("body_lines", []).append(line)

                    if book_page is not None:
                        current_entry["endPage"] = book_page

        left_path.unlink(missing_ok=True)
        right_path.unlink(missing_ok=True)

        if pdf_page_number % 10 == 0:
            print(f"Processadas {pdf_page_number - start_page + 1} paginas do PDF...")

    if current_entry and current_entry.get("body_lines"):
        entries.append(finalize_entry(current_entry))

    return entries


def build_index(entries: list[dict[str, object]]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}

    for entry in entries:
        aliases = entry.get("aliases", [])

        if not isinstance(aliases, list):
            continue

        for term in build_index_terms([str(alias) for alias in aliases]):
            key = normalize_lookup_key(term)

            if not key:
                continue

            ids = index.setdefault(key, [])
            entry_id = str(entry["id"])

            if entry_id not in ids:
                ids.append(entry_id)

    return dict(sorted(index.items(), key=lambda item: item[0]))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extrai um indice OCR local do Dicionario de Simbolos.",
    )
    parser.add_argument("pdf", type=Path, help="Caminho do PDF de origem.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data") / "simbolica",
        help="Diretorio onde os arquivos JSON serao gravados.",
    )
    parser.add_argument(
        "--start-page",
        type=int,
        default=1,
        help="Primeira pagina 1-based do PDF a considerar.",
    )
    parser.add_argument(
        "--end-page",
        type=int,
        default=0,
        help="Ultima pagina 1-based do PDF a considerar. Use 0 para ir ate o fim.",
    )
    parser.add_argument(
        "--ocr-cache-dir",
        type=Path,
        default=Path("tmp") / "simbolica-ocr-cache",
        help="Diretorio de cache incremental do OCR.",
    )
    parser.add_argument(
        "--render-dir",
        type=Path,
        default=Path("tmp") / "simbolica-render",
        help="Diretorio temporario para as imagens renderizadas.",
    )
    args = parser.parse_args()

    document = fitz.open(args.pdf)
    end_page = args.end_page or len(document)
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    args.ocr_cache_dir.mkdir(parents=True, exist_ok=True)
    args.render_dir.mkdir(parents=True, exist_ok=True)

    try:
        entries = extract_entries(
            document,
            args.start_page,
            end_page,
            args.ocr_cache_dir,
            args.render_dir,
        )
    finally:
        shutil.rmtree(args.render_dir, ignore_errors=True)

    index = build_index(entries)
    metadata = {
        "entryCount": len(entries),
        "endPage": end_page,
        "ocrEngine": "Windows.Media.Ocr",
        "pageCount": len(document),
        "renderScale": RENDER_SCALE,
        "sourcePdfName": args.pdf.name,
        "startPage": args.start_page,
        "termCount": len(index),
    }

    (output_dir / "entries.json").write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")),
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
    print(f"Verbetes: {len(entries)}")
    print(f"Chaves de busca: {len(index)}")


if __name__ == "__main__":
    main()
