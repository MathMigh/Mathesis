from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "outputs"
OUTPUT_TXT = OUTPUT_DIR / "mitologia_nomes_rascunho.txt"
OUTPUT_JSON = OUTPUT_DIR / "mitologia_nomes_rascunho.json"
TRANSLATION_CACHE = OUTPUT_DIR / "mitologia_translation_cache.json"
OUTPUT_TXT_SIMPLE = OUTPUT_DIR / "mitologia_nomes_avaliacao.txt"
MAX_TRANSLATION_LOOKUPS = 320
MAX_PER_BUCKET = 60

HEADERS = {"User-Agent": "Mozilla/5.0 (Mathesis research bot)"}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


THEOI_LIST_PAGES = [
    "https://www.theoi.com/Tree.html",
    "https://www.theoi.com/greek-mythology/greek-gods.html",
    "https://www.theoi.com/greek-mythology/olympian-gods.html",
    "https://www.theoi.com/greek-mythology/primeval-gods.html",
    "https://www.theoi.com/Titan/Titanes.html",
    "https://www.theoi.com/greek-mythology/sky-gods.html",
    "https://www.theoi.com/greek-mythology/sea-gods.html",
    "https://www.theoi.com/greek-mythology/rustic-gods.html",
    "https://www.theoi.com/greek-mythology/underworld-gods.html",
    "https://www.theoi.com/greek-mythology/nymphs.html",
    "https://www.theoi.com/greek-mythology/heroes.html",
    "https://www.theoi.com/greek-mythology/fantastic-creatures.html",
]

PANTHEON_ROOT = "https://pantheon.org/areas/"
PANTHEON_EXCLUDE = {"judaic"}

WIKI_LISTS = {
    "etrusca": "https://en.wikipedia.org/wiki/List_of_Etruscan_mythological_figures",
    "maia": "https://en.wikipedia.org/wiki/List_of_Maya_gods_and_supernatural_beings",
}

MYTHOPEDIA_GUIDES = [
    "greek-mythology",
    "roman-mythology",
    "norse-mythology",
    "egyptian-mythology",
    "celtic-mythology",
    "hindu-mythology",
    "aztec-mythology",
    "japanese-mythology",
    "chinese-mythology",
    "african-mythology",
]

STOP_TEXT = {
    "home",
    "about",
    "contact",
    "top",
    "browse articles",
    "more >>",
    "mythology",
    "folklore",
    "miscellaneous",
}

NOISE_EXACT = {
    "agriculture",
    "bloodletting",
    "call-outs",
    "cave sites",
    "hero",
    "hepatoscopy",
    "religious practice",
}

NOISE_PATTERNS = (
    r"\bgods?\b",
    r"\bheroes\b",
    r"\bliterature\b",
    r"\bmortals\b",
    r"\bolympians\b",
    r"\bprimordial\b",
    r"\btitans\b",
    r"\bunderworld\b",
    r"\bannals of\b",
    r"\btomb\b",
    r"\bliver\b",
    r"\bpractice\b",
)

MANUAL_PT = {
    "Apollo": "Apolo",
    "Aphrodite": "Afrodite",
    "Ares": "Ares",
    "Artemis": "Ártemis",
    "Athena": "Atena",
    "Demeter": "Deméter",
    "Dionysus": "Dioniso",
    "Hephaestus": "Hefesto",
    "Hermes": "Hermes",
    "Hestia": "Héstia",
    "Poseidon": "Poseidon",
    "Zeus": "Zeus",
    "Asclepius": "Asclépio",
    "Muses": "Musas",
    "Horae": "Horas",
    "Charites": "Cárites",
    "Nike": "Nice",
    "Gaea": "Gaia",
    "Hades": "Hades",
    "Hecate": "Hécate",
    "Nyx": "Nix",
    "Pan": "Pã",
    "Persephone": "Perséfone",
    "Uranus": "Urano",
    "Phoebus": "Febo",
    "Aeneas": "Eneias",
    "Heracles": "Héracles",
    "Hercules": "Hércules",
    "Odysseus": "Odisseu",
    "Jason": "Jasão",
    "Theseus": "Teseu",
    "Daedalus": "Dédalo",
    "Icarus": "Ícaro",
    "Orpheus": "Orfeu",
    "Perseus": "Perseu",
    "Medea": "Medeia",
    "Cyclops": "Ciclope",
    "Cybele": "Cibele",
    "Juno": "Juno",
    "Jupiter": "Júpiter",
    "Ceres": "Ceres",
    "Faunus": "Fauno",
    "Bacchus": "Baco",
    "Cupid": "Cupido",
}

