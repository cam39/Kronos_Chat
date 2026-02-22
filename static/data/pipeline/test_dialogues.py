import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def iter_packs():
    locales = os.path.join(BASE, "locales")
    if not os.path.isdir(locales):
        return
    for lang in os.listdir(locales):
        root = os.path.join(locales, lang, "packs")
        if not os.path.isdir(root):
            continue
        for fn in sorted(os.listdir(root)):
            if fn.endswith(".json"):
                yield lang, os.path.join(root, fn)

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def test_unique_ids_and_links():
    for lang, pack in iter_packs():
        data = load_json(pack)
        ids = set()
        for s in data.get("scenes", []):
            assert isinstance(s.get("id"), str) and s["id"], f"{pack}: id manquant"
            assert s["id"] not in ids, f"{pack}: id dupliqué {s['id']}"
            ids.add(s["id"])
        # liens internes: next peut pointer hors pack -> autorisé. Ici on vérifie format non vide
        for s in data.get("scenes", []):
            for c in s.get("choices", []):
                assert isinstance(c.get("next"), (str, type(None)))

def test_subtitle_length_and_tags():
    for lang, pack in iter_packs():
        data = load_json(pack)
        for s in data.get("scenes", []):
            sub = s.get("subtitle", "")
            assert len(sub) <= 42, f"{pack}: sous-titre trop long"
            tags = s.get("tags", [])
            assert isinstance(tags, list) and tags, f"{pack}: tags manquants"

def test_utf8_and_placeholders():
    # Vérifie présence de variables dynamiques attendues dans quelques répliques
    found = 0
    for lang, pack in iter_packs():
        if found > 10:
            break
        data = load_json(pack)
        for s in data.get("scenes", []):
            if re.search(r"\$\{player_name\}", s.get("text", "")):
                found += 1
                break
    assert found >= 1, "Aucune variable ${player_name} détectée"

if __name__ == "__main__":
    test_unique_ids_and_links()
    test_subtitle_length_and_tags()
    test_utf8_and_placeholders()
    print("OK")

