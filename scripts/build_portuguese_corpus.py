from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

LOCAL_PYTHON_PACKAGES = Path(__file__).resolve().parents[1] / "work" / "python-packages"
if LOCAL_PYTHON_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PYTHON_PACKAGES))

try:
    import fitz  # type: ignore[import-not-found]
except Exception:
    fitz = None

try:
    from pypdf import PdfReader
except Exception:
    PdfReader = None


SOURCE_DIR = Path.home() / "Videos" / "Portugu\u00eas"
OUTPUT_DIR = Path("data") / "portuguese-corpus"
MIN_CHUNK_CHARS = 70
TARGET_CHUNK_CHARS = 520
MAX_CHUNK_CHARS = 760
MAX_TERM_REFS_PER_GENRE = 700
WORD_RE = re.compile(r"[^\W\d_]+(?:[-'][^\W\d_]+)*", re.UNICODE)
SENTENCE_RE = re.compile(r"(?<=[.!?;:])\s+")
MOJIBAKE_RE = re.compile(r"(?:Ã[\x80-\xbf]|Â[\x80-\xbf]|â(?:€.|[\x80-\x9f].?)|�)")


PARATEXT_PATTERNS = [
    "agradecimentos",
    "apresentacao",
    "bibliografia",
    "catalogacao",
    "cdd",
    "cdu",
    "comentario",
    "copyright",
    "creditos",
    "dados de copyright",
    "direitos reservados",
    "editora",
    "estabelecimento de texto",
    "ficha catalografica",
    "folha de rosto",
    "fortuna critica",
    "isbn",
    "le livros",
    "nota editorial",
    "notas especiais",
    "organizacao",
    "posfacio",
    "prefacio",
    "preparacao de originais",
    "proibida a reproducao",
    "revisao",
    "sumario",
    "todos os direitos",
]

HARD_SKIP_PATTERNS = [
    "atendimento e venda direta",
    "cadastre se",
    "junte se ao nosso canal",
    "record e participe",
    "seja um leitor preferencial",
    "telegram",
    "tg join",
    "isbn",
    "cdd ",
    "cdu ",
    "copyright",
    "todos os direitos reservados",
]

CHUNK_SKIP_PATTERNS = [
    "a esquerda",
    "a festa liturgica",
    "atitude da imprensa",
    "breve biografia da organizadora",
    "carta a casais monteiro",
    "conhecida por",
    "confrades do parnaso",
    "contemporaneos do poeta",
    "cervantes",
    "diogo de couto",
    "dicionario de filosofia",
    "dicionario de losoa",
    "dicionarios gerais",
    "dois primeiros poemas",
    "edicao",
    "eds",
    "estrofe",
    "esta hipotese",
    "exegeta",
    "facil leitura",
    "ibid",
    "leio a como",
    "lessing",
    "manuscrito",
    "mensagens semelhantes",
    "mestre e discipulo",
    "melhor compreensao",
    "modernismo brasileiro",
    "neste poema ms",
    "nota do editor",
    "nota do organizador",
    "nota do tradutor",
    "pag",
    "pagina",
    "parte inferior da gravura",
    "pessoa poetas",
    "pessoa f",
    "planta cucurbitacea",
    "poeta origem",
    "poema se fecha",
    "poetica do autor",
    "professora de lingua portuguesa",
    "producao poetica",
    "realidade literaria",
    "roman jakobson",
    "verso novo",
    "publicado in",
    "refere se ao",
    "setor de obras raras",
    "testemunho ms",
    "vers hebr",
    "versao hebraica",
    "verso seguinte",
]

GENERIC_COLLECTION_TITLES = {
    "antologia",
    "antologia poetica",
    "ficcao completa",
    "obra completa",
    "obra poetica completa",
    "obras",
    "obras completas",
    "poesia completa",
}

JUNK_WORK_TITLE_PATTERNS = [
    "coleccao",
    "colecao",
    "classicos",
    "sa da costa",
    "prefacio",
    "nota previa",
    "correccoes",
    "correcoes",
]