MYTH_DESC_HINTS = (
    "mythology",
    "mythological",
    "deity",
    "deities",
    "god",
    "goddess",
    "hero",
    "heroes",
    "legendary",
    "supernatural",
    "spirit",
    "monster",
    "demigod",
    "trojan hero",
    "greek",
    "roman",
    "norse",
    "etruscan",
    "aztec",
    "maya",
    "hindu",
    "japanese",
    "celtic",
)


@dataclass(frozen=True)
class Entry:
    source: str
    tradition: str
    original: str
    portuguese: str
    url: str


def load_translation_cache() -> dict[str, str]:
    if TRANSLATION_CACHE.exists():
        return json.loads(TRANSLATION_CACHE.read_text(encoding="utf-8"))
    return {}


def save_translation_cache(cache: dict[str, str]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TRANSLATION_CACHE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


TRANSLATION_CACHE_DATA = load_translation_cache()
TRANSLATION_LOOKUPS_USED = 0


def fetch(url: str, timeout: int = 30) -> str:
    response = SESSION.get(url, timeout=timeout)
    response.raise_for_status()
    return response.text


def clean_name(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"\s*\([^)]*\)$", "", value).strip()
    value = value.strip("·•–—-:;,. ")
    return value


def is_candidate_name(text: str) -> bool:
    cleaned = clean_name(text)
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if lowered in STOP_TEXT:
        return False
    if len(cleaned) > 80:
        return False
    if cleaned in {"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"}:
        return False
    if re.search(r"\b(?:guide|mythology|religion|calendar|copyright|privacy|newsletter|photos)\b", lowered):
        return False
    return bool(re.search(r"[A-Za-zÀ-ÿ]", cleaned))


def looks_like_noise(text: str) -> bool:
    lowered = text.lower()
    if lowered.startswith("?"):
        return True
    if lowered in NOISE_EXACT:
        return True
    if re.search(r"\b(?:article|category|template|portal|help|special)\b", lowered):
        return True
    if re.search(r"\d{4,}", text):
        return True
    if any(re.search(pattern, lowered) for pattern in NOISE_PATTERNS):
        return True
    return False


def fetch_wikidata_entity(entity_id: str) -> dict | None:
    try:
        data = SESSION.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbgetentities",
                "ids": entity_id,
                "format": "json",
                "props": "labels|descriptions|sitelinks",
                "languages": "pt-br|pt|en",
                "sitefilter": "ptwiki",
            },
            timeout=30,
        ).json()
        return data.get("entities", {}).get(entity_id)
    except Exception:
        return None


def resolve_portuguese_name(original: str) -> str:
    global TRANSLATION_LOOKUPS_USED
    original = clean_name(original)
    if not original:
        return original
    if original in MANUAL_PT:
        return MANUAL_PT[original]
    if original in TRANSLATION_CACHE_DATA:
        return TRANSLATION_CACHE_DATA[original]
    if TRANSLATION_LOOKUPS_USED >= MAX_TRANSLATION_LOOKUPS:
        TRANSLATION_CACHE_DATA[original] = original
        return original

    try:
        TRANSLATION_LOOKUPS_USED += 1
        search = SESSION.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "format": "json",
                "language": "en",
                "search": original,
                "limit": 5,
            },
            timeout=30,
        ).json()
    except Exception:
        TRANSLATION_CACHE_DATA[original] = original
        return original

    best_pt = None
    for item in search.get("search", []):
        description = (item.get("description") or "").lower()
        if not any(hint in description for hint in MYTH_DESC_HINTS):
            continue
        entity = fetch_wikidata_entity(item["id"])
        if not entity:
            continue
        sitelink = entity.get("sitelinks", {}).get("ptwiki", {})
        label_pt = (
            entity.get("labels", {}).get("pt-br", {}).get("value")
            or entity.get("labels", {}).get("pt", {}).get("value")
            or sitelink.get("title")
        )
        if label_pt:
            best_pt = clean_name(label_pt.replace("_", " "))
            break

    if not best_pt:
        best_pt = original

    TRANSLATION_CACHE_DATA[original] = best_pt
    return best_pt


