#!/usr/bin/env python3
# Vidéos YouTube pour les cours par structure de pions (onglet S'entraîner > Cours).
# Pour chaque structure : recherche YouTube (français et anglais), garde les vidéos les plus vues dont le titre parle
# vraiment de la structure, puis lit leurs sous-titres pour trouver le moment où elle est expliquée.
# N'écrit dans cours/videos.json (versionné, lu par le générateur) que l'identifiant de la vidéo, son titre, sa chaîne,
# son nombre de vues et le minutage : ni transcription, ni contenu de la vidéo.
# Outil local, à relancer de temps en temps (pas utilisé par la CI) :
#   python -m pip install yt-dlp
#   python videos_cours.py                 # toutes les structures
#   python videos_cours.py --min-vues 50000 --par-structure 4

import argparse, json, sys, unicodedata, urllib.request
from pathlib import Path

from chess_structures import STRUCTURES

OUT = Path(__file__).resolve().parent / "cours" / "videos.json"
SEARCH = 15                  # résultats lus par recherche
MIN_SECONDS, MAX_SECONDS = 180, 3600
PLAN_WORDS = ("plan", "structure", "strateg", "middlegame", "milieu de partie", "idee", "idea", "understand", "comprendre", "concept")
# requêtes, mots dont l'un doit figurer dans le titre, et si le titre doit aussi parler de plan ou de structure
# (sinon : pièges d'ouverture, parties commentées…)
QUERIES = {
    "pion_isole": (["pion dame isolé échecs", "isolated queen pawn chess plans"], ["pion isole", "pion dame isole", "isolated queen", "isolated pawn", "iqp", "isolani"], False),
    "pions_pendants": (["pions pendants échecs", "hanging pawns chess"], ["pions pendants", "hanging pawns"], False),
    "carlsbad": (["attaque de minorité échecs", "carlsbad structure minority attack"], ["carlsbad", "minority attack", "attaque de minorite"], False),
    "benoni": (["benoni structure plans échecs", "modern benoni pawn structure plans"], ["benoni"], True),
    "chaine_francaise": (["défense française avance plan", "french advance pawn chain plans"], ["french", "francaise", "pawn chain", "chaine de pions"], True),
    "chaine_est_indienne": (["est-indienne plans structure", "king's indian pawn structure plans"], ["king's indian", "kings indian", "est-indienne", "est indienne"], True),
    "maroczy": (["maroczy bind plans", "étau de maroczy échecs", "hedgehog structure chess"], ["maroczy", "hedgehog", "herisson"], False),
    "sicilienne": (["sicilienne ouverte plans milieu de partie", "open sicilian pawn structure plans"], ["sicilian", "sicilienne"], True),
    "stonewall": (["stonewall échecs plans", "stonewall structure chess plans"], ["stonewall"], False),
    "londres": (["système de londres plans", "london system middlegame plans"], ["london", "londres"], True),
    "italienne": (["partie italienne plans milieu de partie", "italian game middlegame plans"], ["italian", "italienne", "giuoco"], True),
    "colonne_d": (["partie écossaise plans", "scotch game middlegame plans", "ruy lopez exchange plans"], ["scotch", "ecossaise", "exchange ruy", "ruy lopez exchange", "espagnole"], True),
    "colonne_e": (["française variante d'échange plans", "french exchange variation plans"], ["exchange french", "french exchange", "francaise", "symmetrical"], True),
    "centre_ouvert": (["centre ouvert échecs stratégie", "open center chess strategy"], ["open center", "open centre", "centre ouvert", "open position"], True),
}


def plain(s):
    """Minuscules sans accents, pour comparer les titres aux mots-clés."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn").replace("’", "'")


def search(ydl, query):
    info = ydl.extract_info(f"ytsearch{SEARCH}:{query}", download=False)
    return [e for e in info.get("entries") or [] if e and e.get("id")]


def caption_moment(ydl, video_id, words):
    """(secondes, nombre de mentions) du premier passage des sous-titres qui cite un des mots, ou (None, 0)."""
    try:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    except Exception:
        return None, 0
    tracks = {**(info.get("automatic_captions") or {}), **(info.get("subtitles") or {})}
    lang = next((l for l in ("fr", "en", "fr-FR", "en-US", "en-GB") if l in tracks), None)
    if not lang:
        return None, 0
    url = next((t["url"] for t in tracks[lang] if t.get("ext") == "json3"), None)
    if not url:
        return None, 0
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            events = json.loads(r.read().decode("utf-8")).get("events", [])
    except Exception:
        return None, 0
    first, hits = None, 0
    for e in events:
        text = plain("".join(s.get("utf8", "") for s in e.get("segs") or []))
        if any(w in text for w in words):
            hits += 1
            if first is None:
                first = max(0, e.get("tStartMs", 0) // 1000 - 5)   # quelques secondes avant la phrase
    return first, hits


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Choisit les vidéos YouTube des cours par structure (cours/videos.json)")
    parser.add_argument("--min-vues", type=int, default=20000, help="vues minimum d'une vidéo (défaut : 20000)")
    parser.add_argument("--par-structure", type=int, default=3, help="vidéos gardées par structure (défaut : 3)")
    parser.add_argument("--structures", default="", help="structures à traiter, séparées par des virgules (défaut : toutes)")
    args = parser.parse_args()
    try:
        import yt_dlp
    except ImportError:
        sys.exit("yt-dlp est nécessaire : python -m pip install yt-dlp")
    wanted = [k for k in (args.structures.split(",") if args.structures else STRUCTURES) if k in QUERIES]
    out = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    flat = yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True})
    full = yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True})
    for key in wanted:
        queries, words, need_plan = QUERIES[key]
        words = [plain(w) for w in words]
        found = {}
        for q in queries:
            try:
                entries = search(flat, q)
            except Exception as exc:
                print(f"{key} : recherche impossible ({exc})")
                continue
            for e in entries:
                title = plain(e.get("title") or "")
                views, length = e.get("view_count") or 0, e.get("duration") or 0
                if (views >= args.min_vues and MIN_SECONDS <= length <= MAX_SECONDS and any(w in title for w in words)
                        and (not need_plan or any(w in title for w in PLAN_WORDS))):
                    found[e["id"]] = {"id": e["id"], "titre": e.get("title"), "chaine": e.get("channel") or e.get("uploader") or "",
                                      "vues": views, "duree": length}
        chosen = []
        for v in sorted(found.values(), key=lambda v: -v["vues"]):
            if len(chosen) >= args.par_structure:
                break
            t, hits = caption_moment(full, v["id"], words)
            if t is not None and hits < 2:   # le titre en parle, la vidéo à peine : on passe
                continue
            v["t"] = t or 0
            chosen.append(v)
        print(f"{key} : {len(found)} vidéos candidates, {len(chosen)} retenues")
        if chosen:
            out[key] = chosen
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Écrit : {OUT}")


if __name__ == "__main__":
    main()
