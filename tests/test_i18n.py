"""Traductions : chaque phrase française du tableau de bord a sa traduction dans chaque langue (templates/i18n/<langue>/*.json).

Côté JS, la clé est le littéral français passé à tx('…') ou txn(n, '…', '…') ; le texte fixe de dashboard.html est traduit
nœud par nœud au démarrage (i18n.js), donc chaque texte de la page et chaque placeholder/title/aria-label doit y être.
"""
import json
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import chess_dashboard_generator as gen

JS_DIR = gen.TEMPLATES_DIR / "js"
VAR = re.compile(r"\{(\w+)\}")
LETTER = re.compile(r"[A-Za-zÀ-ÿ]")


def js_string(src, i):
    """Littéral de chaîne JS commençant à src[i] → (valeur, fin) ; valeur None pour un gabarit avec ${…}."""
    q, j, out = src[i], i + 1, []
    while src[j] != q:
        if src[j] == "\\":
            nxt = src[j + 1]
            if nxt == "u":
                out.append(chr(int(src[j + 2:j + 6], 16))); j += 6; continue
            out.append({"n": "\n", "t": "\t"}.get(nxt, nxt)); j += 2; continue
        if q == "`" and src.startswith("${", j):
            return None, src.index("`", j + 1) + 1
        out.append(src[j]); j += 1
    return "".join(out), j + 1


def call_args(src, i):
    """Arguments de premier niveau de l'appel dont la parenthèse ouvrante est en src[i] : liste de (texte brut, valeur littérale ou None)."""
    args, depth, start, j = [], 0, i + 1, i + 1
    while True:
        c = src[j]
        if c in "'\"`":
            _, j = js_string(src, j); continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                args.append(src[start:j]); break
            depth -= 1
        elif c == "," and depth == 0:
            args.append(src[start:j]); start = j + 1
        j += 1
    out = []
    for a in args:
        s = a.strip()
        if s and s[0] in "'\"`":
            val, end = js_string(s, 0)
            out.append((s, val if end == len(s) else None))
        else:
            out.append((s, None))
    return out


def js_keys():
    """{clé française: fichier} de tous les tx('…') / txn(n,'…','…') littéraux, et la liste des appels non littéraux suspects."""
    keys, bad = {}, []
    for f in sorted(JS_DIR.glob("*.js")):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"(?<![\w$.])(txn?)\(", src):
            if f.name == "i18n.js":
                continue
            args = call_args(src, m.end() - 1)
            texts = args[:1] if m.group(1) == "tx" else args[1:3]
            for raw, val in texts:
                if val is not None:
                    keys.setdefault(val, f.name)
                elif raw[:1] == "`":
                    bad.append(f"{f.name}: gabarit avec ${{…}} comme clé : {raw[:60]}")
    return keys, bad


class PageText(HTMLParser):
    """Textes et attributs traduisibles d'une page HTML (hors <script>/<style>)."""
    def __init__(self):
        super().__init__(); self.skip = 0; self.texts = set()

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        for k, v in attrs:
            if k in ("placeholder", "title", "aria-label") and v:
                self.add(v)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.add(data)

    def add(self, s):
        k = " ".join(s.split())
        if k and LETTER.search(k) and not re.fullmatch(r"__\w+__", k):
            self.texts.add(k)


class Translations(unittest.TestCase):
    def setUp(self):
        self.langs = [l for l in gen.LANGUES if l != "fr"]

    def test_files_are_valid_and_consistent(self):
        for lang in self.langs:
            seen = {}
            for f in sorted((gen.I18N_DIR / lang).glob("*.json")):
                for k, v in json.loads(f.read_text(encoding="utf-8")).items():
                    self.assertIsInstance(v, str, f"{f.name}: {k!r}")
                    self.assertTrue(v.strip(), f"{f.name}: traduction vide pour {k!r}")
                    if k in seen:
                        self.assertEqual(seen[k][1], v, f"{lang}: {k!r} traduit différemment dans {seen[k][0]} et {f.name}")
                    seen[k] = (f.name, v)
                    self.assertEqual(set(VAR.findall(k)), set(VAR.findall(v)), f"{f.name}: variables différentes pour {k!r}")

    def test_every_js_key_is_translated(self):
        keys, bad = js_keys()
        self.assertFalse(bad, "\n".join(bad))
        self.assertGreater(len(keys), 50)
        for lang in self.langs:
            words = gen.translations(lang)
            missing = [f"{f}: {k!r}" for k, f in keys.items() if k not in words]
            self.assertFalse(missing, f"{len(missing)} phrases sans traduction ({lang}) :\n" + "\n".join(missing[:80]))

    def test_dashboard_page_text_is_translated(self):
        parser = PageText()
        parser.feed(gen.template("dashboard.html"))
        for lang in self.langs:
            words = gen.translations(lang)
            missing = sorted(k for k in parser.texts if k not in words)
            self.assertFalse(missing, f"{len(missing)} textes de dashboard.html sans traduction ({lang}) :\n" + "\n".join(missing[:80]))

    def test_home_pages(self):
        page = gen.localize(gen.template("accueil.html"), "en")
        self.assertIn('lang="en"', page)
        self.assertIn("Pick a player", page)
        self.assertEqual(gen.tr("{n} parties · {a} analysées · {p} positions d'entraînement", "en", n=3, a=2, p=10),
                         "3 games · 2 analysed · 10 training positions")
        self.assertEqual(gen.localize("<p>Mis à jour le X.</p>", "fr"), "<p>Mis à jour le X.</p>")

    def test_lock_page_language(self):
        page = gen.encrypt_page("x", "pw", "bob", "en")
        self.assertIn("TXT['en']", page)
        self.assertNotIn("__LANGUE__", page)

    def test_dashboard_carries_language(self):
        page = gen.dashboard_page("en")
        self.assertIn('<html lang="en">', page)
        for marker in ("__I18N__", "__LANGUE__", "__SCRIPT__"):
            self.assertNotIn(marker, page)


if __name__ == "__main__":
    unittest.main()
