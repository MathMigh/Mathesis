from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from glob import glob
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "data" / "porto"
OUTPUT_PATH = OUTPUT_DIR / "ocr-index.json"
PDF_GLOB = r"C:\Users\mathe\Downloads\*Porto Editora*text*.pdf"

POS_MARKER_RE = re.compile(
    r"""
    \b(?:
        adj\.|ad/|
        adv\.|
        interj\.|
        prep\.|
        conj\.|
        pron\.(?:\s+pess\.)?|
        num\.|
        part\.|
        indecl\.|
        m\.|f\.|n\.|t\.|
        v(?:\.\s+(?:tr|intr|dep|impers)\.|\s+mc\.\s+tr\.|\s+mc\.|\.)
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)
ENTRY_RE = re.compile(
    r"^(?P<headword>[A-Za-zÀ-ÿĀ-ȳÆŒæœ-]{2,}(?:\s+(?:[A-Za-zÀ-ÿĀ-ȳÆŒæœ-]{1,24}|e)){0,3})"
    r"(?:\s+\d+)?"
    r"(?P<after>.*)$",
    re.IGNORECASE,
)
LATIN_HEADWORD_RE = re.compile(r"^[A-Za-zÀ-ÿĀ-ȳÆŒæœ-]+(?:\s+[A-Za-zÀ-ÿĀ-ȳÆŒæœ-]+){0,3}$")
NOISE_LINE_RE = re.compile(
    r"^(?:\d{2}/\d{2}/\d{4},|Full text of |https?://archive\.org/|DICION[ÁA]RIO DE LATIM|Guia de Utiliza[çc][ãa]o|Autores citados|Abreviaturas)$",
    re.IGNORECASE,
)


@dataclass
class PortoEntry:
    headword: str
    label: str
    page: int
    tail: str | None
    text: str


def normalize_spaces(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").replace("¬", "").split())


def clean_line(line: str) -> str:
    cleaned = (
        line.replace("—", "-")
        .replace("–", "-")
        .replace("•", "")
        .replace("·", "")
        .replace("\u0000", "")
    )
    cleaned = re.sub(r"\d{2}/\d{2}/\d{4}, \d{2}:\d{2} Full text of .*?$", "", cleaned)
    cleaned = re.sub(r"https?://archive\.org/\S+", "", cleaned)
    cleaned = re.sub(r"(?:PORTO\s+)?EDITORA\s+-\s+Dicion[aá]rio\s+Latim-Portugu[êe]s.*$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+\d+/\d+$", "", cleaned)
    return normalize_spaces(cleaned)


def should_skip_line(line: str) -> bool:
    if not line:
        return True

    if NOISE_LINE_RE.search(line):
        return True

    if re.match(r"^\d+/\d+$", line):
        return True

    if re.match(r"^\d+$", line):
        return True

    return False


def looks_like_latin_headword(value: str) -> bool:
    if not value or not LATIN_HEADWORD_RE.match(value):
        return False

    words = value.split()

    if len(words) > 3:
        return False

    if len(words) > 1 and " ou " not in value.lower():
        return False

    normalized = value.lower()
    if any(token in normalized for token in ("autor", "cidade", "obra", "dicion")):
        return False

    return True


def normalize_headword(value: str) -> str:
    cleaned = normalize_spaces(value).strip(" ,;:.")
    tokens = []
    for token in cleaned.split():
        if len(token) > 1 and any(char.isupper() for char in token[1:]):
            tokens.append(token.lower())
        else:
            tokens.append(token)
    return " ".join(tokens)


def clean_tail(value: str) -> str | None:
    cleaned = normalize_spaces(value)

    if cleaned.strip().startswith("("):
        return None

    cleaned = re.sub(r"^[,;:\- ]+", "", cleaned)
    cleaned = re.sub(r"\s*<.*$", "", cleaned)
    cleaned = re.sub(r"\s*\([^)]*\)\s*$", "", cleaned)
    cleaned = cleaned.strip(" ,;:.").lower()

    if not cleaned:
        return None

    if re.fullmatch(r"\d+", cleaned):
        return None

    if "(" in cleaned and ")" not in cleaned:
        return None

    return cleaned


def is_valid_gap_before_pos(value: str) -> bool:
    cleaned = normalize_spaces(value)

    if not cleaned:
        return True

    if ";" in cleaned or ":" in cleaned or "[" in cleaned or "{" in cleaned:
        return False

    if any(character.isdigit() for character in cleaned):
        return False

    if len(cleaned) > 64:
        return False

    return True


def parse_entry_start(line: str) -> tuple[str, str | None, str] | None:
    pos_match = POS_MARKER_RE.search(line[:140])
    if not pos_match:
        return None

    head_match = ENTRY_RE.match(line)
    if not head_match:
        return None

    headword = normalize_headword(head_match.group("headword") or "")
    if not looks_like_latin_headword(headword):
        return None

    before_pos = line[len(head_match.group("headword")) : pos_match.start()]
    if not is_valid_gap_before_pos(before_pos):
        return None

    tail = clean_tail(before_pos)
    remainder = normalize_spaces(line[pos_match.end() :])

    label = headword if not tail else f"{headword}, {tail}"
    return headword, tail, remainder


def merge_lines(lines: list[str]) -> str:
    merged: list[str] = []

    for line in lines:
        cleaned = clean_line(line)
        if not cleaned:
            continue

        if merged and merged[-1].endswith("-") and cleaned[:1].islower():
            merged[-1] = merged[-1][:-1] + cleaned
            continue

        merged.append(cleaned)

    text = " ".join(merged)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"\s*¬\s*", "", text)
    return text.strip()


def load_pdf_lines(pdf_path: Path) -> list[tuple[int, str]]:
    reader = PdfReader(str(pdf_path))
    lines: list[tuple[int, str]] = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = clean_line(raw_line)
            if should_skip_line(line):
                continue
            lines.append((page_number, line))

    return lines


def build_entries(lines: list[tuple[int, str]]) -> list[PortoEntry]:
    entries: list[PortoEntry] = []
    current_headword: str | None = None
    current_label: str | None = None
    current_tail: str | None = None
    current_page: int | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_headword, current_label, current_tail, current_page, current_lines
        if not current_headword or not current_label or current_page is None:
            current_headword = None
            current_label = None
            current_tail = None
            current_page = None
            current_lines = []
            return

        text = merge_lines(current_lines)
        if text:
            entries.append(
                PortoEntry(
                    headword=current_headword,
                    label=current_label,
                    page=current_page,
                    tail=current_tail,
                    text=text,
                )
            )

        current_headword = None
        current_label = None
        current_tail = None
        current_page = None
        current_lines = []

    for page_number, line in lines:
        parsed = parse_entry_start(line)

        if parsed:
            flush()
            headword, tail, remainder = parsed
            current_headword = headword
            current_tail = tail
            current_label = headword if not tail else f"{headword}, {tail}"
            current_page = page_number
            current_lines = [remainder] if remainder else []
            continue

        if current_headword:
            current_lines.append(line)

    flush()

    deduped: list[PortoEntry] = []
    seen: set[tuple[str, int]] = set()
    for entry in entries:
        key = (entry.label.lower(), entry.page)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)

    return deduped


def main() -> None:
    matches = glob(PDF_GLOB)
    if not matches:
        raise FileNotFoundError("Nao encontrei o PDF-texto da Porto Editora em Downloads.")

    pdf_path = Path(matches[0])
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    lines = load_pdf_lines(pdf_path)
    entries = build_entries(lines)

    payload = {
      "version": 2,
      "source": "porto-text-pdf",
      "pdf": str(pdf_path),
      "entries": [asdict(entry) for entry in entries],
    }

    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"entries: {len(entries)}")
    print(f"saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
