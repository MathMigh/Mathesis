from __future__ import annotations

import io
import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "data" / "porto-latim.pdf"
OUTPUT_DIR = ROOT / "data" / "porto"
OUTPUT_PATH = OUTPUT_DIR / "ocr-index.json"
OCR_SCRIPT_PATH = ROOT / "scripts" / "windows_ocr_lines.ps1"
RENDER_SCALE = 2.0
MAX_WORKERS = 3


def normalize_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


def chunk_ranges(total_pages: int, chunk_size: int) -> list[tuple[int, int]]:
    return [
        (start, min(start + chunk_size, total_pages))
        for start in range(0, total_pages, chunk_size)
    ]


def run_windows_ocr(image_path: Path) -> list[str]:
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(OCR_SCRIPT_PATH),
        "-ImagePath",
        str(image_path),
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        check=True,
    )
    stdout = completed.stdout.decode("utf-8", errors="ignore").strip()

    if not stdout:
        stdout = completed.stdout.decode("cp1252", errors="ignore").strip()

    payload = json.loads(stdout)
    return payload.get("lines", [])


def process_chunk(start_page: int, end_page: int) -> list[dict[str, object]]:
    document = fitz.open(PDF_PATH)
    entries: list[dict[str, object]] = []

    with tempfile.TemporaryDirectory(prefix="porto-ocr-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)

        for page_index in range(start_page, end_page):
            page = document.load_page(page_index)
            pix = page.get_pixmap(
                matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE),
                alpha=False,
            )
            image_path = temp_dir / f"porto-page-{page_index + 1}.png"
            image_path.write_bytes(pix.tobytes("png"))

            lines = run_windows_ocr(image_path)
            text = normalize_text(" ".join(line for line in lines if line))
            entries.append({"page": page_index + 1, "text": text})

    document.close()
    return entries


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = fitz.open(PDF_PATH)
    total_pages = document.page_count
    document.close()

    ranges = chunk_ranges(total_pages, 24)
    entries: list[dict[str, object]] = []
    completed_pages = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_chunk, start, end): (start, end)
            for start, end in ranges
        }

        for future in as_completed(futures):
            chunk_entries = future.result()
            entries.extend(chunk_entries)
            completed_pages += len(chunk_entries)
            print(f"{completed_pages}/{total_pages}", flush=True)

    entries.sort(key=lambda item: int(item["page"]))
    OUTPUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"saved {OUTPUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
