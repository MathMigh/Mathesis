from __future__ import annotations

import json
import re
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "outputs"
RAW_JSON = OUTPUT_DIR / "mitologia_nomes_rascunho.json"
TRANSLATION_CACHE = OUTPUT_DIR / "mitologia_translation_cache.json"
OUT_TXT = OUTPUT_DIR / "mitologia_nomes_curada_avaliacao.txt"
OUT_JSON = OUTPUT_DIR / "mitologia_nomes_curada_avaliacao.json"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (Mathesis research bot)"})

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
    "Poseidon": "Posêidon",
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
    "Cyclopes": "Ciclopes",
    "Cybele": "Cibele",
    "Juno": "Juno",
    "Jupiter": "Júpiter",
    "Ceres": "Ceres",
    "Faunus": "Fauno",
    "Bacchus": "Baco",
    "Cupid": "Cupido",
    "Cronus": "Crono",
    "Cronos": "Crono",
    "Charybdis": "Caríbdis",
    "Scylla": "Cila",
    "Tethys": "Tétis",
    "Themis": "Têmis",
    "Rhea": "Reia",
    "Eos": "Eos",
    "Selene": "Selene",
    "Helios": "Hélio",
    "Achelous": "Aqueloo",
    "Eros": "Eros",
    "Eris": "Éris",
    "Hypnos": "Hipnos",
    "Metis": "Métis",
    "Mnemosyne": "Mnemosine",
    "Iapetus": "Jápeto",
    "Triton": "Tritão",
}

MYTH_HINTS = (
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
    "myth",
)

NOISE_EXACT = {
    "agriculture",
    "bloodletting",
    "call-outs",
    "cave sites",
    "hero",
    "hepatoscopy",
    "religious practice",
    "greek creatures",
    "greek heroes",
    "greek literature",
    "greek mortals",
    "greek olympians",
    "greek primordial gods",
    "greek titans",
    "greek underworld gods",
    "aztec gods",
    "chinese gods",
    "egyptian gods",
    "celtic gods",
    "celtic literature",
    "death gods",
    "death rituals",
    "humans",
    "pilgrimage",
    "priesthood",
    "sacrifice",
    "vision serpent",
    "ritual of the bacabs",
    "madrid codex",
    "liber linteus",
    "martianus capella",
    "latin",
    "umbrian",
    "popol vuh",
    "diego de landa",
}

NOISE_RE = re.compile(
    r"\b("
    r"gods?|heroes|literature|mortals|olympians|primordial|titans|underworld|"
    r"annals of|tomb|liver|practice|site|sites|religious|codex|rituals?|"
    r"daughter of|son of|attic hero|cosmology|war"
    r")\b",
    re.I,
)

TRADITION_ALLOW = {
    "grega",
    "greek",
    "roman",
    "etrusca",
    "maia",
    "norse",
    "diversa",
    "celtic",
    "aztec",
    "egyptian",
    "chinese",
    "japanese",
    "hindu",
    "african",
}

TRADITION_LABELS = {
    "grega": "Grega",
    "greek": "Grega",
    "roman": "Romana",
    "etrusca": "Etrusca",
    "maia": "Maia",
    "norse": "Nórdica",
    "diversa": "Diversa",
    "celtic": "Céltica",
    "aztec": "Asteca",
    "egyptian": "Egípcia",
    "chinese": "Chinesa",
    "japanese": "Japonesa",
    "hindu": "Hindu",
    "african": "Africana",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def clean_name(value: str) -> str:
    value = re.sub(r"\s+", " ", (value or "")).strip()
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value).strip()
    value = value.strip("·•–—-:;,. ")
    return value


def pretty_name(value: str) -> str:
    value = clean_name(value)
    if value.isupper():
        value = value.title()
    return value


def looks_like_noise(name: str) -> bool:
    lowered = clean_name(name).lower()
    if not lowered:
        return True
    if lowered in NOISE_EXACT:
        return True
    if lowered.startswith("?"):
        return True
    if NOISE_RE.search(lowered):
        return True
    if re.search(r"\d{4,}", lowered):
        return True
    return False


def good_shape(name: str) -> bool:
    name = clean_name(name)
    if not name or len(name) > 60:
        return False
    if re.search(r"[\\/]|[<>]|[=]", name):
        return False
    words = name.split()
    if len(words) > 3:
        return False
    if all(word.islower() for word in words) and len(words) > 1:
        return False
    return True


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


def resolve_pt(original: str, cache: dict[str, str], budget: dict[str, int]) -> str:
    original = clean_name(original)
    if not original:
        return original
    if original in MANUAL_PT:
        return MANUAL_PT[original]
    if original in cache:
        return cache[original]
    if budget["used"] >= budget["max"]:
        cache[original] = original
        return original
    try:
        budget["used"] += 1
        payload = SESSION.get(
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
        cache[original] = original
        return original

    for item in payload.get("search", []):
        description = (item.get("description") or "").lower()
        if not any(h in description for h in MYTH_HINTS):
            continue
        entity = fetch_wikidata_entity(item["id"])
        if not entity:
            continue
        label = (
            entity.get("labels", {}).get("pt-br", {}).get("value")
            or entity.get("labels", {}).get("pt", {}).get("value")
            or entity.get("sitelinks", {}).get("ptwiki", {}).get("title")
        )
        if label:
            cache[original] = pretty_name(label.replace("_", " "))
            return cache[original]

    cache[original] = original
    return original


def main() -> None:
    raw = load_json(RAW_JSON)
    cache = load_json(TRANSLATION_CACHE) if TRANSLATION_CACHE.exists() else {}
    budget = {"used": 0, "max": 900}

    curated = []
    seen = set()
    per_tradition = {}

    for item in raw:
        tradition = (item.get("tradition") or "").strip().lower()
        if tradition not in TRADITION_ALLOW:
            continue

        original = pretty_name(item.get("original") or "")
        if looks_like_noise(original) or not good_shape(original):
            continue

        pt = pretty_name(resolve_pt(original, cache, budget))
        if looks_like_noise(pt) or not good_shape(pt):
            continue

        key = (TRADITION_LABELS.get(tradition, tradition.title()), pt.lower(), original.lower())
        if key in seen:
            continue
        seen.add(key)

        per_tradition.setdefault(key[0], 0)
        if per_tradition[key[0]] >= 160:
            continue
        per_tradition[key[0]] += 1

        curated.append(
            {
                "tradition": key[0],
                "portuguese": pt,
                "original": original,
                "source": item.get("source"),
                "url": item.get("url"),
            }
        )

    curated.sort(key=lambda x: (x["tradition"], x["portuguese"].lower(), x["original"].lower()))
    save_json(TRANSLATION_CACHE, cache)
    save_json(OUT_JSON, curated)

    lines = [
        "Base mitológica curada para avaliação",
        "",
        "Critério desta versão: menos ruído, mais nomes plausíveis e mais aportuguesamento quando identificável com segurança.",
        "",
    ]
    current = None
    for item in curated:
        if item["tradition"] != current:
            current = item["tradition"]
            lines.append(f"[{current.upper()}]")
        if item["portuguese"].lower() == item["original"].lower():
            lines.append(f"- {item['portuguese']}")
        else:
            lines.append(f"- {item['portuguese']} ({item['original']})")
    lines.append("")
    OUT_TXT.write_text("\n".join(lines), encoding="utf-8")

    print(f"curated={len(curated)}")
    print(OUT_TXT)
    print(OUT_JSON)


if __name__ == "__main__":
    main()