KNOWN_WORK_TITLES_BY_AUTHOR = {
    "machado de assis": [
        "Ressurreição",
        "A Mão e a Luva",
        "Helena",
        "Iaiá Garcia",
        "Memórias Póstumas de Brás Cubas",
        "Quincas Borba",
        "Dom Casmurro",
        "Esaú e Jacó",
        "Memorial de Aires",
        "Contos Fluminenses",
        "Histórias da Meia-Noite",
        "Papéis Avulsos",
        "Histórias sem Data",
        "Várias Histórias",
        "Páginas Recolhidas",
        "Relíquias de Casa Velha",
        "A Semana",
    ],
    "eca de queiroz": [
        "O Crime do Padre Amaro",
        "O Primo Basílio",
        "Os Maias",
        "A Relíquia",
        "A Cidade e as Serras",
        "A Ilustre Casa de Ramires",
        "O Mandarim",
        "Alves & Cia.",
        "A Correspondência de Fradique Mendes",
    ],
    "jose de alencar": [
        "O Guarani",
        "Iracema",
        "Lucíola",
        "Diva",
        "A Pata da Gazela",
        "Sonhos d'Ouro",
        "Senhora",
        "Encarnação",
        "Til",
        "O Tronco do Ipê",
        "Ubirajara",
        "As Minas de Prata",
        "Guerra dos Mascates",
    ],
    "joao guimaraes rosa": [
        "Sagarana",
        "Grande Sertão: Veredas",
        "Grande Sertão - Veredas",
        "Corpo de Baile",
        "Manuelzão e Miguilim",
        "Noites do Sertão",
        "Tutameia",
        "Primeiras Estórias",
    ],
}

GENRE_POETRY_HINTS = [
    "antologia poetica",
    "auto da barca",
    "balada",
    "bilac",
    "bocage",
    "bruno tolentino",
    "camoes",
    "cecilia meireles",
    "cruz e souza",
    "drummond",
    "far\u00f3is",
    "farois",
    "goncalves dias",
    "lusiadas",
    "olavo",
    "poesia",
    "poemas",
    "poetica",
    "sapos",
    "sonetos",
    "vinicius",
]

GENRE_PROSE_HINTS = [
    "abdias",
    "alencar",
    "amanuense",
    "barbosa",
    "brasileira de prazins",
    "camilo castelo branco",
    "corcao",
    "cyro dos anjos",
    "eca de queiroz",
    "ficcao",
    "guimaraes rosa",
    "herberto sales",
    "jose geraldo vieira",
    "machado de assis",
    "marques rebelo",
    "octavio de faria",
    "padre antonio vieira",
    "padre manuel bernardes",
    "rosa",
    "rui barbosa",
    "sertao",
    "tragedia burguesa",
]

START_HINTS_BY_AUTHOR = {
    "bocage": [
        "sonetos",
        "idilios",
        "epistolas",
    ],
    "machado de assis": [
        "ressurreicao",
        "a mao e a luva",
        "memorias postumas de bras cubas",
    ],
    "eca de queiroz": [
        "o crime do padre amaro",
        "o primo basilio",
        "os maias",
    ],
    "jose de alencar": [
        "o guarani",
        "iracema",
        "senhora",
        "luc\u00edola",
        "luciola",
    ],
    "joao guimaraes rosa": [
        "nonada",
        "tiros que o senhor ouviu",
        "sagarana",
        "grande sertao",
        "manuelzao e miguilim",
    ],
    "padre antonio vieira": [
        "sermao",
        "carta",
        "representacao",
    ],
}

MIN_START_PAGE_BY_AUTHOR = {
    "alberto da cunha melo": 68,
    "bocage": 120,
    "eca de queiroz": 675,
    "joao guimaraes rosa": 34,
    "jose de alencar": 53,
    "machado de assis": 361,
}

MIN_START_PAGE_BY_TITLE_PATTERN = {
    "padre antonio vieira obra completa tomo 01 volume 01": 180,
}