def collect_theoi() -> list[tuple[str, str, str, str]]:
    results: list[tuple[str, str, str, str]] = []
    seen = set()
    for url in THEOI_LIST_PAGES:
        html = fetch(url)
        soup = BeautifulSoup(html, "lxml")
        for a in soup.find_all("a", href=True):
            text = clean_name(a.get_text(" ", strip=True))
            href = urljoin(url, a["href"])
            if not is_candidate_name(text):
                continue
            if "theoi.com" not in href:
                continue
            if not re.search(r"/(?:Olympios|Ouranios|Pontios|Daimon|Khthonios|Protogenos|Georgikos|Nereis|Potamos|Titan|Gigante|Hero|Bestiary|greek-mythology)/", href):
                continue
            key = ("theoi", text, href)
            if key in seen:
                continue
            seen.add(key)
            results.append(("Theoi", "grega", text, href))
    return results


def collect_pantheon() -> list[tuple[str, str, str, str]]:
    results: list[tuple[str, str, str, str]] = []
    seen = set()
    soup = BeautifulSoup(fetch(PANTHEON_ROOT), "lxml")
    category_links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(PANTHEON_ROOT, a["href"])
        if re.search(r"/mythology/[^/]+/?$", href):
            slug = href.rstrip("/").split("/")[-1]
            if slug not in PANTHEON_EXCLUDE:
                category_links.append((slug, href))

    for tradition, category_url in sorted(set(category_links)):
        category_soup = BeautifulSoup(fetch(category_url), "lxml")
        letter_urls = []
        for a in category_soup.find_all("a", href=True):
            href = urljoin(category_url, a["href"])
            text = a.get_text(" ", strip=True)
            if re.fullmatch(r"[A-Z]", text) or "a-z.php" in href:
                letter_urls.append(href)
        if not letter_urls:
            letter_urls = [category_url]
        for page_url in sorted(set(letter_urls)):
            try:
                page_soup = BeautifulSoup(fetch(page_url), "lxml")
            except Exception:
                continue
            for a in page_soup.find_all("a", href=True):
                text = clean_name(a.get_text(" ", strip=True))
                href = urljoin(page_url, a["href"])
                if not is_candidate_name(text):
                    continue
                if "/articles/" not in href:
                    continue
                key = ("pantheon", tradition, text, href)
                if key in seen:
                    continue
                seen.add(key)
                results.append(("Pantheon", tradition, text, href))
    return results


def collect_mythopedia() -> list[tuple[str, str, str, str]]:
    results: list[tuple[str, str, str, str]] = []
    xml = fetch("https://mythopedia.com/sitemap.xml")
    locs = re.findall(r"<loc>([^<]+)</loc>", xml)
    seen = set()
    for loc in locs:
        parsed = urlparse(loc)
        if not parsed.path.startswith("/topics/"):
            continue
        slug = parsed.path.strip("/").split("/")[-1]
        if not slug:
            continue
        if any(bad in slug for bad in ["-play", "-religion", "-mythology", "-guide", "name-generator"]):
            continue
        name = clean_name(" ".join(part.capitalize() for part in slug.split("-")))
        if not is_candidate_name(name):
            continue
        tradition = "diversa"
        for guide in MYTHOPEDIA_GUIDES:
            if guide.split("-")[0] in slug:
                tradition = guide.replace("-mythology", "")
                break
        key = (name, loc)
        if key in seen:
            continue
        seen.add(key)
        results.append(("Mythopedia", tradition, name, loc))
    return results


