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


RENDER_SCALE = 2.4
BOOK_SPLIT_OVERLAP_RATIO = 0.015
COLUMN_SPLIT_OVERLAP_RATIO = 0.035
BOOK_PAGE_SCAN_START_PDF = 25
MAX_BOOK_PAGE = 472
OCR_SCRIPT = Path(__file__).with_name("windows_ocr_lines.ps1")
CITATION_STOP_TERMS = {
    "Aes",
    "Apol",
    "Apollod",
    "Diod",
    "Eur",
    "Fest",
    "Heock",
    "Hes",
    "Hom",
    "Hyg",
    "Lib",
    "Ov",
    "Pau",
    "Pind",
    "Serv",
    "Sic",
    "Steph",
    "Strab",
    "Tzetz",
    "Virg",
}
SMALL_WORDS = {
    "a",
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
    "ou",
}
TOKEN_RE = re.compile(r"[\wÀ-ÿ'-]+", re.UNICODE)
HEADING_RE = re.compile(
    r"^[•·*]?\s*(?P<lemma>[A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ' -]{1,80}?)\.\s*(?P<body>.*)$"
)
REFERENCE_RE = re.compile(r"^(?P<lemma>[A-ZÀ-ÿ][A-Za-zÀ-ÿ' .-]{0,42}):\s+(?P<tail>.+)$")


LEADING_PARENTHETICAL_LABEL_RE = re.compile(r"^\((?P<label>[^)]{1,120})\)\.?\s*")