def normalize_key(value: str) -> str:
    compact = " ".join(value.replace("\u00ad", "").split()).strip().lower()
    without_marks = "".join(
        character
        for character in unicodedata.normalize("NFD", compact)
        if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", " ", without_marks).strip()


def normalize_lookup_key(value: str) -> str:
    compact = normalize_key(value)
    return compact.replace(" ", "")


def parse_document_identity(path: Path) -> tuple[str, str]:
    stem = path.stem.replace(" \u2013 ", " - ").replace("\u2013", "-")
    if " - " not in stem:
        return "Autor nao identificado", stem.strip()
    author, title = stem.split(" - ", 1)
    return author.strip(), title.strip()


def infer_declared_genre(path: Path, author: str, title: str) -> str:
    haystack = normalize_key(f"{path.stem} {author} {title}")
    poetry = any(hint in haystack for hint in GENRE_POETRY_HINTS)
    prose = any(hint in haystack for hint in GENRE_PROSE_HINTS)

    if poetry and prose:
        return "misto"
    if poetry:
        return "poesia"
    if prose:
        return "prosa"
    return "misto"


def is_generic_collection_title(title: str) -> bool:
    title_key = normalize_key(title)
    return (
        title_key in GENERIC_COLLECTION_TITLES
        or title_key.startswith(("obra completa", "obras completas"))
        or title_key.startswith(("poesia completa", "obra poetica completa"))
        or "antologia poetica" in title_key
        or "ficcao completa" in title_key
    )


def tidy_detected_title(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" -—:;.,")
    value = re.sub(r"^(livro|parte|capitulo|capítulo)\s+[ivxlcdm0-9]+\s*[-—:]\s*", "", value, flags=re.I)
    return value.strip()


def title_case_if_shouting(value: str) -> str:
    letters = [character for character in value if character.isalpha()]
    if letters and sum(1 for character in letters if character.isupper()) / len(letters) > 0.82:
        return value.title()
    return value


def is_junk_work_title(value: str) -> bool:
    normalized = normalize_key(value)
    compact = normalized.replace(" ", "")
    letters = [character for character in value if character.isalpha()]
    digits = [character for character in value if character.isdigit()]

    return (
        len(normalized) < 2
        or any(pattern in normalized for pattern in JUNK_WORK_TITLE_PATTERNS)
        or normalized.startswith(("obra completa", "obras completas"))
        or re.fullmatch(r"[ivxlcdm0-9 .-]+", normalized) is not None
        or len(compact) <= 3
        or (bool(digits) and len(digits) >= len(letters))
    )


def detect_known_work_title(author: str, text: str) -> str | None:
    author_key = normalize_key(author)
    normalized_text = normalize_key(text)

    for known_author, titles in KNOWN_WORK_TITLES_BY_AUTHOR.items():
        if known_author not in author_key:
            continue

        for title in titles:
            if normalize_key(title) in normalized_text:
                return title

    return None


def detect_vieira_work_title(lines: list[str]) -> str | None:
    for index, line in enumerate(lines[:14]):
        normalized = normalize_key(line)

        if not normalized.startswith(
            (
                "apologia",
                "carta",
                "certidao",
                "consulta",
                "defesa",
                "discurso",
                "informacao",
                "instrucao",
                "memorial",
                "oficio",
                "parecer",
                "proposta",
                "razoes",
                "relacao",
                "representacao",
                "resposta",
                "sermao",
                "voto",
            )
        ):
            continue

        parts = [line]
        for next_line in lines[index + 1 : index + 3]:
            if len(next_line) <= 96 and not line_is_editorial(next_line):
                parts.append(next_line)

        return title_case_if_shouting(tidy_detected_title(" ".join(parts)))

    return None


def detect_work_title(author: str, document_title: str, page_text: str) -> str | None:
    lines = [clean_line(line) for line in page_text.splitlines()]
    lines = [line for line in lines if line and not line_is_editorial(line)]
    joined = "\n".join(lines[:24])
    known = detect_known_work_title(author, joined)

    if known:
        return known

    if "padre antonio vieira" in normalize_key(author):
        vieira_title = detect_vieira_work_title(lines)

        if vieira_title:
            return vieira_title

    if not is_generic_collection_title(document_title):
        return None

    for line in lines[:10]:
        normalized = normalize_key(line)
        word_count = len(normalized.split())
        letters = [character for character in line if character.isalpha()]
        uppercase_ratio = (
            sum(1 for character in letters if character.isupper()) / len(letters)
            if letters
            else 0
        )

        if (
            1 <= word_count <= 8
            and 3 <= len(line) <= 90
            and uppercase_ratio >= 0.72
            and not is_junk_work_title(line)
        ):
            return title_case_if_shouting(tidy_detected_title(line))

    return None


def clean_raw_text(value: str) -> str:
    value = repair_mojibake(value)
    value = value.replace("\u00ad\n", "")
    value = value.replace("\u00ad", "")
    value = "".join(
        character
        for character in value
        if character in "\n\t" or unicodedata.category(character)[0] != "C"
    )
    value = re.sub(r"-\n(?=\w)", "", value)
    value = value.replace("\r", "")
    return value


def mojibake_score(value: str) -> int:
    return len(MOJIBAKE_RE.findall(value))


def repair_mojibake(value: str) -> str:
    replacements = {
        "Â«": "«",
        "Â»": "»",
        "Â·": "·",
        "Âº": "º",
        "Âª": "ª",
        "Â§": "§",
        "Â©": "©",
        "Â®": "®",
        "â€”": "—",
        "â€“": "–",
        "â€œ": "“",
        "â€": "”",
        "â€˜": "‘",
        "â€™": "’",
        "â€¦": "…",
        "â€¢": "•",
    }
    for broken, fixed in replacements.items():
        value = value.replace(broken, fixed)

    if mojibake_score(value) == 0:
        return value

    candidates = [value]
    for encoding in ("cp1252", "latin1"):
        try:
            candidates.append(value.encode(encoding).decode("utf-8"))
        except UnicodeError:
            continue

    return min(candidates, key=lambda candidate: (mojibake_score(candidate), candidate.count("�")))


def clean_line(value: str) -> str:
    value = " ".join(value.replace("\u00a0", " ").split())
    value = re.sub(r"^OBRAS DE [A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]+\s*[-—]\s*", "", value)
    value = re.sub(r"^PADRE ANT[ÓO]NIO VIEIRA\s*", "", value, flags=re.I)
    value = re.sub(r"^\d+\s*$", "", value)
    value = re.sub(r"^[|_\-–—·•. ]+$", "", value)
    return value.strip()


def paratext_score(text: str) -> int:
    normalized = normalize_key(text)
    return sum(1 for pattern in PARATEXT_PATTERNS if pattern in normalized)


def has_hard_skip_signal(line: str) -> bool:
    raw = line.lower()
    if any(marker in raw for marker in ("www.", "http://", "https://", "tg://", "@")):
        return True
    normalized = normalize_key(line)
    return any(pattern in normalized for pattern in HARD_SKIP_PATTERNS)


def line_is_editorial(line: str) -> bool:
    normalized = normalize_key(line)
    compact = normalized.replace(" ", "")
    if len(normalized) < 2:
        return True
    if has_hard_skip_signal(line):
        return True
    if len(line) <= 180 and (
        compact.startswith(("tomo", "volume"))
        or compact.startswith("obrasde")
        or compact.startswith(("coleccao", "colecao"))
        or "obracompleta" in compact
        or "classicos" in compact
        or "sadacosta" in compact
        or "classicosdaliteraturaportuguesa" in compact
    ):
        return True
    if normalized in {"sumario", "indice", "notas", "bibliografia", "creditos"}:
        return True
    if normalized.startswith(("pagina ", "volume ", "tomo ")):
        return True
    if re.fullmatch(r"[ivxlcdm0-9 .-]+", normalized):
        return True
    return False


def poetry_shape_score(lines: list[str]) -> float:
    usable = [line for line in lines if len(line) >= 2]
    if len(usable) < 4:
        return 0.0
    short_lines = [line for line in usable if 3 <= len(line) <= 78]
    avg_length = sum(len(line) for line in usable) / len(usable)
    return (len(short_lines) / len(usable)) + (0.25 if avg_length <= 70 else 0)


def infer_chunk_genre(declared_genre: str, lines: list[str]) -> str:
    if declared_genre in {"poesia", "prosa"}:
        return declared_genre
    return "poesia" if poetry_shape_score(lines) >= 0.78 else "prosa"


def page_is_likely_literary(text: str, declared_genre: str) -> bool:
    if len(re.sub(r"\s+", "", text)) < 120:
        return False

    lines = [clean_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    score = paratext_score(text)

    if score >= 3:
        return False

    if declared_genre == "poesia":
        return poetry_shape_score(lines) >= 0.55

    if declared_genre == "prosa":
        return score == 0 and len(" ".join(lines)) >= 240

    return score <= 1 and (
        poetry_shape_score(lines) >= 0.55 or len(" ".join(lines)) >= 260
    )


def find_start_page(page_texts: list[str], author: str, title: str, declared_genre: str) -> int:
    author_key = normalize_key(author)
    title_key = normalize_key(title)
    hints = list(START_HINTS_BY_AUTHOR.get(author_key, []))
    title_pattern_key = normalize_key(f"{author} {title}")
    title_min_start = max(
        (
            page
            for pattern, page in MIN_START_PAGE_BY_TITLE_PATTERN.items()
            if pattern in title_pattern_key
        ),
        default=1,
    )
    min_start_index = max(
        0,
        MIN_START_PAGE_BY_AUTHOR.get(author_key, 1) - 1,
        title_min_start - 1,
    )
    generic_title_keys = {
        "antologia",
        "antologia poetica",
        "obra completa",
        "obra poetica completa",
        "obras",
        "obras completas",
        "poesia completa",
    }

    if title_key and len(title_key) > 5 and title_key not in generic_title_keys:
        hints.insert(0, title_key)

    max_scan = min(len(page_texts), max(420, min_start_index + 420))
    for index, text in enumerate(page_texts[:max_scan]):
        if index < min_start_index:
            continue
        normalized = normalize_key(text)
        if any(hint and hint in normalized for hint in hints):
            if page_is_likely_literary(text, declared_genre) or index > 8:
                return index

    for index, text in enumerate(page_texts[:max_scan]):
        if index < max(2, min_start_index):
            continue
        if page_is_likely_literary(text, declared_genre):
            return index

    return 0


def extract_page_texts(path: Path) -> tuple[list[str], int]:
    if fitz is not None:
        document = fitz.open(str(path))
        try:
            page_texts = [clean_raw_text(page.get_text("text") or "") for page in document]
            return page_texts, document.page_count
        finally:
            document.close()

    if PdfReader is None:
        raise RuntimeError("Nenhum extrator de PDF disponivel: instale PyMuPDF ou pypdf.")

    reader = PdfReader(str(path))
    page_texts: list[str] = []

    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        page_texts.append(clean_raw_text(text))

    return page_texts, len(reader.pages)


def cleaned_literary_lines(page_text: str) -> list[str]:
    lines = [clean_line(line) for line in page_text.splitlines()]
    cleaned: list[str] = []

    for line in lines:
        if not line:
            continue
        if line_is_editorial(line):
            continue
        cleaned.append(line)

    return cleaned


def chunk_prose(lines: list[str]) -> Iterable[str]:
    paragraph = " ".join(lines)
    paragraph = re.sub(r"\s+", " ", paragraph).strip()
    if not paragraph:
        return

    sentences = SENTENCE_RE.split(paragraph)
    current: list[str] = []
    current_len = 0

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        current.append(sentence)
        current_len += len(sentence)
        if current_len >= TARGET_CHUNK_CHARS:
            yield " ".join(current).strip()
            current = []
            current_len = 0

    if current:
        yield " ".join(current).strip()


def chunk_poetry(lines: list[str]) -> Iterable[str]:
    current: list[str] = []
    current_len = 0

    for line in lines:
        current.append(line)
        current_len += len(line)
        if len(current) >= 4 or current_len >= 260:
            yield "\n".join(current).strip()
            current = []
            current_len = 0

    if current:
        yield "\n".join(current).strip()


def valid_chunk_text(text: str) -> bool:
    if len(text) < MIN_CHUNK_CHARS:
        return False
    if re.search(r"\.{4,}", text):
        return False
    if text.count(" / ") >= 4:
        return False
    if paratext_score(text) >= 2:
        return False
    normalized = normalize_key(text)
    if any(pattern in normalized for pattern in CHUNK_SKIP_PATTERNS):
        return False
    if sum(1 for _ in WORD_RE.finditer(text)) < 12:
        return False
    return True


def chunk_page(page_text: str, declared_genre: str) -> list[tuple[str, str]]:
    lines = cleaned_literary_lines(page_text)
    if not lines:
        return []

    if declared_genre == "poesia":
        lines = [line for line in lines if len(line) <= 112]

        if poetry_shape_score(lines) < 0.5:
            return []

    genre = infer_chunk_genre(declared_genre, lines)
    raw_chunks = chunk_poetry(lines) if genre == "poesia" else chunk_prose(lines)
    output: list[tuple[str, str]] = []

    for chunk in raw_chunks:
        chunk = chunk.strip()
        if len(chunk) > MAX_CHUNK_CHARS:
            chunk = chunk[:MAX_CHUNK_CHARS].rsplit(" ", 1)[0].strip()
        if valid_chunk_text(chunk):
            output.append((genre, chunk))

    return output


def words_in_text(text: str) -> set[str]:
    words: set[str] = set()
    for match in WORD_RE.finditer(text):
        raw = match.group(0)
        key = normalize_lookup_key(raw)
        if len(key) < 2:
            continue
        if re.fullmatch(r"[ivxlcdm]+", key):
            continue
        words.add(key)
    return words


def thin_references(ids: list[int], maximum: int) -> list[int]:
    if len(ids) <= maximum:
        return ids

    if maximum <= 1:
        return ids[:maximum]

    step = (len(ids) - 1) / (maximum - 1)
    return [ids[round(index * step)] for index in range(maximum)]


def build_index(source_dir: Path, output_dir: Path, limit: int | None = None) -> None:
    files = sorted(source_dir.glob("*.pdf"), key=lambda path: normalize_key(path.name))
    if limit is not None:
        files = files[:limit]

    output_dir.mkdir(parents=True, exist_ok=True)
    documents: list[dict[str, object]] = []
    chunks: list[list[object]] = []
    terms: dict[str, dict[str, list[int]]] = defaultdict(lambda: {"poesia": [], "prosa": []})
    genre_counts: Counter[str] = Counter()
    skipped_documents: list[dict[str, str]] = []

    for doc_id, path in enumerate(files):
        author, title = parse_document_identity(path)
        declared_genre = infer_declared_genre(path, author, title)
        print(f"[{doc_id + 1}/{len(files)}] {path.name}")

        try:
            page_texts, page_count = extract_page_texts(path)
        except Exception as exc:
            skipped_documents.append({"file": path.name, "reason": str(exc)})
            print(f"  skipped: {exc}")
            continue

        start_page = find_start_page(page_texts, author, title, declared_genre)
        indexed_pages = 0
        doc_chunk_start = len(chunks)
        current_work_title = title

        for page_index, page_text in enumerate(page_texts[start_page:], start=start_page):
            if not page_text.strip():
                continue

            detected_work_title = detect_work_title(author, title, page_text)
            if detected_work_title:
                current_work_title = detected_work_title

            if not page_is_likely_literary(page_text, declared_genre):
                continue

            page_chunks = chunk_page(page_text, declared_genre)
            if not page_chunks:
                continue

            indexed_pages += 1

            for genre, text in page_chunks:
                chunk_id = len(chunks)
                chunks.append([doc_id, genre, page_index + 1, text, current_work_title])
                genre_counts[genre] += 1

                for term in words_in_text(text):
                    terms[term][genre].append(chunk_id)

        documents.append(
            {
                "author": author,
                "chunkCount": len(chunks) - doc_chunk_start,
                "declaredGenre": declared_genre,
                "id": doc_id,
                "indexedPages": indexed_pages,
                "pageCount": page_count,
                "sourcePdfName": path.name,
                "startPage": start_page + 1,
                "title": title,
            }
        )

    compact_terms: dict[str, dict[str, list[int]]] = {}
    capped_term_groups = 0
    for term, groups in terms.items():
        next_groups = {
            genre: thin_references(ids, MAX_TERM_REFS_PER_GENRE)
            for genre, ids in groups.items()
            if ids
        }
        if any(len(groups[genre]) > len(next_groups.get(genre, [])) for genre in groups):
            capped_term_groups += 1
        if next_groups:
            compact_terms[term] = next_groups

    payload = {
        "chunks": chunks,
        "documents": documents,
        "metadata": {
            "chunkCount": len(chunks),
            "cappedTermGroups": capped_term_groups,
            "completeTermIndex": False,
            "documentCount": len(documents),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "genreCounts": dict(genre_counts),
            "maxTermRefsPerGenre": MAX_TERM_REFS_PER_GENRE,
            "skippedDocuments": skipped_documents,
            "sourceDir": str(source_dir),
            "termCount": len(compact_terms),
        },
        "terms": compact_terms,
    }

    output_path = output_dir / "corpus.json"
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    metadata_path = output_dir / "metadata.json"
    metadata_path.write_text(
        json.dumps(payload["metadata"] | {"documents": documents}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Generated: {output_path}")
    print(f"Documents: {len(documents)}")
    print(f"Chunks: {len(chunks)}")
    print(f"Terms: {len(compact_terms)}")
    print(f"Genres: {dict(genre_counts)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a compact local corpus from Portuguese literary PDFs.",
    )
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    build_index(args.source_dir, args.output_dir, args.limit)


if __name__ == "__main__":
    main()
