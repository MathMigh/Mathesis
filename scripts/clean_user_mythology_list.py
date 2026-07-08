from __future__ import annotations

from pathlib import Path
import re


SOURCE = Path(r"C:\Users\mathe\Downloads\Lista_de_mitologias_organizada_v3.txt")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "outputs"
OUT_CLEAN = OUT_DIR / "Lista_de_mitologias_organizada_v3_limpa.txt"
OUT_REMOVED = OUT_DIR / "Lista_de_mitologias_organizada_v3_removidos.txt"


EXACT_REMOVE = {
    "Ema (constelação)",
    "Gauchito Gil",
    "Terra sem males",
    "Épica dos Reis",
    "Buda (planeta)",
    "Astra Planeta",
    "Os Doze Trabalhos de Hércules (Monteiro Lobato)",
    "Reis latinos de Alba Longa",
    "Nossa Senhora do Cabo",
    "Procissão dos diabos",
}

PREFIX_REMOVE = (
    "Lenda ",
    "Lenda da ",
    "Lenda das ",
    "Lenda de ",
    "Lenda do ",
)

CONTAINS_REMOVE = (
    "Monteiro Lobato",
    "constelação",
    "planeta",
    "Nossa Senhora",
    "Santa Comba",
    "Frei João da Cruz",
    "Maria Fidalga",
    "Justiça de Fafe",
    "Galo de Barcelos",
)


def is_section_header(lines: list[str], index: int) -> bool:
    if index + 1 >= len(lines):
        return False
    line = lines[index].strip()
    underline = lines[index + 1].strip()
    return bool(line) and underline and set(underline) == {"="}


def should_remove(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped in EXACT_REMOVE:
        return True
    if any(stripped.startswith(prefix) for prefix in PREFIX_REMOVE):
        return True
    if any(token in stripped for token in CONTAINS_REMOVE):
        return True
    return False


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    cleaned_raw: list[str] = []
    removed: list[str] = []

    for idx, line in enumerate(lines):
        stripped = line.strip()

        if should_remove(stripped):
            removed.append(stripped)
            continue

        cleaned_raw.append(line)

    cleaned: list[str] = []
    i = 0
    while i < len(cleaned_raw):
        line = cleaned_raw[i]
        stripped = line.strip()

        if re.fullmatch(r"[A-ZÀ-Ý]", stripped):
            j = i + 1
            has_entry = False
            while j < len(cleaned_raw):
                probe = cleaned_raw[j].strip()
                if not probe:
                    j += 1
                    continue
                if re.fullmatch(r"[A-ZÀ-Ý]", probe):
                    break
                if j + 1 < len(cleaned_raw):
                    underline = cleaned_raw[j + 1].strip()
                    if underline and set(underline) == {"="}:
                        break
                has_entry = True
                break
            if not has_entry:
                i += 1
                continue

        cleaned.append(line)
        i += 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_CLEAN.write_text("\n".join(cleaned) + "\n", encoding="utf-8")
    OUT_REMOVED.write_text(
        "Itens removidos na limpeza conservadora\n\n"
        + "\n".join(f"- {item}" for item in removed),
        encoding="utf-8",
    )

    print(f"removed={len(removed)}")
    print(OUT_CLEAN)
    print(OUT_REMOVED)


if __name__ == "__main__":
    main()