def collect_wikipedia_lists() -> list[tuple[str, str, str, str]]:
    results: list[tuple[str, str, str, str]] = []
    for tradition, url in WIKI_LISTS.items():
        soup = BeautifulSoup(fetch(url), "lxml")
        content = soup.select_one("#mw-content-text") or soup
        for a in content.find_all("a", href=True):
            text = clean_name(a.get_text(" ", strip=True))
            href = urljoin(url, a["href"])
            if not is_candidate_name(text):
                continue
            if "/wiki/" not in href:
                continue
            if ":" in href.split("/wiki/")[-1]:
                continue
            results.append(("Wikipedia", tradition, text, href))
    return results


def build_entries(raw_rows: Iterable[tuple[str, str, str, str]]) -> list[Entry]:
    entries: list[Entry] = []
    seen = set()
    bucket_counts: dict[tuple[str, str], int] = defaultdict(int)
    for source, tradition, original, url in raw_rows:
        if looks_like_noise(original):
            continue
        bucket_key = (source, tradition)
        if bucket_counts[bucket_key] >= MAX_PER_BUCKET:
            continue
        pt = resolve_portuguese_name(original)
        if looks_like_noise(pt):
            continue
        key = (source, tradition, pt.lower(), original.lower())
        if key in seen:
            continue
        seen.add(key)
        bucket_counts[bucket_key] += 1
        entries.append(
            Entry(
                source=source,
                tradition=tradition,
                original=original,
                portuguese=pt,
                url=url,
            )
        )
    return sorted(entries, key=lambda item: (item.tradition, item.portuguese.lower(), item.original.lower()))


def write_outputs(entries: list[Entry]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[Entry]] = defaultdict(list)
    for entry in entries:
        grouped[entry.tradition].append(entry)

    lines = [
        "Base mitológica em rascunho para avaliação",
        "",
        "Observação: esta é uma primeira colheita automática a partir de índices e listas estruturadas. Os nomes foram aportuguesados por correspondência enciclopédica quando possível; nos casos sem forma portuguesa estável detectável, mantive a forma de origem.",
        "",
    ]
    simple_lines = [
        "Base mitológica em rascunho para avaliação",
        "",
        "Lista enxuta de nomes aportuguesados quando possível.",
        "",
    ]
    for tradition in sorted(grouped):
        lines.append(f"[{tradition.upper()}]")
        simple_lines.append(f"[{tradition.upper()}]")
        for entry in grouped[tradition]:
            if entry.portuguese == entry.original:
                lines.append(f"- {entry.portuguese} | fonte: {entry.source} | url: {entry.url}")
            else:
                lines.append(f"- {entry.portuguese} | original: {entry.original} | fonte: {entry.source} | url: {entry.url}")
            if entry.portuguese == entry.original:
                simple_lines.append(f"- {entry.portuguese}")
            else:
                simple_lines.append(f"- {entry.portuguese} ({entry.original})")
        lines.append("")
        simple_lines.append("")

    OUTPUT_TXT.write_text("\n".join(lines), encoding="utf-8")
    OUTPUT_TXT_SIMPLE.write_text("\n".join(simple_lines), encoding="utf-8")
    OUTPUT_JSON.write_text(
        json.dumps([entry.__dict__ for entry in entries], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    raw_rows: list[tuple[str, str, str, str]] = []
    raw_rows.extend(collect_theoi())
    raw_rows.extend(collect_pantheon())
    raw_rows.extend(collect_mythopedia())
    raw_rows.extend(collect_wikipedia_lists())
    entries = build_entries(raw_rows)
    write_outputs(entries)
    save_translation_cache(TRANSLATION_CACHE_DATA)
    print(f"entries={len(entries)}")
    print(OUTPUT_TXT)
    print(OUTPUT_TXT_SIMPLE)


if __name__ == "__main__":
    main()