def normalize_space(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


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
    terms: list[str] = []

    for alias in aliases:
        terms.append(alias)

        if " " not in alias:
            continue

        for token in TOKEN_RE.findall(alias):
            cleaned_token = token.strip("-'")

            if len(cleaned_token) >= 5:
                terms.append(cleaned_token)

    return unique_values(terms)


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


def normalize_heading(value: str) -> str:
    value = normalize_space(value).strip(" .,:;")
    value = re.sub(r"\s+", " ", value)
    return smart_title_case(value)


def latin_letter_ratio(value: str) -> float:
    letters = [character for character in value if character.isalpha()]

    if not letters:
        return 0.0

    latin_letters = sum(
        1 for character in letters if "LATIN" in unicodedata.name(character, "")
    )
    return latin_letters / len(letters)


def is_usable_original_label(value: str) -> bool:
    cleaned = normalize_space(value).strip(" .,:;\"'“”‘’")

    if not cleaned or len(cleaned) > 60:
        return False

    if any(character.isdigit() for character in cleaned):
        return False

    if len(cleaned.split()) > 4:
        return False

    return latin_letter_ratio(cleaned) >= 0.82


def strip_leading_parenthetical_label(text: str) -> tuple[str, str | None]:
    simplified = text.strip()
    match = LEADING_PARENTHETICAL_LABEL_RE.match(simplified)

    if not match:
        return simplified, None

    raw_label = normalize_space(match.group("label")).strip(" .,:;\"'“”‘’")
    cleaned_text = simplified[match.end():].strip()

    if is_usable_original_label(raw_label):
        return cleaned_text, normalize_heading(raw_label)

    return cleaned_text, None


def split_alias_terms(value: str) -> list[str]:
    cleaned = normalize_heading(value)

    if not cleaned:
        return []

    parts = re.split(r"\s*(?:/|;|, ou | ou )\s*", cleaned)
    return unique_values(parts + [cleaned])


def is_heading_term(value: str) -> bool:
    cleaned = normalize_space(value).strip(" .,:;")

    if not cleaned or len(cleaned) > 60:
        return False

    if any(character.isdigit() for character in cleaned):
        return False

    if cleaned.startswith(("(", "[", '"', "“", "—")):
        return False

    if len(cleaned.split()) > 5:
        return False

    letters = [character for character in cleaned if character.isalpha()]

    if len(letters) < 3:
        return False

    upper_ratio = sum(character.isupper() for character in letters) / len(letters)
    return upper_ratio >= 0.6


def split_heading_line(line: str) -> tuple[str, str] | None:
    cleaned = normalize_space(line)
    match = HEADING_RE.match(cleaned)

    if not match:
        return None

    lemma = normalize_space(match.group("lemma") or "").strip(" -")

    if not is_heading_term(lemma):
        return None

    body = normalize_space(match.group("body") or "")
    return normalize_heading(lemma), body


def extract_leading_phrase(text: str) -> str | None:
    simplified, _ = strip_leading_parenthetical_label(text)
    candidate_tokens: list[str] = []

    for token in TOKEN_RE.findall(simplified[:140]):
        cleaned_token = normalize_space(token).strip("-'")

        if len(cleaned_token) < 2 or not cleaned_token[:1].isupper():
            break

        candidate_tokens.append(cleaned_token)

        if len(candidate_tokens) >= 3:
            break

    if not candidate_tokens:
        return None

    candidate = normalize_heading(" ".join(candidate_tokens))
    return candidate or None


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


def looks_related_heading(candidate: str, heading: str) -> bool:
    candidate_key = normalize_lookup_key(candidate)
    heading_key = normalize_lookup_key(heading)

    if not candidate_key or not heading_key:
        return False

    if candidate_key == heading_key:
        return True

    if candidate_key[:1] != heading_key[:1]:
        return False

    if abs(len(candidate_key) - len(heading_key)) > 4:
        return False

    if is_simple_plural_pair(candidate_key, heading_key):
        return False

    similarity = compute_sequence_similarity(heading_key, candidate_key)
    if similarity >= 0.86:
        return True

    candidate_words = normalize_space(candidate).split()
    heading_words = normalize_space(heading).split()

    if (
        len(candidate_words) > 1
        and len(candidate_words) == len(heading_words)
        and candidate_words[0].lower() == heading_words[0].lower()
        and similarity >= 0.82
    ):
        return True

    ordered_match = is_ordered_subsequence(heading_key, candidate_key) or is_ordered_subsequence(
        candidate_key,
        heading_key,
    )
    return similarity >= 0.74 and ordered_match


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


def maybe_correct_heading_with_body_tokens(
    heading: str,
    text: str,
    original_label: str | None = None,
) -> str:
    cleaned_heading = normalize_heading(heading)

    if not cleaned_heading or "/" in cleaned_heading:
        if original_label and len(original_label.split()) > 1 and looks_related_heading(
            original_label,
            cleaned_heading,
        ):
            return original_label

        return cleaned_heading

    heading_key = normalize_lookup_key(cleaned_heading)

    if not heading_key:
        return cleaned_heading

    if original_label and len(original_label.split()) > 1 and looks_related_heading(
        original_label,
        cleaned_heading,
    ):
        return original_label

    leading_phrase = extract_leading_phrase(text)

    if leading_phrase and looks_related_heading(leading_phrase, cleaned_heading):
        return leading_phrase

    leading_text = re.sub(r"^\([^)]*\)\s*", "", text).strip()
    leading_match = re.match(r"^(?:\d+\.\s*)?(?P<token>[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{2,})\b", leading_text)

    if leading_match:
        leading_token = normalize_heading(leading_match.group("token"))
        leading_key = normalize_lookup_key(leading_token)

        if (
            leading_key
            and leading_key != heading_key
            and leading_key[:1] == heading_key[:1]
            and abs(len(leading_key) - len(heading_key)) <= 3
            and compute_sequence_similarity(heading_key, leading_key) >= 0.75
        ):
            return leading_token

    key_counts, display_forms = collect_body_token_stats(text)

    if key_counts.get(heading_key, 0) > 0:
        preferred_same_key = pick_preferred_display_form(display_forms[heading_key])

        if normalize_heading(preferred_same_key) != cleaned_heading:
            return normalize_heading(preferred_same_key)

        return cleaned_heading

    best_key: str | None = None
    best_score = 0.0

    for token_key, count in key_counts.items():
        if count < 1:
            continue

        if len(token_key) + 2 < len(heading_key) or len(token_key) - len(heading_key) > 3:
            continue

        if token_key[0] != heading_key[0]:
            continue

        if is_simple_plural_pair(token_key, heading_key):
            continue

        if not is_ordered_subsequence(heading_key, token_key):
            continue

        similarity = compute_sequence_similarity(heading_key, token_key)
        score = similarity + min(count, 8) * 0.015

        if score > best_score:
            best_key = token_key
            best_score = score

    if not best_key or best_score < 0.8:
        return cleaned_heading

    corrected_form = pick_preferred_display_form(display_forms[best_key])
    return normalize_heading(corrected_form)


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


def looks_like_reference_start(line: str) -> bool:
    cleaned = normalize_space(line)
    match = REFERENCE_RE.match(cleaned)

    if not match:
        return False

    tail = match.group("tail")
    abbreviation_hits = len(re.findall(r"\b[A-Z][A-Z.]{1,}\b", tail))
    digit_hits = len(re.findall(r"\b\d+\b", tail))
    punctuation_hits = tail.count(";") + tail.count(",")

    return abbreviation_hits + digit_hits + punctuation_hits >= 5


def looks_like_running_header(line: str) -> bool:
    cleaned = normalize_space(line).strip(" .,:;")

    if not cleaned or len(cleaned) > 42:
        return False

    if any(character.isdigit() for character in cleaned):
        return False

    if len(cleaned.split()) > 3:
        return False

    letters = [character for character in cleaned if character.isalpha()]

    if len(letters) < 4:
        return False

    upper_ratio = sum(character.isupper() for character in letters) / len(letters)
    return upper_ratio >= 0.9


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


def crop_page_to_book_images(page_image: Image.Image) -> tuple[Image.Image, Image.Image]:
    midpoint = page_image.width // 2
    overlap = max(12, int(page_image.width * BOOK_SPLIT_OVERLAP_RATIO))
    left = page_image.crop((0, 0, min(page_image.width, midpoint + overlap), page_image.height))
    right = page_image.crop((max(0, midpoint - overlap), 0, page_image.width, page_image.height))
    return left, right


def crop_book_page_to_columns(book_image: Image.Image) -> tuple[Image.Image, Image.Image]:
    midpoint = book_image.width // 2
    overlap = max(18, int(book_image.width * COLUMN_SPLIT_OVERLAP_RATIO))
    left = book_image.crop((0, 0, min(book_image.width, midpoint + overlap), book_image.height))
    right = book_image.crop((max(0, midpoint - overlap), 0, book_image.width, book_image.height))
    return left, right


def render_book_page_images(
    document: fitz.Document,
    pdf_page_number: int,
    render_dir: Path,
) -> tuple[Path, Path]:
    page = document.load_page(pdf_page_number - 1)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    left_image, right_image = crop_page_to_book_images(image)

    left_path = render_dir / f"page-{pdf_page_number:04d}-left-book.png"
    right_path = render_dir / f"page-{pdf_page_number:04d}-right-book.png"
    left_image.save(left_path)
    right_image.save(right_path)
    return left_path, right_path


def render_column_images(
    book_image_path: Path,
    pdf_page_number: int,
    side_name: str,
    render_dir: Path,
) -> tuple[Path, Path]:
    book_image = Image.open(book_image_path)
    left_column, right_column = crop_book_page_to_columns(book_image)

    left_path = render_dir / f"page-{pdf_page_number:04d}-{side_name}-col-a.png"
    right_path = render_dir / f"page-{pdf_page_number:04d}-{side_name}-col-b.png"
    left_column.save(left_path)
    right_column.save(right_path)
    return left_path, right_path


def infer_book_page_numbers(pdf_page_number: int) -> tuple[int, int]:
    left_page = 2 * (pdf_page_number - BOOK_PAGE_SCAN_START_PDF)
    return left_page, left_page + 1


def clean_column_lines(raw_lines: list[str]) -> list[str]:
    cleaned_lines: list[str] = []
    inside_references = False

    for index, raw_line in enumerate(raw_lines):
        line = normalize_space(raw_line)

        if not line:
            continue

        if looks_like_running_header(line) and index <= 2:
            continue

        if inside_references:
            continue

        abbreviation_hits = len(re.findall(r"\b[A-Z][A-Z.]{1,}\b", line))
        digit_hits = len(re.findall(r"\b\d+\b", line))
        semicolon_hits = line.count(";")

        if looks_like_reference_start(line) or (
            abbreviation_hits >= 2 and digit_hits >= 2 and semicolon_hits >= 1
        ):
            inside_references = True
            continue

        cleaned_lines.append(line)

    return cleaned_lines


def finalize_entry(entry: dict[str, object]) -> dict[str, object]:
    text = merge_body_lines(entry.pop("body_lines", []))
    text, original_label = strip_leading_parenthetical_label(text)
    aliases = [str(alias) for alias in entry.pop("aliases", [])]
    start_page = int(entry["startPage"])
    end_page = int(entry["endPage"])
    canonical_heading = str(entry["canonicalTerm"])
    display_heading = str(entry["displayHeading"])
    corrected_heading = maybe_correct_heading_with_body_tokens(
        canonical_heading,
        text,
        original_label,
    )

    if start_page > end_page:
        start_page = end_page

    if corrected_heading != canonical_heading:
        aliases = unique_values(
            [
                corrected_heading,
                canonical_heading,
                display_heading,
                *([original_label] if original_label else []),
                *aliases,
            ]
        )
        canonical_heading = corrected_heading
        display_heading = corrected_heading
    else:
        aliases = unique_values([*([original_label] if original_label else []), *aliases])

    return {
        "aliases": aliases,
        "canonicalTerm": canonical_heading,
        "displayHeading": display_heading,
        "endPage": end_page,
        "id": f"{normalize_lookup_key(canonical_heading)}-{start_page}",
        "originalLabel": original_label,
        "startPage": start_page,
        "text": text,
        "tradition": None,
        "traditionCode": None,
    }


def entry_text_looks_like_reference(text: str) -> bool:
    head = text[:320]
    abbreviation_hits = len(re.findall(r"\b[A-Z][A-Z.]{1,}\b", head))
    digit_hits = len(re.findall(r"\b\d+\b", head))
    semicolon_hits = head.count(";")
    comma_hits = head.count(",")
    lower_words = len(re.findall(r"\b[a-zà-ÿ]{4,}\b", head))
    return (
        abbreviation_hits >= 3
        and digit_hits >= 2
        and semicolon_hits + comma_hits >= 2
        and lower_words <= 10
    )


def entry_body_mentions_heading(text: str, heading: str) -> bool:
    heading_key = normalize_lookup_key(heading)

    if not heading_key:
        return False

    simplified = re.sub(r"^\([^)]*\)\s*", "", text).strip()

    if simplified.startswith("V. "):
        return True

    leading_tokens = TOKEN_RE.findall(simplified[:220])

    for token in leading_tokens[:16]:
        candidate = normalize_space(token).strip("-'")
        candidate_key = normalize_lookup_key(candidate)

        if not candidate_key:
            continue

        if candidate_key == heading_key:
            return True

        if (
            candidate_key[:1] == heading_key[:1]
            and abs(len(candidate_key) - len(heading_key)) <= 3
            and compute_sequence_similarity(heading_key, candidate_key) >= 0.75
        ):
            return True

    return False


def should_keep_entry(entry: dict[str, object]) -> bool:
    canonical_term = normalize_heading(str(entry["canonicalTerm"]))
    canonical_key = normalize_lookup_key(canonical_term)
    text = str(entry["text"])

    if not canonical_key or not text:
        return False

    if canonical_term in CITATION_STOP_TERMS:
        return False

    if re.fullmatch(r"[IVXLCDM]+", canonical_term):
        return False

    if entry_text_looks_like_reference(text):
        return False

    if len(canonical_key) <= 4 and not entry_body_mentions_heading(text, canonical_term):
        return False

    return True


def extract_entries(
    document: fitz.Document,
    start_pdf_page: int,
    end_pdf_page: int,
    ocr_cache_dir: Path,
    render_dir: Path,
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    current_entry: dict[str, object] | None = None

    for pdf_page_number in range(start_pdf_page, end_pdf_page + 1):
        left_book_path, right_book_path = render_book_page_images(
            document,
            pdf_page_number,
            render_dir,
        )
        left_book_page, right_book_page = infer_book_page_numbers(pdf_page_number)

        page_payloads: list[dict[str, object]] = []

        for side_name, book_path, book_page in (
            ("left", left_book_path, left_book_page),
            ("right", right_book_path, right_book_page),
        ):
            if book_page < 1 or book_page > MAX_BOOK_PAGE:
                page_payloads.append(
                    {
                        "book_page": None,
                        "columns": [],
                    }
                )
                continue

            column_paths = render_column_images(book_path, pdf_page_number, side_name, render_dir)
            columns: list[list[str]] = []

            for index, column_path in enumerate(column_paths):
                column_cache_path = (
                    ocr_cache_dir / f"page-{pdf_page_number:04d}-{side_name}-col-{index}.json"
                )
                raw_lines = run_windows_ocr(column_path, column_cache_path)
                columns.append(clean_column_lines(raw_lines))
                column_path.unlink(missing_ok=True)

            page_payloads.append(
                {
                    "book_page": book_page,
                    "columns": columns,
                }
            )

        for payload in page_payloads:
            book_page = payload["book_page"]

            if book_page is None or not payload["columns"]:
                continue

            for column_lines in payload["columns"]:
                for line in column_lines:
                    parsed_heading = split_heading_line(line)

                    if parsed_heading:
                        heading, body = parsed_heading

                        if current_entry and current_entry.get("body_lines"):
                            entries.append(finalize_entry(current_entry))

                        current_entry = {
                            "aliases": split_alias_terms(heading),
                            "body_lines": [body] if body else [],
                            "canonicalTerm": heading,
                            "displayHeading": heading,
                            "endPage": book_page,
                            "startPage": book_page,
                        }
                        continue

                    if current_entry:
                        current_entry.setdefault("body_lines", []).append(line)
                        current_entry["endPage"] = book_page

        left_book_path.unlink(missing_ok=True)
        right_book_path.unlink(missing_ok=True)

        if pdf_page_number % 10 == 0:
            print(f"Processadas {pdf_page_number - start_pdf_page + 1} paginas do PDF...")

    if current_entry and current_entry.get("body_lines"):
        entries.append(finalize_entry(current_entry))

    return entries


def build_index(entries: list[dict[str, object]]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}

    for entry in entries:
        entry_id = str(entry["id"])
        aliases = entry.get("aliases", [])

        if not isinstance(aliases, list):
            continue

        index_terms = build_index_terms([str(alias) for alias in aliases])

        for term in index_terms:
            key = normalize_lookup_key(term)

            if not key:
                continue

            ids = index.setdefault(key, [])

            if entry_id not in ids:
                ids.append(entry_id)

    return dict(sorted(index.items(), key=lambda item: item[0]))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extrai um indice OCR local do Dicionario da Mitologia Grega e Romana de Pierre Grimal.",
    )
    parser.add_argument("pdf", type=Path, help="Caminho do PDF de origem.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data") / "mitologico",
        help="Diretorio onde os arquivos JSON serao gravados.",
    )
    parser.add_argument(
        "--start-pdf-page",
        type=int,
        default=BOOK_PAGE_SCAN_START_PDF,
        help="Primeira pagina 1-based do PDF a considerar.",
    )
    parser.add_argument(
        "--end-pdf-page",
        type=int,
        default=0,
        help="Ultima pagina 1-based do PDF a considerar. Use 0 para ir ate o fim.",
    )
    parser.add_argument(
        "--ocr-cache-dir",
        type=Path,
        default=Path("tmp") / "mitologico-ocr-cache",
        help="Diretorio de cache incremental do OCR.",
    )
    parser.add_argument(
        "--render-dir",
        type=Path,
        default=Path("tmp") / "mitologico-render",
        help="Diretorio temporario para as imagens renderizadas.",
    )
    args = parser.parse_args()

    document = fitz.open(args.pdf)
    end_pdf_page = args.end_pdf_page or len(document)
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    args.ocr_cache_dir.mkdir(parents=True, exist_ok=True)
    args.render_dir.mkdir(parents=True, exist_ok=True)

    try:
        entries = extract_entries(
            document,
            args.start_pdf_page,
            end_pdf_page,
            args.ocr_cache_dir,
            args.render_dir,
        )
    finally:
        shutil.rmtree(args.render_dir, ignore_errors=True)

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
        "ocrEngine": "Windows.Media.Ocr",
        "pageCount": len(document),
        "renderScale": RENDER_SCALE,
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
