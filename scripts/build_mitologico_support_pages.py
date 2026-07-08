from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

import fitz
from PIL import Image


MAX_BOOK_PAGE = 472
WINDOWS_OCR_SCRIPT = Path(__file__).with_name("windows_ocr_lines.ps1")


def normalize_space(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def merge_ocr_lines(lines: list[str]) -> str:
    merged: list[str] = []
    carry = ""

    for raw_line in lines:
        line = normalize_space(raw_line)

        if not line:
            continue

        if carry:
            line = carry + line
            carry = ""

        if line.endswith(("-", "‑", "–")):
            carry = line[:-1]
            continue

        merged.append(line)

    if carry:
        merged.append(carry)

    return normalize_space("\n".join(merged))


def clean_text_layer_page(text: str) -> str:
    cleaned = text.replace("\u00ad", "")
    cleaned = re.sub(r"([A-Za-zÀ-ÿ])-\n([A-Za-zÀ-ÿ])", r"\1\2", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return normalize_space(cleaned)


def render_page_image(page: fitz.Page, target: Path, scale: float) -> Path:
    if target.exists():
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    pix.save(target)
    return target


def crop_book_halves(source_image: Path, left_target: Path, right_target: Path) -> tuple[Path, Path]:
    if left_target.exists() and right_target.exists():
        return left_target, right_target

    image = Image.open(source_image)
    width, height = image.size
    gutter = int(width * 0.02)
    midpoint = width // 2

    left_box = (0, 0, max(midpoint - gutter, 1), height)
    right_box = (min(midpoint + gutter, width - 1), 0, width, height)

    image.crop(left_box).save(left_target)
    image.crop(right_box).save(right_target)
    return left_target, right_target


def run_windows_ocr(image_path: Path, cache_path: Path) -> list[str]:
    if cache_path.exists():
        try:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            lines = payload.get("lines", [])
            if isinstance(lines, list):
                return [str(line) for line in lines]
        except Exception:
            pass

    proc = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(WINDOWS_OCR_SCRIPT),
            str(image_path),
        ],
        capture_output=True,
    )

    if proc.returncode != 0:
        raise RuntimeError(
            f"OCR falhou em {image_path.name}: {proc.stderr.decode('utf-8', 'ignore')}"
        )

    raw = proc.stdout.decode("utf-8", "ignore")
    payload = json.loads(raw)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    lines = payload.get("lines", [])
    return [str(line) for line in lines] if isinstance(lines, list) else []


def extract_first_edition_pages(
    pdf: Path,
    pdf_page_offset: int,
) -> dict[str, object]:
    document = fitz.open(pdf)
    pages: list[dict[str, object]] = []

    for pdf_page_number in range(1, len(document) + 1):
        book_page = pdf_page_number - pdf_page_offset

        if book_page < 1 or book_page > MAX_BOOK_PAGE:
            continue

        text = clean_text_layer_page(document.load_page(pdf_page_number - 1).get_text("text"))

        if not text:
            continue

        pages.append(
            {
                "bookPage": book_page,
                "pdfPage": pdf_page_number,
                "text": text,
            }
        )

    return {
        "bookPageOffset": pdf_page_offset,
        "mode": "text-layer",
        "pageCount": len(document),
        "pages": pages,
        "sourcePdfName": pdf.name,
    }


def extract_second_edition_pages(
    pdf: Path,
    render_dir: Path,
    ocr_cache_dir: Path,
    scale: float,
    spread_offset: int,
) -> dict[str, object]:
    document = fitz.open(pdf)
    pages: list[dict[str, object]] = []

    for pdf_page_number in range(1, len(document) + 1):
        left_book_page = 2 * (pdf_page_number - spread_offset)
        right_book_page = left_book_page + 1

        if right_book_page < 1 or left_book_page > MAX_BOOK_PAGE:
            continue

        full_image = render_page_image(
            document.load_page(pdf_page_number - 1),
            render_dir / f"spread-{pdf_page_number:04d}.png",
            scale,
        )
        left_image, right_image = crop_book_halves(
            full_image,
            render_dir / f"spread-{pdf_page_number:04d}-left.png",
            render_dir / f"spread-{pdf_page_number:04d}-right.png",
        )

        for side_name, image_path, book_page in (
            ("left", left_image, left_book_page),
            ("right", right_image, right_book_page),
        ):
            if book_page < 1 or book_page > MAX_BOOK_PAGE:
                continue

            lines = run_windows_ocr(
                image_path,
                ocr_cache_dir / f"spread-{pdf_page_number:04d}-{side_name}.json",
            )
            text = merge_ocr_lines(lines)

            if not text:
                continue

            pages.append(
                {
                    "bookPage": book_page,
                    "pdfPage": pdf_page_number,
                    "side": side_name,
                    "text": text,
                }
            )

        if pdf_page_number % 20 == 0:
            print(f"OCR de apoio: {pdf_page_number}/{len(document)} paginas do segundo PDF.")

    return {
        "mode": "ocr-halves",
        "pageCount": len(document),
        "pages": pages,
        "sourcePdfName": pdf.name,
        "spreadOffset": spread_offset,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera bases locais de apoio por pagina para as edicoes portuguesas do Pierre Grimal.",
    )
    parser.add_argument("--first-pdf", type=Path, required=True)
    parser.add_argument("--second-pdf", type=Path, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data") / "mitologico-support",
    )
    parser.add_argument(
        "--render-dir",
        type=Path,
        default=Path("tmp") / "mitologico-support-render",
    )
    parser.add_argument(
        "--ocr-cache-dir",
        type=Path,
        default=Path("tmp") / "mitologico-support-ocr-cache",
    )
    parser.add_argument(
        "--first-pdf-page-offset",
        type=int,
        default=27,
        help="Numero de paginas preliminares antes da pagina 1 do verbetario na primeira edicao.",
    )
    parser.add_argument(
        "--second-spread-offset",
        type=int,
        default=2,
        help="Offset para mapear uma pagina-spread do segundo PDF ao numero da pagina de livro.",
    )
    parser.add_argument(
        "--render-scale",
        type=float,
        default=2.0,
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)

    first_payload = extract_first_edition_pages(
        args.first_pdf,
        pdf_page_offset=args.first_pdf_page_offset,
    )
    second_payload = extract_second_edition_pages(
        args.second_pdf,
        render_dir=args.render_dir,
        ocr_cache_dir=args.ocr_cache_dir,
        scale=args.render_scale,
        spread_offset=args.second_spread_offset,
    )

    (args.output_dir / "primeiro-pages.json").write_text(
        json.dumps(first_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (args.output_dir / "segundo-pages.json").write_text(
        json.dumps(second_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Primeira edicao: {len(first_payload['pages'])} paginas uteis")
    print(f"Segunda edicao: {len(second_payload['pages'])} paginas uteis")
    print(f"Saida: {args.output_dir}")


if __name__ == "__main__":
    main()
