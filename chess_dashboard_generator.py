#!/usr/bin/env python3
# Chess.com / Lichess personal dashboard generator
# Creates rapports/<joueur>/chess_dashboard.html and chess_games.csv (rapports/lichess_<joueur>/ pour Lichess),
# with an optional Stockfish analysis of the games (see chess_analysis.py).
# Requirements: Python 3.9+, requests and chess (python -m pip install -r requirements.txt)
#
# Usage (voir README.md) :
#   python chess_dashboard_generator.py --user <identifiant>    # analyse Stockfish des parties rapid
#   python chess_dashboard_generator.py --site lichess --user <identifiant>   # parties Lichess
#   python chess_dashboard_generator.py --cadences rapid,blitz  # ajoute le blitz (le cache évite de refaire le rapid)
#   python chess_dashboard_generator.py --since 2026-01         # période analysée (défaut : les 6 derniers mois)
#   python chess_dashboard_generator.py --no-analysis           # statistiques seules, sans moteur

import argparse, base64, csv, gzip, hashlib, html, json, os, re, secrets, shlex, shutil, sys, time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import requests

import chess_analysis

DEFAULT_USERNAME = "mahmoud_ben_salem"   # joueur analysé quand --user n'est pas précisé
DEFAULT_MONTHS = 6                       # période par défaut : le mois en cours et les 5 précédents
BASE_DIR = Path(__file__).resolve().parent
REPORTS_DIR = BASE_DIR / "rapports"
SITE_DIR = BASE_DIR / "site"                 # version publiée (--publier) : rapports chiffrés uniquement
PBKDF2_ITERATIONS = 600_000                  # dérivation de la clé de chiffrement à partir du mot de passe
CACHE_DIR = BASE_DIR / "cache"
ANALYSIS_CACHE = CACHE_DIR / "analyses.json"   # partagé entre joueurs : une partie entre deux amis n'est analysée qu'une fois
MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
             "septembre", "octobre", "novembre", "décembre"]
USERNAME = DEFAULT_USERNAME              # remplacé par --user dans main()
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "PersonalChessStats/1.0 (public-data analysis, https://github.com/official-stockfish/Stockfish)",
    "Accept": "application/json, text/plain, */*",
})

def get_json(url, retries=4):
    for attempt in range(retries):
        response = SESSION.get(url, timeout=45)
        if response.status_code == 429:
            wait = min(60, 5 * (attempt + 1))
            print(f"Limite API atteinte ; pause de {wait}s...")
            time.sleep(wait)
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"Impossible de récupérer {url} après plusieurs tentatives")

def month_key_from_url(url):
    m = re.search(r"/games/(\d{4})/(\d{2})$", url)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

def fetch_month(url, refresh):
    """Les mois terminés sont mis en cache localement ; le mois en cours est toujours re-téléchargé."""
    year, month = month_key_from_url(url)
    games_dir = CACHE_DIR / "parties" / USERNAME
    path = games_dir / f"{year:04d}-{month:02d}.json"
    now = datetime.now(timezone.utc)
    finished = (year, month) < (now.year, now.month)
    if finished and path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8")), True
    data = get_json(url)
    games_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data, False

def parse_date(game):
    if game.get("end_time"):
        return datetime.fromtimestamp(int(game["end_time"]), tz=timezone.utc).strftime("%Y-%m-%d")
    m = re.search(r'\[UTCDate "(\d{4}\.\d{2}\.\d{2})"\]', game.get("pgn", ""))
    return m.group(1).replace(".", "-") if m else ""

def player_side(game):
    me = USERNAME.lower()
    white = game.get("white", {})
    black = game.get("black", {})
    if white.get("username", "").lower() == me:
        return "Blancs", white, black
    if black.get("username", "").lower() == me:
        return "Noirs", black, white
    return "Inconnu", {}, {}

def result_for_me(game, side):
    mine = game.get("white" if side == "Blancs" else "black", {}).get("result", "")
    if mine == "win":
        return "Victoire"
    if mine in ("agreed", "stalemate", "repetition", "insufficient", "50move", "timevsinsufficient"):
        return "Nulle"
    if mine:
        return "Défaite"
    m = re.search(r'\[Result "([^"]+)"\]', game.get("pgn", ""))
    if m:
        res = m.group(1)
        if res == "1/2-1/2": return "Nulle"
        if res in ("1-0", "0-1"):
            return "Victoire" if (res == "1-0") == (side == "Blancs") else "Défaite"
    return "Inconnue"

def termination(mine, opp):
    """Code de fin de partie Chess.com : celui du perdant, ou celui de la nulle."""
    return opp.get("result", "") if mine.get("result") == "win" else mine.get("result", "")

def opening_name(game):
    pgn = game.get("pgn", "")
    m = re.search(r'\[ECOUrl "([^"]+)"\]', pgn)
    if m:
        return re.sub(r"-+", " ", m.group(1).rstrip("/").split("/")[-1])
    return game.get("eco", "").rsplit("/", 1)[-1] or "Inconnue"

def opening_variant(name):
    """« Caro Kann Defense Exchange Variation 3...cxd5 4.Nf3 » -> « Caro-Kann Defense Exchange Variation »"""
    v = re.split(r"\s*\.\.\.|\s+\d", name)[0].strip()
    v = re.sub(r"\s+(with|and)$", "", v).replace("Caro Kann", "Caro-Kann")
    return v or name

def opening_family(name):
    """« Caro-Kann Defense Exchange Variation » -> « Caro-Kann Defense », « Kings Gambit Declined ... » -> « Kings Gambit Declined »"""
    words = opening_variant(name).split()
    for i, w in enumerate(words):
        if w in ("Defense", "Opening", "Game", "Gambit", "Attack", "System", "Countergambit"):
            j = i + 1
            if j < len(words) and words[j] in ("Accepted", "Declined"):
                j += 1
            return " ".join(words[:j])
    return " ".join(words[:3]) or name

def game_row(game):
    side, mine, opp = player_side(game)
    date = parse_date(game)
    accuracies = game.get("accuracies") or {}
    my_acc = accuracies.get("white" if side == "Blancs" else "black")
    opp_acc = accuracies.get("black" if side == "Blancs" else "white")
    pgn = game.get("pgn", "")
    eco_match = re.search(r'\[ECO "([^"]+)"\]', pgn)
    opening = opening_name(game)
    return {
        "date": date, "mois": date[:7] if date else "Inconnu",
        "cadence": str(game.get("time_class") or "inconnu").lower(),
        "couleur": side, "resultat": result_for_me(game, side),
        "elo_joueur": mine.get("rating", ""), "elo_adversaire": opp.get("rating", ""),
        "adversaire": opp.get("username", "Inconnu"),
        "precision_joueur_%": my_acc if my_acc is not None else "",
        "precision_adversaire_%": opp_acc if opp_acc is not None else "",
        "ouverture": opening, "famille": opening_family(opening), "variante": opening_variant(opening),
        "ECO": eco_match.group(1) if eco_match else "",
        "lien": game.get("url", ""), "time_control": game.get("time_control", ""),
        "rated": game.get("rated", ""), "fin": termination(mine, opp),
        "rules": game.get("rules", "chess"),
    }

# ---------------------------------------------------------------- Lichess

LICHESS_STATUS = {   # statut Lichess -> code de fin Chess.com (déjà traduit par le tableau de bord)
    "mate": "checkmated", "resign": "resigned", "outoftime": "timeout", "timeout": "abandoned",
    "stalemate": "stalemate", "draw": "agreed", "insufficientMaterialClaim": "insufficient", "cheat": "cheat",
}

def fetch_lichess(since_ms, refresh):
    """Télécharge les parties Lichess terminées depuis since_ms (ms). Les parties déjà en cache ne sont pas
    re-téléchargées : seules celles créées après la plus récente du cache (moins un jour de marge) le sont."""
    path = CACHE_DIR / "parties" / f"lichess_{USERNAME}.json"
    cached = {}
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    games = {g["id"]: g for g in cached.get("games", [])}
    if refresh or not games or since_ms < cached.get("since", 0):
        games, start = {}, since_ms
    else:
        start = max(since_ms, max(g["createdAt"] for g in games.values()) - 86_400_000)
    params = {"since": start, "pgnInJson": "true", "clocks": "true", "opening": "true", "accuracy": "true"}
    url = f"https://lichess.org/api/games/user/{USERNAME}"
    for attempt in range(4):
        response = SESSION.get(url, params=params, headers={"Accept": "application/x-ndjson"}, stream=True, timeout=60)
        if response.status_code == 429:   # consigne Lichess : attendre une minute
            print("Limite API Lichess atteinte ; pause de 60s...")
            time.sleep(60)
            continue
        if response.status_code == 404:
            sys.exit(f"Joueur « {USERNAME} » introuvable sur Lichess : vérifie l'identifiant.")
        response.raise_for_status()
        new = 0
        for line in response.iter_lines():
            if line:
                g = json.loads(line)
                new += g["id"] not in games
                games[g["id"]] = g
                if new and new % 200 == 0:
                    print(f"  {new} nouvelles parties téléchargées...")
        break
    else:
        raise RuntimeError("Impossible de récupérer les parties Lichess après plusieurs tentatives")
    print(f"{new} nouvelles parties téléchargées ({len(games)} en cache).")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"since": min(since_ms, cached.get("since", since_ms)) if games else since_ms,
                                "games": list(games.values())}), encoding="utf-8")
    return [g for g in games.values() if g["createdAt"] >= since_ms]

def lichess_player_name(p):
    if p.get("user"):
        return p["user"].get("name", "Inconnu")
    return f"Stockfish niveau {p['aiLevel']}" if p.get("aiLevel") else "Anonyme"

def lichess_row(game):
    players = game.get("players", {})
    white, black = players.get("white", {}), players.get("black", {})
    if (white.get("user") or {}).get("id") == USERNAME:
        side, mine, opp = "Blancs", white, black
    elif (black.get("user") or {}).get("id") == USERNAME:
        side, mine, opp = "Noirs", black, white
    else:
        side, mine, opp = "Inconnu", {}, {}
    winner = game.get("winner")
    if side == "Inconnu":
        result = "Inconnue"
    elif not winner:
        result = "Nulle"
    else:
        result = "Victoire" if (winner == "white") == (side == "Blancs") else "Défaite"
    status = game.get("status", "")
    fin = "timevsinsufficient" if status == "outoftime" and not winner else LICHESS_STATUS.get(status, status)
    ts = game.get("lastMoveAt") or game.get("createdAt")
    date = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d") if ts else ""
    clock = game.get("clock")
    if clock:
        time_control = f"{clock['initial']}+{clock['increment']}"
    elif game.get("daysPerTurn"):
        time_control = f"1/{86400 * game['daysPerTurn']}"
    else:
        time_control = ""
    opening = game.get("opening") or {}
    name = opening.get("name") or "Inconnue"          # « Sicilian Defense: Najdorf Variation, English Attack »
    variant = game.get("variant", "standard")
    my_acc = (mine.get("analysis") or {}).get("accuracy")
    opp_acc = (opp.get("analysis") or {}).get("accuracy")
    return {
        "date": date, "mois": date[:7] if date else "Inconnu",
        "cadence": game.get("speed", "inconnu"),
        "couleur": side, "resultat": result,
        "elo_joueur": mine.get("rating", ""), "elo_adversaire": opp.get("rating", ""),
        "adversaire": lichess_player_name(opp) if opp else "Inconnu",
        "precision_joueur_%": my_acc if my_acc is not None else "",
        "precision_adversaire_%": opp_acc if opp_acc is not None else "",
        "ouverture": name, "famille": name.split(":")[0], "variante": name.split(",")[0],
        "ECO": opening.get("eco", ""),
        "lien": f"https://lichess.org/{game['id']}", "time_control": time_control,
        "rated": game.get("rated", ""), "fin": fin,
        "rules": "chess" if variant == "standard" else variant,
    }

def default_since():
    now = datetime.now()
    total = now.year * 12 + now.month - 1 - (DEFAULT_MONTHS - 1)
    return f"{total // 12:04d}-{total % 12 + 1:02d}"

def parse_since(value):
    m = re.fullmatch(r"(\d{4})-(\d{1,2})", value.strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise argparse.ArgumentTypeError("format attendu : AAAA-MM, par exemple 2026-04")
    return int(m.group(1)), int(m.group(2))

def fetch_chesscom(args):
    print(f"Récupération des archives publiques de {USERNAME}...")
    try:
        archive_data = get_json(f"https://api.chess.com/pub/player/{USERNAME}/games/archives")
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (404, 410):
            sys.exit(f"Joueur « {USERNAME} » introuvable sur Chess.com : vérifie l'identifiant.")
        raise
    urls = [u for u in archive_data.get("archives", []) if month_key_from_url(u) >= args.since]
    if not urls:
        sys.exit(f"Aucune partie depuis {args.since[0]}-{args.since[1]:02d} pour {USERNAME}. Essaie une date --since plus ancienne.")
    print(f"{len(urls)} archives mensuelles à traiter.")
    all_games, seen = [], set()
    for i, url in enumerate(urls, 1):
        data, cached = fetch_month(url, args.refresh)
        print(f"[{i}/{len(urls)}] {url}{' (cache)' if cached else ''}")
        for game in data.get("games", []):
            key = game.get("uuid") or game.get("url")
            if key and key not in seen:
                seen.add(key)
                all_games.append(game)
        if not cached:
            time.sleep(0.25)
    return [(game_row(g), g.get("pgn", "")) for g in all_games]

def fetch_lichess_rows(args):
    print(f"Récupération des parties Lichess de {USERNAME}...")
    since_ms = int(datetime(args.since[0], args.since[1], 1, tzinfo=timezone.utc).timestamp() * 1000)
    games = fetch_lichess(since_ms, args.refresh)
    games = [g for g in games if g.get("moves")]   # parties annulées avant le premier coup
    if not games:
        sys.exit(f"Aucune partie depuis {args.since[0]}-{args.since[1]:02d} pour {USERNAME}. Essaie une date --since plus ancienne.")
    return [(lichess_row(g), g.get("pgn", "")) for g in games]

def build_parser():
    parser = argparse.ArgumentParser(description="Dashboard Chess.com / Lichess + analyse Stockfish")
    parser.add_argument("--site", choices=("chesscom", "lichess"), default="chesscom",
                        help="site d'où viennent les parties (défaut : chesscom)")
    parser.add_argument("--user", default=DEFAULT_USERNAME, help=f"identifiant Chess.com ou Lichess du joueur (défaut : {DEFAULT_USERNAME})")
    parser.add_argument("--since", type=parse_since, default=parse_since(default_since()),
                        help=f"premier mois analysé, au format AAAA-MM (défaut : {default_since()}, soit les {DEFAULT_MONTHS} derniers mois)")
    parser.add_argument("--cadences", default="rapid",
                        help="cadences à analyser avec Stockfish, séparées par des virgules (défaut : rapid ; 'all' pour tout)")
    parser.add_argument("--depth", type=int, default=14, help="profondeur d'analyse Stockfish (défaut : 14)")
    parser.add_argument("--workers", type=int, default=None, help="nombre de moteurs en parallèle (défaut : nb de cœurs - 2)")
    parser.add_argument("--no-analysis", action="store_true", help="ne pas lancer Stockfish (le cache existant reste utilisé)")
    parser.add_argument("--refresh", action="store_true", help="re-télécharger aussi les parties déjà en cache")
    parser.add_argument("--amis", metavar="FICHIER",
                        help="génère le rapport de chaque joueur listé dans FICHIER (une ligne d'options par joueur), puis la page d'accueil rapports/index.html")
    parser.add_argument("--mot-de-passe", dest="password", help="mot de passe du rapport, utilisé avec --publier (à mettre dans amis.txt)")
    parser.add_argument("--publier", action="store_true",
                        help="avec --amis : écrit dans site/ les rapports chiffrés avec le mot de passe de chaque joueur, prêts à mettre en ligne")
    parser.add_argument("--nouveau-mot-de-passe", dest="new_password", action="store_true", help="affiche un mot de passe aléatoire solide et s'arrête")
    return parser

def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = build_parser()
    args = parser.parse_args()
    if args.new_password:
        print(new_password())
        return
    if args.publier and not args.amis:
        parser.error("--publier s'utilise avec --amis")
    if not args.amis:
        run(args)
        return
    if args.publier:
        shutil.rmtree(SITE_DIR, ignore_errors=True)
        SITE_DIR.mkdir()
    summaries = []
    for n, line in enumerate(Path(args.amis).read_text(encoding="utf-8").splitlines(), 1):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        try:
            sub = parser.parse_args(shlex.split(line))
            print(f"\n=== {sub.site} · {sub.user}")   # jamais la ligne entière : elle contient le mot de passe
            # les options passées en ligne de commande s'appliquent à tous les joueurs
            sub.no_analysis |= args.no_analysis
            sub.refresh |= args.refresh
            sub.workers = sub.workers or args.workers
            sub.publier = args.publier
            if sub.publier and not sub.password:
                print("Pas de --mot-de-passe sur cette ligne : rapport non publié.")
                continue
            summaries.append(run(sub))
        except (SystemExit, Exception) as exc:   # un joueur introuvable ne doit pas bloquer les autres
            print(f"Rapport impossible (ligne {n} de {args.amis}) : {exc}")
    if args.publier:
        write_public_index()
    else:
        write_index(summaries)

def new_password():
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"   # sans caractères ambigus (l, 1, o, 0, i)
    return "-".join("".join(secrets.choice(alphabet) for _ in range(5)) for _ in range(4))   # ≈ 99 bits

def run(args):
    """Génère le rapport d'un joueur et renvoie son résumé pour la page d'accueil."""
    global USERNAME
    USERNAME = args.user.strip().lower()
    lichess = args.site == "lichess"
    site_label = "Lichess" if lichess else "Chess.com"
    out_dir = (SITE_DIR if args.publier else REPORTS_DIR) / (f"lichess_{USERNAME}" if lichess else USERNAME)
    out_dir.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    pairs = fetch_lichess_rows(args) if lichess else fetch_chesscom(args)
    pairs.sort(key=lambda p: (p[0]["date"], p[0]["lien"]))
    rows = [r for r, _ in pairs]
    pgns = {r["lien"]: pgn for r, pgn in pairs}

    # --- Analyse Stockfish
    wanted = None if args.cadences.strip().lower() == "all" else {c.strip().lower() for c in args.cadences.split(",") if c.strip()}
    analysable = [r for r in rows if r["rules"] == "chess" and pgns[r["lien"]] and r["couleur"] != "Inconnu"]
    if args.no_analysis:
        cache = chess_analysis.load_cache(ANALYSIS_CACHE)
    else:
        targets = [{"lien": r["lien"], "pgn": pgns[r["lien"]]} for r in analysable if wanted is None or r["cadence"] in wanted]
        cache = chess_analysis.analyse_games(targets, ANALYSIS_CACHE, depth=args.depth, workers=args.workers)

    analysable_links = {r["lien"] for r in analysable}
    moments = []
    for idx, r in enumerate(rows):
        r["sf"] = None
        a = cache.get(r["lien"])
        if a and r["lien"] in analysable_links:
            try:
                r["sf"], game_moments = chess_analysis.game_metrics(r, pgns[r["lien"]], a)
            except Exception as exc:
                print(f"Métriques impossibles pour {r['lien']} : {exc}")
                continue
            for m in game_moments:
                m["g"] = idx
                moments.append(m)
    analysed = sum(r["sf"] is not None for r in rows)

    # --- CSV
    csv_path = None if args.publier else out_dir / "chess_games.csv"   # rien en clair dans la version publiée
    fields = ["date","mois","cadence","couleur","resultat","elo_joueur","elo_adversaire",
              "adversaire","precision_joueur_%","precision_adversaire_%","ouverture","ECO","lien","time_control","rated",
              "famille","variante","fin","precision_stockfish_%","acpl","gaffes","erreurs","imprecisions"]
    if csv_path:
        with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            for r in rows:
                sf = r["sf"] or {}
                ph = sf.get("phases", {}).values()
                writer.writerow({**r,
                    "precision_stockfish_%": sf.get("prec", ""), "acpl": sf.get("acpl", ""),
                    "gaffes": sum(p["gaf"] for p in ph) if sf else "",
                    "erreurs": sum(p["err"] for p in ph) if sf else "",
                    "imprecisions": sum(p["imp"] for p in ph) if sf else ""})

    # --- Dashboard
    payload = {
        "username": USERNAME, "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "period": f"Depuis {MONTHS_FR[args.since[1] - 1]} {args.since[0]}",
        "thresholds": {"imp": chess_analysis.INACCURACY, "err": chess_analysis.MISTAKE,
                       "gaf": chess_analysis.BLUNDER, "win": chess_analysis.WINNING},
        "games": [{k: v for k, v in r.items() if k != "rules"} for r in rows],
        "moments": moments,
    }
    home = "" if args.publier else '<a href="../index.html" class="muted" style="font-size:13px">← Tous les joueurs</a>'
    page = (HTML_TEMPLATE.replace("__SITE__", site_label).replace("__HOME__", home)
            .replace("__DATA__", json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")))
    if args.publier:
        html_path = out_dir / "index.html"   # lien court : https://<compte>.github.io/<dépôt>/<joueur>/
        page = encrypt_page(page, args.password, out_dir.name)
    else:
        html_path = out_dir / "chess_dashboard.html"
    html_path.write_text(page, encoding="utf-8")
    write_manifest(out_dir, USERNAME, html_path.name)

    total = len(rows)
    wins = sum(r["resultat"] == "Victoire" for r in rows)
    draws = sum(r["resultat"] == "Nulle" for r in rows)
    losses = sum(r["resultat"] == "Défaite" for r in rows)
    print("\nTerminé !")
    if args.publier:   # les journaux de GitHub Actions sont publics : pas de résultats en clair
        print(f"Rapport chiffré : {html_path}")
    else:
        print(f"Parties : {total} | Victoires/nulles/défaites : {wins}/{draws}/{losses} | Analysées par Stockfish : {analysed}")
        print(f"Tableau de bord : {html_path}")
        print(f"Export CSV : {csv_path}")

    last_elo = {r["cadence"]: r["elo_joueur"] for r in rows if r["elo_joueur"]}
    return {"dir": out_dir.name, "user": USERNAME, "site": site_label, "games": total, "analysed": analysed,
            "positions": sum(1 for m in moments if m["best"]), "generated": payload["generated"],
            "elo": [(c, last_elo[c]) for c, _ in Counter(r["cadence"] for r in rows).most_common() if c in last_elo][:3]}

def encrypt_page(page, password, name):
    """Compresse puis chiffre la page (AES-256-GCM, clé dérivée du mot de passe par PBKDF2) dans une page de déverrouillage."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM   # requis seulement pour --publier
    # sel fixe par joueur : la clé mémorisée sur un appareil reste valable après chaque régénération du rapport
    salt = hashlib.sha256(f"chess-up:{name}".encode()).digest()[:16]
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    iv = os.urandom(12)
    data = AESGCM(key).encrypt(iv, gzip.compress(page.encode("utf-8")), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return (LOCK_TEMPLATE.replace("__SALT__", b64(salt)).replace("__IV__", b64(iv))
            .replace("__ITER__", str(PBKDF2_ITERATIONS)).replace("__CIPHER__", b64(data)))

def write_manifest(out_dir, user, page):
    """Manifeste propre à chaque rapport : installé sur l'écran d'accueil, il ouvre directement ce rapport."""
    manifest = {"name": f"Chess Analytics · {user}", "short_name": "Chess", "lang": "fr",
                "start_url": f"./{page}", "scope": "./", "display": "standalone",
                "background_color": "#10151d", "theme_color": "#10151d",
                "icons": [{"src": "../icon-192.png", "sizes": "192x192", "type": "image/png"},
                          {"src": "../icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]}
    (out_dir / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

def write_public_index():
    """Page d'accueil du site publié : aucun nom ni lien, chacun reçoit le lien de son propre rapport."""
    for f in (BASE_DIR / "web").iterdir():
        shutil.copy(f, SITE_DIR / f.name)
    page = INDEX_TEMPLATE.replace("__CARDS__", "").replace("Choisis un joueur pour voir son rapport et lancer une séance d'entraînement.",
                                                         "Les rapports sont privés : ouvre le lien personnel qu'on t'a envoyé.")
    (SITE_DIR / "index.html").write_text(page.replace("__GENERATED__", datetime.now().strftime("%Y-%m-%d %H:%M")), encoding="utf-8")
    (SITE_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    print(f"\nSite prêt à publier : {SITE_DIR}")

LOCK_TEMPLATE = r'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chess Analytics</title><meta name="robots" content="noindex,nofollow"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="../icon-192.png"><link rel="apple-touch-icon" href="../icon-192.png">
<meta name="theme-color" content="#10151d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10151d;color:#edf3fb;font:15px/1.45 system-ui,sans-serif;padding:16px}
form{width:100%;max-width:360px;background:#192230;border:1px solid #2b394b;border-radius:14px;padding:24px}h1{font-size:22px;margin:0 0 4px}p{color:#a9b6c8;margin:0 0 18px;font-size:14px}
input[type=password]{width:100%;background:#111a25;color:#edf3fb;border:1px solid #2b394b;border-radius:8px;padding:11px 12px;font:inherit;font-size:16px}
label{display:flex;gap:8px;align-items:center;color:#a9b6c8;font-size:14px;margin:12px 0 16px}button{width:100%;background:#3987e5;color:#fff;border:0;border-radius:8px;padding:11px;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}#msg{min-height:20px;margin-top:12px;font-size:14px;color:#ff8b8b}
</style></head><body>
<form id="f" hidden><h1>Rapport privé</h1><p>Entre le mot de passe de ce rapport.</p>
<input type="password" id="pw" autocomplete="current-password" required autofocus>
<label><input type="checkbox" id="keep" checked> Se souvenir sur cet appareil</label>
<button id="go">Ouvrir</button><div id="msg"></div></form>
<script>
const SALT='__SALT__',IV='__IV__',ITER=__ITER__,CIPHER='__CIPHER__';
const KEY='chess-up:cle:'+location.pathname.replace(/index\.html$/,'');
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const store={get(){try{return localStorage.getItem(KEY)}catch(e){return null}},set(v){try{localStorage.setItem(KEY,v)}catch(e){}},del(){try{localStorage.removeItem(KEY)}catch(e){}}};
async function derive(pw){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(SALT),iterations:ITER,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['decrypt'])}
async function decrypt(key){const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(IV)},key,bytes(CIPHER));
 return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}
function show(html){document.open();document.write(html);document.close()}
async function auto(){const saved=store.get();if(saved){try{const key=await crypto.subtle.importKey('raw',bytes(saved),'AES-GCM',true,['decrypt']);return show(await decrypt(key))}catch(e){store.del()}}
 document.getElementById('f').hidden=false;document.getElementById('pw').focus()}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const go=document.getElementById('go'),msg=document.getElementById('msg');
 go.disabled=true;go.textContent='Ouverture…';msg.textContent='';
 try{const key=await derive(document.getElementById('pw').value);const html=await decrypt(key);
  if(document.getElementById('keep').checked)store.set(b64(await crypto.subtle.exportKey('raw',key)));show(html)}
 catch(err){msg.textContent=err&&err.name==='OperationError'?'Mot de passe incorrect.':'Ouverture impossible : '+err;go.disabled=false;go.textContent='Ouvrir'}};
if(!window.crypto||!crypto.subtle||!window.DecompressionStream){document.body.textContent='Ce navigateur est trop ancien pour ouvrir ce rapport.'}else auto();
</script></body></html>'''

def write_index(summaries):
    """Page d'accueil listant les rapports, et fichiers qui rendent le site installable sur téléphone."""
    for f in (BASE_DIR / "web").iterdir():
        shutil.copy(f, REPORTS_DIR / f.name)
    cards = "".join(
        f'''<a class="card" href="{html.escape(s["dir"])}/chess_dashboard.html"><div class="site">{html.escape(s["site"])}</div>
<h2>{html.escape(s["user"])}</h2><div class="elo">{" · ".join(f"{html.escape(c)} <b>{html.escape(str(e))}</b>" for c, e in s["elo"]) or "—"}</div>
<div class="meta">{s["games"]} parties · {s["analysed"]} analysées · {s["positions"]} positions d'entraînement</div></a>'''
        for s in sorted(summaries, key=lambda s: s["user"]))
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    (REPORTS_DIR / "index.html").write_text(INDEX_TEMPLATE.replace("__CARDS__", cards).replace("__GENERATED__", generated), encoding="utf-8")
    print(f"\nPage d'accueil : {REPORTS_DIR / 'index.html'} ({len(summaries)} joueurs)")

INDEX_TEMPLATE = r'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chess Analytics</title><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">
<meta name="theme-color" content="#10151d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<style>
:root{color-scheme:dark;--bg:#10151d;--panel:#192230;--muted:#a9b6c8;--text:#edf3fb;--line:#2b394b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}main{max-width:900px;margin:auto;padding:24px 16px}
h1{font-size:clamp(24px,5vw,34px);margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;color:inherit;text-decoration:none}.card:hover{border-color:#3987e5}
.card h2{font-size:20px;margin:2px 0 8px;overflow-wrap:anywhere}.site{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.elo{font-variant-numeric:tabular-nums}.meta{color:var(--muted);font-size:13px;margin-top:8px}.note{color:var(--muted);font-size:12px;margin-top:24px}
</style></head><body><main><h1>Chess Analytics</h1><p class="sub">Choisis un joueur pour voir son rapport et lancer une séance d'entraînement.</p>
<div class="cards">__CARDS__</div><p class="note">Mis à jour le __GENERATED__.</p></main></body></html>'''

HTML_TEMPLATE = r'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chess Analytics</title><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="../icon-192.png"><link rel="apple-touch-icon" href="../icon-192.png">
<meta name="theme-color" content="#10151d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
<style>
:root{color-scheme:dark;--bg:#10151d;--panel:#192230;--panel2:#111a25;--muted:#a9b6c8;--text:#edf3fb;--line:#2b394b;
--win:#199e70;--draw:#c98500;--loss:#e66767;--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}main{max-width:1250px;margin:auto;padding:24px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:12px}h1{font-size:clamp(24px,4vw,36px);margin:0}
h2{font-size:18px;margin:0 0 4px}h3{font-size:15px;margin:0 0 6px}.sub{color:var(--muted);font-size:13px;margin:0 0 14px}.muted{color:var(--muted)}
.part{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:34px 0 4px;border-top:1px solid var(--line);padding-top:18px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:14px 0}.panel,.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;min-width:0}
.kpi .label{color:var(--muted);font-size:13px}.kpi .value{font-size:26px;font-weight:750;margin-top:4px;font-variant-numeric:tabular-nums}.kpi .hint{color:var(--muted);font-size:12px;margin-top:2px}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.chartbox{height:280px;position:relative}.full{grid-column:1/-1}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);position:sticky;top:0;background:var(--panel);font-weight:600}th.sort{cursor:pointer;user-select:none}th.sort:hover{color:var(--text)}td.num,th.num{text-align:right}
.tablewrap{overflow:auto;max-height:460px}.pill{display:inline-block;border-radius:99px;padding:2px 8px;background:#263447;font-size:12px;white-space:nowrap}
.win{color:#75c9a5}.loss{color:#ff8b8b}.draw{color:#e7c879}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.filters input,.filters select,.filters button{background:var(--panel2);color:var(--text);border:1px solid var(--line);padding:8px 10px;border-radius:8px;font:inherit;font-size:14px}
.filters label{display:flex;gap:6px;align-items:center;color:var(--muted);font-size:14px}
.sticky{position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line)}
a{color:#91caff}.note{font-size:12px;color:var(--muted);margin-top:10px}
.bar{display:inline-block;height:8px;border-radius:4px;background:var(--c1);vertical-align:middle;margin-right:6px}
.insights{margin:0;padding-left:20px}.insights li{margin:6px 0}
.prio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.prio .panel{border-top:3px solid var(--c1)}.prio .rank{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.prio .impact{font-size:13px;margin:4px 0 10px;color:var(--muted)}.prio p{margin:8px 0;font-size:14px}.prio ul{margin:6px 0;padding-left:18px;font-size:13px}
.empty{color:var(--muted);font-style:italic;padding:12px 0}
#tDeck{max-width:100%;min-width:0}.filters label:has(#tDeck){max-width:100%;min-width:0}
.trainer{display:grid;grid-template-columns:minmax(0,460px) minmax(0,1fr);gap:22px;align-items:start}
.board{display:grid;grid-template-columns:repeat(8,1fr);width:100%;aspect-ratio:1;border-radius:8px;background:var(--panel2);overflow:hidden;user-select:none;container-type:inline-size}
.sq{position:relative;display:flex;align-items:center;justify-content:center;font-size:10cqw;line-height:1;cursor:pointer}.sq.light{background:#dfe3e8}.sq.dark{background:#7b93ad}
.sq.last{box-shadow:inset 0 0 0 100px rgba(255,214,90,.38)}.sq.sel{box-shadow:inset 0 0 0 100px rgba(57,135,229,.55)}.sq.hint{box-shadow:inset 0 0 0 4px #199e70,inset 0 0 0 100px rgba(25,158,112,.3)}
.sq.target::after{content:"";position:absolute;width:28%;height:28%;border-radius:50%;background:rgba(16,21,29,.35)}.sq.target.capt::after{width:86%;height:86%;background:none;border:4px solid rgba(16,21,29,.35)}
.pc{position:relative;z-index:1}.pc.w{color:#fff;text-shadow:0 0 2px #000,0 0 1px #000,0 1px 2px #000}.pc.b{color:#111}
.coord{position:absolute;font-size:2.4cqw;font-weight:700;color:#10151d;opacity:.6}.coord.f{right:3px;bottom:1px}.coord.r{left:3px;top:1px}
.tpanel h3{font-size:18px;margin:4px 0 8px}.tpanel p{margin:6px 0}.feedback{min-height:48px;margin:12px 0;padding:10px 12px;border-radius:8px;background:var(--panel2);font-size:14px}
.feedback.ok{border-left:4px solid var(--win)}.feedback.ko{border-left:4px solid var(--loss)}.tpanel .rank{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
@media(max-width:900px){main{padding:14px 16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.charts,.prio,.trainer{grid-template-columns:1fr}.chartbox{height:250px}}
</style></head><body><main>
<header><div>__HOME__<h1>Chess Analytics</h1><div class="muted" id="subtitle"></div></div><div class="muted" id="generated"></div></header>
<div class="filters sticky"><label>Cadence <select id="fCadence"></select></label><label>Période <select id="fPeriod">
<option value="">Toute la période</option><option value="30">30 derniers jours</option><option value="90">3 derniers mois</option><option value="180">6 derniers mois</option></select></label>
<label><input type="checkbox" id="fRated"> Parties classées uniquement</label><span class="muted" id="fCount"></span></div>

<div class="grid" id="kpis"></div>
<section class="panel"><h2>Constats clés</h2><p class="sub">Générés automatiquement à partir des parties filtrées.</p><ul class="insights" id="insights"></ul></section>

<div class="part">1 · Résultats</div>
<div class="charts">
<section class="panel"><h2>Score par cadence</h2><p class="sub">Victoire = 1, nulle = ½. Toutes cadences, autres filtres appliqués.</p><div class="chartbox"><canvas id="cadenceChart"></canvas></div><table id="cadenceTable"></table></section>
<section class="panel"><h2>Blancs contre Noirs</h2><p class="sub">Score par couleur dans la sélection.</p><div class="chartbox"><canvas id="colorChart"></canvas></div><table id="colorTable"></table></section>
<section class="panel"><h2>Score selon l'écart d'Elo</h2><p class="sub">Elo adverse moins le tien. « Comparable » = à ±50 points.</p><div class="chartbox"><canvas id="gapChart"></canvas></div></section>
<section class="panel"><h2>Évolution de l'Elo</h2><p class="sub">Dernier Elo de chaque semaine, une courbe par cadence.</p><div class="chartbox"><canvas id="eloChart"></canvas></div></section>
<section class="panel full"><h2>Parties par mois</h2><div class="chartbox" style="height:240px"><canvas id="monthlyChart"></canvas></div></section>
</div>

<div class="part">2 · Ouvertures</div>
<section class="panel"><h2>Tes ouvertures</h2><p class="sub">L'évaluation Stockfish après 12 coups indique si l'ouverture te laisse une position saine (en pions, de ton point de vue).</p>
<div class="filters"><label>Regrouper par <select id="oGroup"><option value="famille">famille</option><option value="variante">variante</option></select></label>
<label>Minimum <select id="oMin"><option>3</option><option selected>5</option><option>10</option><option>20</option></select> parties</label></div>
<div class="tablewrap"><table><thead><tr id="oHead"></tr></thead><tbody id="openings"></tbody></table></div>
<div class="note">Sous 10 parties, les résultats d'une ligne fluctuent beaucoup : à lire comme des pistes, pas des verdicts.</div></section>

<div class="part">3 · Analyse Stockfish</div>
<div id="sfMissing" class="panel empty" hidden></div>
<div id="sfBlock">
<div class="grid" id="sfKpis"></div>
<section class="panel"><h2>Tes 3 priorités d'entraînement</h2><p class="sub" id="prioSub"></p><div class="prio" id="prio"></div></section>
<div class="charts">
<section class="panel"><h2>Erreurs par phase de jeu</h2><p class="sub">Pour 100 de tes coups joués dans chaque phase.</p><div class="chartbox"><canvas id="phaseChart"></canvas></div></section>
<section class="panel"><h2>Comment tes parties non gagnées ont basculé</h2><p class="sub">Points perdus (défaite = 1, nulle = ½), selon la cause principale.</p><div class="chartbox"><canvas id="causeChart"></canvas></div></section>
</div>
<section class="panel" style="margin-top:14px"><h2>Rapid contre blitz : les erreurs ne se ressemblent pas</h2><p class="sub">Toutes les cadences analysées, autres filtres appliqués.</p><div class="tablewrap"><table id="cmpTable"></table></div></section>
<section class="panel" style="margin-top:14px"><h2>Moments critiques</h2><p class="sub">Tes erreurs et gaffes, avec le meilleur coup de Stockfish. « Position » ouvre l'échiquier d'analyse Lichess sur la position, avant ton coup.</p>
<div class="filters"><select id="mType"><option value="">Erreurs et gaffes</option><option value="gaf">Gaffes seulement</option><option value="occ">Occasions manquées</option><option value="mm">Mats manqués</option><option value="zt">En zeitnot</option></select>
<select id="mPhase"><option value="">Toutes les phases</option><option value="ouverture">Ouverture</option><option value="milieu">Milieu de partie</option><option value="finale">Finale</option></select><span class="muted" id="mCount"></span></div>
<div class="tablewrap"><table><thead><tr><th>Date</th><th>Cadence</th><th>Coup</th><th>Joué</th><th>Meilleur</th><th>Chances de gain</th><th>Phase</th><th>Pendule</th><th></th></tr></thead><tbody id="moments"></tbody></table></div></section>
<section class="panel" style="margin-top:14px"><h2>Positions gagnantes non converties</h2><p class="sub" id="lostSub"></p>
<div class="tablewrap"><table><thead><tr><th>Date</th><th>Cadence</th><th>Adversaire</th><th class="num">Chances max.</th><th>Résultat</th><th>Fin</th><th></th></tr></thead><tbody id="lostWins"></tbody></table></div></section>
</div>

<div class="part">4 · Entraînement</div>
<div id="trMissing" class="panel empty" hidden></div>
<section class="panel" id="trBlock"><h2>Séance d'entraînement</h2><p class="sub">Tes propres positions critiques : trouve le coup de Stockfish. Une position ratée revient dans la séance ; une position réussie revient de plus en plus tard (1, 3, 7, 16 puis 35 jours). La progression est enregistrée dans ce navigateur.</p>
<div class="filters"><label>Thème <select id="tDeck"></select></label><span class="muted" id="tStats"></span></div>
<div class="trainer"><div class="board" id="board"></div>
<div class="tpanel"><div class="rank" id="tMeta"></div><h3 id="tTitle"></h3><p id="tPrompt"></p><div class="feedback" id="tFeedback"></div>
<div class="filters"><button id="tHint">Indice</button><button id="tSolve">Solution</button><button id="tNext">Position suivante →</button></div>
<div class="note" id="tLinks"></div></div></div>
<div class="note">Clique sur une pièce, puis sur sa case d'arrivée. Seul le meilleur coup de Stockfish est validé : un autre coup peut être bon aussi, surtout dans une position déjà gagnante. Vérifie-le avec le lien « Analyse ».</div></section>

<div class="part">5 · Historique</div>
<section class="panel"><h2>Historique des parties</h2><div class="filters"><input id="search" placeholder="Filtrer adversaire / ouverture…"><select id="resultFilter"><option value="">Tous les résultats</option><option>Victoire</option><option>Nulle</option><option>Défaite</option></select><button id="csvBtn">Télécharger CSV</button></div>
<div class="tablewrap"><table><thead><tr><th>Date</th><th>Cadence</th><th>Couleur</th><th>Résultat</th><th>Fin</th><th class="num">Elo</th><th>Adversaire</th><th class="num">Elo adv.</th><th class="num">Précision</th><th class="num">Gaffes</th><th>Ouverture</th><th>Lien</th></tr></thead><tbody id="games"></tbody></table></div>
<div class="note">Données issues de l'API publique __SITE__. « Précision » : celle de __SITE__ si disponible, sinon l'estimation Stockfish (marquée *).</div></section>
</main>
<script>
const D=__DATA__;const T=D.thresholds;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=1)=>x==null||isNaN(x)?'—':x.toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=(a,b)=>b?100*a/b:null;
const CAD_COLORS={rapid:'#3987e5',blitz:'#d95926',daily:'#199e70',bullet:'#c98500',classical:'#8a63d2',correspondence:'#199e70',ultraBullet:'#e66767'};
const FIN={cheat:'triche',resigned:'abandon',checkmated:'mat',timeout:'temps',abandoned:'déconnexion',agreed:'nulle acceptée',repetition:'répétition',stalemate:'pat',insufficient:'matériel insuffisant',timevsinsufficient:'temps / matériel insuff.','50move':'règle des 50 coups'};
const PHASE={ouverture:'Ouverture',milieu:'Milieu de partie',finale:'Finale'};
D.games.forEach((g,i)=>{g.i=i;g.pts=g.resultat==='Victoire'?1:g.resultat==='Nulle'?.5:0});
$('subtitle').textContent='@'+D.username+' · '+D.period+' · '+D.games.length+' parties';$('generated').textContent='Généré le '+D.generated;
Chart.defaults.color='#a9b6c8';Chart.defaults.borderColor='#2b394b';Chart.defaults.font.family='system-ui,sans-serif';
const charts={};
function chart(id,cfg){charts[id]?.destroy();charts[id]=new Chart($(id),cfg)}
const barOpts=(extra={})=>({responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{boxWidth:12}}},...extra});

const cadences=[...new Set(D.games.map(g=>g.cadence))].sort((a,b)=>D.games.filter(g=>g.cadence===b).length-D.games.filter(g=>g.cadence===a).length);
$('fCadence').add(new Option('Toutes',''));cadences.forEach(c=>$('fCadence').add(new Option(c,c)));
const lastDate=D.games.length?new Date(D.games[D.games.length-1].date):new Date();

function baseFilter(ignoreCadence){const c=$('fCadence').value,p=+$('fPeriod').value,r=$('fRated').checked;
 const since=p?new Date(lastDate-p*864e5):null;
 return D.games.filter(g=>(ignoreCadence||!c||g.cadence===c)&&(!r||String(g.rated).toLowerCase()==='true')&&(!since||new Date(g.date)>=since))}
function score(list){const w=list.filter(g=>g.resultat==='Victoire').length,d=list.filter(g=>g.resultat==='Nulle').length,l=list.filter(g=>g.resultat==='Défaite').length;
 return {n:list.length,w,d,l,s:list.length?100*(w+.5*d)/list.length:null}}
const vnd=s=>`${s.w}-${s.d}-${s.l}`;
const gap=g=>(+g.elo_adversaire||0)-(+g.elo_joueur||0);

/* ---------- agrégats Stockfish ---------- */
function sfAgg(list){const a=list.filter(g=>g.sf);const n=a.length;if(!n)return null;
 const ph={ouverture:{coups:0,imp:0,err:0,gaf:0},milieu:{coups:0,imp:0,err:0,gaf:0},finale:{coups:0,imp:0,err:0,gaf:0}};
 let errs=0,zt=0,occ=0,mm=0,prec=0,acpl=0,np=0,winning=0,notConv=0,timeouts=0;
 a.forEach(g=>{for(const p in ph)for(const k in ph[p])ph[p][k]+=g.sf.phases[p][k];
  const e=g.sf.phases;errs+=e.ouverture.err+e.ouverture.gaf+e.milieu.err+e.milieu.gaf+e.finale.err+e.finale.gaf;
  zt+=g.sf.zt_err;occ+=g.sf.occ;mm+=g.sf.mm;if(g.sf.prec!=null){prec+=g.sf.prec;acpl+=g.sf.acpl;np++}
  if(g.sf.max_win>=T.win){winning++;if(g.resultat!=='Victoire')notConv++}
  if(g.resultat==='Défaite'&&g.fin==='timeout')timeouts++});
 const tot=k=>ph.ouverture[k]+ph.milieu[k]+ph.finale[k];
 return {n,a,ph,gaf:tot('gaf'),err:tot('err'),imp:tot('imp'),coups:tot('coups'),errs,zt,occ,mm,prec:np?prec/np:null,acpl:np?acpl/np:null,winning,notConv,timeouts}}

const CAUSES={temps:'Gestion de la pendule',conversion:'Conversion des positions gagnantes',ouverture:'Sortie d\'ouverture',milieu:'Tactique en milieu de partie',finale:'Technique de finale',positionnel:'Jeu positionnel (pas de gaffe nette)'};
function cause(g){if(g.resultat==='Victoire'||!g.sf)return null;const s=g.sf,d=s.decisive;
 if((g.fin==='timeout'&&(!d||d.loss<T.gaf))||(d&&d.zt))return 'temps';
 if(s.max_win>=T.win)return 'conversion';
 if(d)return d.ph;
 if(s.eval_ouv!=null&&s.eval_ouv<=-200)return 'ouverture';
 return 'positionnel'}
const momentOf=(g,ply)=>D.moments.find(m=>m.g===g&&m.ply===ply);
const lichess=(fen,color)=>'https://lichess.org/analysis/standard/'+fen.replace(/ /g,'_')+'?color='+(color==='Blancs'?'white':'black');

/* ---------- rendu ---------- */
function render(){const G=baseFilter(false),GA=baseFilter(true);const sc=score(G);
 $('fCount').textContent=G.length+' parties sélectionnées';
 const elos=cadences.map(c=>{const l=GA.filter(g=>g.cadence===c&&g.elo_joueur);return l.length?c+' '+l[l.length-1].elo_joueur:null}).filter(Boolean);
 const accCom=G.filter(g=>g['precision_joueur_%']!=='');
 const k=[['Parties',G.length,''],['Score',fmt(sc.s)+' %','victoire 1 · nulle ½'],['Victoires · nulles · défaites',vnd(sc),''],['Elo actuel',elos.slice(0,2).join(' · ')||'—',elos.slice(2).join(' · ')],
  ['Précision __SITE__',accCom.length?fmt(accCom.reduce((s,g)=>s+ +g['precision_joueur_%'],0)/accCom.length)+' %':'—',accCom.length+' parties seulement'],
  ['Parties analysées',G.filter(g=>g.sf).length,'par Stockfish'],['Comparable (±50 Elo)',fmt(score(G.filter(g=>Math.abs(gap(g))<=50)).s)+' %',score(G.filter(g=>Math.abs(gap(g))<=50)).n+' parties'],['Défaites au temps',G.filter(g=>g.resultat==='Défaite'&&g.fin==='timeout').length,'sur '+sc.l+' défaites']];
 $('kpis').innerHTML=k.map(x=>`<div class="kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('');

 // Résultats par cadence (ignore le filtre cadence)
 const byCad=cadences.map(c=>({c,...score(GA.filter(g=>g.cadence===c))})).filter(x=>x.n);
 chart('cadenceChart',{type:'bar',data:{labels:byCad.map(x=>x.c),datasets:[{label:'Score',data:byCad.map(x=>x.s),backgroundColor:byCad.map(x=>CAD_COLORS[x.c]||'#9085e9'),borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Score ${fmt(c.raw)} % (${vnd(byCad[c.dataIndex])})`}}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+' %'}}}})});
 $('cadenceTable').innerHTML='<tr><th>Cadence</th><th class="num">Parties</th><th>V-N-D</th><th class="num">Score</th></tr>'+byCad.map(x=>`<tr><td>${esc(x.c)}</td><td class="num">${x.n}</td><td>${vnd(x)}</td><td class="num">${fmt(x.s)} %</td></tr>`).join('');

 const byCol=['Blancs','Noirs'].map(c=>({c,...score(G.filter(g=>g.couleur===c))}));
 chart('colorChart',{type:'bar',data:{labels:byCol.map(x=>x.c),datasets:[{label:'Victoires',data:byCol.map(x=>x.w),backgroundColor:'#199e70',borderRadius:4},{label:'Nulles',data:byCol.map(x=>x.d),backgroundColor:'#c98500',borderRadius:4},{label:'Défaites',data:byCol.map(x=>x.l),backgroundColor:'#e66767',borderRadius:4}]},
  options:barOpts({indexAxis:'y',scales:{x:{stacked:true},y:{stacked:true}}})});
 $('colorTable').innerHTML='<tr><th>Couleur</th><th class="num">Parties</th><th>V-N-D</th><th class="num">Score</th></tr>'+byCol.map(x=>`<tr><td>${x.c}</td><td class="num">${x.n}</td><td>${vnd(x)}</td><td class="num">${fmt(x.s)} %</td></tr>`).join('');

 const buckets=[['≤ −150',-1e9,-150],['−149 à −51',-149,-51],['±50',-50,50],['+51 à +149',51,149],['≥ +150',150,1e9]];
 const byGap=buckets.map(([l,a,b])=>({l,...score(G.filter(g=>g.elo_adversaire&&g.elo_joueur&&gap(g)>=a&&gap(g)<=b))}));
 chart('gapChart',{type:'bar',data:{labels:byGap.map(x=>x.l),datasets:[{label:'Score',data:byGap.map(x=>x.s),backgroundColor:'#3987e5',borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Score ${fmt(c.raw)} % · ${byGap[c.dataIndex].n} parties (${vnd(byGap[c.dataIndex])})`}}},scales:{x:{title:{display:true,text:'Adversaire plus faible  ←  écart d\'Elo  →  adversaire plus fort'}},y:{min:0,max:100,ticks:{callback:v=>v+' %'}}}})});

 const week=d=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+6)%7);return t.toISOString().slice(0,10)};
 const weeks=[...new Set(G.map(g=>week(g.date)))].sort();
 const eloSets=cadences.filter(c=>G.some(g=>g.cadence===c)).map(c=>{const last={};G.filter(g=>g.cadence===c&&g.elo_joueur).forEach(g=>last[week(g.date)]=+g.elo_joueur);
  return {label:c,data:weeks.map(w=>last[w]??null),borderColor:CAD_COLORS[c]||'#9085e9',backgroundColor:CAD_COLORS[c]||'#9085e9',spanGaps:true,tension:.25,borderWidth:2,pointRadius:2}}).filter(s=>s.data.filter(v=>v!=null).length>1);
 chart('eloChart',{type:'line',data:{labels:weeks,datasets:eloSets},options:barOpts({scales:{y:{}}})});

 const months=[...new Set(G.map(g=>g.mois))].sort();const bm=months.map(m=>score(G.filter(g=>g.mois===m)));
 chart('monthlyChart',{type:'bar',data:{labels:months,datasets:[{label:'Victoires',data:bm.map(x=>x.w),backgroundColor:'#199e70',borderRadius:4},{label:'Nulles',data:bm.map(x=>x.d),backgroundColor:'#c98500',borderRadius:4},{label:'Défaites',data:bm.map(x=>x.l),backgroundColor:'#e66767',borderRadius:4}]},options:barOpts({scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}})});

 renderOpenings(G);renderSF(G,GA);renderTraining(G);renderInsights(G,GA);renderGames(G)}

/* ---------- ouvertures ---------- */
let oSort={k:'n',dir:-1};
function openingRows(G,key,min){const groups={};G.forEach(g=>{const id=g[key]+'|'+g.couleur;(groups[id]??=[]).push(g)});
 return Object.entries(groups).map(([id,l])=>{const a=l.filter(g=>g.sf&&g.sf.eval_ouv!=null);const s=score(l);const sf=l.filter(g=>g.sf);
  return {name:id.split('|')[0],col:id.split('|')[1],...s,ev:a.length?a.reduce((t,g)=>t+g.sf.eval_ouv,0)/a.length/100:null,na:a.length,
   oe:sf.length?sf.reduce((t,g)=>t+g.sf.phases.ouverture.err+g.sf.phases.ouverture.gaf,0)/sf.length:null}}).filter(r=>r.n>=min)}
function renderOpenings(G){const rows=openingRows(G,$('oGroup').value,+$('oMin').value);
 const cols=[['name','Ouverture'],['col','Couleur'],['n','Parties','num'],['vnd','V-N-D'],['s','Score','num'],['ev','Éval. après 12 coups','num'],['oe','Erreurs d\'ouverture / partie','num']];
 $('oHead').innerHTML=cols.map(([k,l,c])=>`<th class="sort ${c||''}" data-k="${k}">${l}${oSort.k===k?(oSort.dir<0?' ↓':' ↑'):''}</th>`).join('');
 rows.sort((a,b)=>{const k=oSort.k==='vnd'?'n':oSort.k;const x=a[k],y=b[k];if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*oSort.dir});
 $('openings').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}${r.n<10?' <span class="muted">· petit échantillon</span>':''}</td><td>${r.col}</td><td class="num">${r.n}</td><td>${vnd(r)}</td>
  <td class="num"><span class="bar" style="width:${Math.round(r.s*.6)}px"></span>${fmt(r.s)} %</td>
  <td class="num ${r.ev==null?'':r.ev<=-1?'loss':r.ev>=1?'win':''}">${r.ev==null?'—':(r.ev>0?'+':'')+fmt(r.ev,2)} <span class="muted">${r.na?'('+r.na+')':''}</span></td><td class="num">${fmt(r.oe,2)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Aucune ouverture avec assez de parties dans cette sélection.</td></tr>';
 document.querySelectorAll('#oHead th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;oSort=oSort.k===k?{k,dir:-oSort.dir}:{k,dir:['name','col'].includes(k)?1:-1};renderOpenings(baseFilter(false))})}

/* ---------- Stockfish ---------- */
function renderSF(G,GA){const A=sfAgg(G);
 const analysedCads=[...new Set(D.games.filter(g=>g.sf).map(g=>g.cadence))];
 if(!A){$('sfBlock').hidden=true;$('sfMissing').hidden=false;
  $('sfMissing').textContent=analysedCads.length?`Aucune partie analysée dans cette sélection. Cadences analysées : ${analysedCads.join(', ')}. Pour en ajouter : python chess_dashboard_generator.py --cadences ${[...new Set([...analysedCads,$('fCadence').value||'blitz'])].join(',')}`:'Aucune partie analysée par Stockfish. Lance : python chess_dashboard_generator.py';return}
 $('sfBlock').hidden=false;$('sfMissing').hidden=true;
 const k=[['Parties analysées',A.n,G.length>A.n?`sur ${G.length} (cadences analysées : ${analysedCads.join(', ')})`:'toutes celles de la sélection'],['Précision estimée',fmt(A.prec)+' %','méthode Lichess'],['Perte moyenne / coup',fmt(A.acpl,0)+' cp','ACPL, en centièmes de pion'],['Gaffes / partie',fmt(A.gaf/A.n,2),fmt(A.err/A.n,2)+' erreurs · '+fmt(A.imp/A.n,1)+' imprécisions'],
  ['Erreurs en zeitnot',fmt(pct(A.zt,A.errs),0)+' %',A.zt+' erreurs et gaffes sur '+A.errs],['Occasions manquées',fmt(A.occ/A.n,2)+' / partie','grosse erreur adverse non punie'],['Mats manqués',A.mm,'mat en 3 coups ou moins non joué'],['Positions gagnantes gâchées',A.winning?fmt(pct(A.notConv,A.winning),0)+' %':'—',A.notConv+' sur '+A.winning+' parties où tu étais gagnant']];
 $('sfKpis').innerHTML=k.map(x=>`<div class="kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('');

 const phs=['ouverture','milieu','finale'];const rate=(p,s)=>A.ph[p].coups?100*A.ph[p][s]/A.ph[p].coups:0;
 chart('phaseChart',{type:'bar',data:{labels:phs.map(p=>PHASE[p]+` (${A.ph[p].coups} coups)`),datasets:[['imp','Imprécisions','#c98500'],['err','Erreurs','#d95926'],['gaf','Gaffes','#e66767']].map(([s,l,c])=>({label:l,data:phs.map(p=>rate(p,s)),backgroundColor:c,borderRadius:4}))},
  options:barOpts({plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label} : ${fmt(c.raw)} pour 100 coups`}}},scales:{y:{beginAtZero:true,title:{display:true,text:'pour 100 coups'}}}})});

 const lost={};A.a.forEach(g=>{const c=cause(g);if(c)(lost[c]??={pts:0,games:[]}).pts+=1-g.pts,lost[c].games.push(g)});
 const ranked=Object.entries(lost).sort((a,b)=>b[1].pts-a[1].pts);const totalLost=ranked.reduce((t,[,v])=>t+v.pts,0);
 chart('causeChart',{type:'bar',data:{labels:ranked.map(([c])=>CAUSES[c]),datasets:[{label:'Points perdus',data:ranked.map(([,v])=>v.pts),backgroundColor:'#e66767',borderRadius:4,maxBarThickness:28}]},
  options:barOpts({indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${fmt(c.raw,1)} points · ${ranked[c.dataIndex][1].games.length} parties · ${fmt(pct(c.raw,totalLost),0)} % des points perdus`}}},scales:{x:{beginAtZero:true}}})});

 topCause=ranked[0]?.[0]||null;renderPriorities(A,ranked,totalLost,G);

 const cmp=analysedCads.map(c=>{const l=GA.filter(g=>g.cadence===c);const a=sfAgg(l);return a&&{c,s:score(a.a),a}}).filter(Boolean);
 const per100=(a,p)=>a.ph[p].coups?fmt(100*a.ph[p].gaf/a.ph[p].coups,1):'—';
 $('cmpTable').innerHTML='<tr><th>Cadence</th><th class="num">Analysées</th><th class="num">Score</th><th class="num">Précision</th><th class="num">ACPL</th><th class="num">Gaffes / partie</th><th class="num">Gaffes /100 coups<br>ouv. · milieu · finale</th><th class="num">Erreurs en zeitnot</th><th class="num">Défaites au temps</th><th class="num">Gagnantes gâchées</th></tr>'+
  cmp.map(({c,s,a})=>`<tr><td>${esc(c)}</td><td class="num">${a.n}</td><td class="num">${fmt(s.s)} %</td><td class="num">${fmt(a.prec)} %</td><td class="num">${fmt(a.acpl,0)}</td><td class="num">${fmt(a.gaf/a.n,2)}</td><td class="num">${per100(a,'ouverture')} · ${per100(a,'milieu')} · ${per100(a,'finale')}</td><td class="num">${fmt(pct(a.zt,a.errs),0)} %</td><td class="num">${a.timeouts}</td><td class="num">${a.winning?fmt(pct(a.notConv,a.winning),0)+' %':'—'}</td></tr>`).join('')+
  (cadences.filter(c=>!analysedCads.includes(c)).length?`<tr><td colspan="10" class="muted">Non analysées : ${cadences.filter(c=>!analysedCads.includes(c)).join(', ')} — python chess_dashboard_generator.py --cadences ${[...analysedCads,...cadences.filter(c=>!analysedCads.includes(c))].join(',')}</td></tr>`:'');

 renderMoments(G);
 const lw=A.a.filter(g=>g.sf.max_win>=T.win&&g.resultat!=='Victoire').reverse();
 $('lostSub').textContent=`Parties où tu as atteint au moins ${T.win} % de chances de gain (environ +4) sans gagner : ${lw.length}.`;
 $('lostWins').innerHTML=lw.map(g=>{const d=g.sf.decisive&&momentOf(g.i,g.sf.decisive.ply);return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(g.adversaire)} (${esc(g.elo_adversaire)})</td><td class="num">${g.sf.max_win} %</td><td class="${g.resultat==='Défaite'?'loss':'draw'}">${esc(g.resultat)}</td><td>${esc(FIN[g.fin]||g.fin)}</td>
  <td>${d?`<a href="${lichess(d.fen,g.couleur)}" target="_blank" rel="noopener">Erreur décisive</a> · `:''}<a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Aucune.</td></tr>'}

function renderMoments(G){const ids=new Set(G.map(g=>g.i));const t=$('mType').value,p=$('mPhase').value;
 const list=D.moments.filter(m=>ids.has(m.g)&&(!p||m.ph===p)&&(t===''?m.sev!=='mat':t==='gaf'?m.sev==='gaf':t==='occ'?m.occ:t==='mm'?m.mm:m.zt&&m.sev!=='mat')).slice().reverse();
 $('mCount').textContent=list.length+' moments'+(list.length>400?' (400 plus récents affichés)':'');
 const sevl={gaf:'<span class="loss">Gaffe</span>',err:'<span class="draw">Erreur</span>',mat:'<span class="muted">Mat manqué</span>'};
 $('moments').innerHTML=list.slice(0,400).map(m=>{const g=D.games[m.g];return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(m.n)}</td><td>${sevl[m.sev]} <b>${esc(m.san)}</b>${m.occ?' <span class="pill">occasion manquée</span>':''}${m.mm&&m.sev!=='mat'?' <span class="pill">mat manqué</span>':''}</td>
  <td><b>${esc(m.best)}</b></td><td class="num">${m.wb} % → <span class="${m.wa<m.wb-T.gaf?'loss':''}">${m.wa} %</span></td><td>${PHASE[m.ph]}</td><td>${m.clk==null?'—':Math.floor(m.clk/60)+':'+String(m.clk%60).padStart(2,'0')}${m.zt?' <span class="pill">zeitnot</span>':''}</td>
  <td><a href="${lichess(m.fen,g.couleur)}" target="_blank" rel="noopener">Position</a> · <a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a></td></tr>`}).join('')||'<tr><td colspan="9" class="empty">Aucun moment pour ces filtres.</td></tr>'}

const ADVICE={
 milieu:'Avant chaque coup, une vérification systématique : quels sont les échecs, captures et menaces, pour moi et pour l\'adversaire ? 15 à 20 minutes de problèmes tactiques par jour (thèmes : fourchettes, clouages, pièces non protégées), puis rejouer les positions ci-dessous sans regarder la solution.',
 finale:'Revoir les finales de base (roi et pions, opposition, finales de tours : Lucena et Philidor), puis rejouer contre Stockfish les finales ratées listées ci-dessous jusqu\'à trouver le bon plan.',
 ouverture:'Reprendre les lignes qui te laissent une position inférieure après 12 coups (tableau des ouvertures, colonne « Éval. ») : noter tes coups, les comparer à la théorie, et retenir les plans plutôt que des suites par cœur.',
 temps:'Se fixer un budget de temps (ex. en 10 min : ne pas dépasser un tiers du temps au 15e coup), jouer vite les coups forcés, et réserver la réflexion aux moments critiques. Les parties 15+10 aident à construire ce réflexe.',
 conversion:'Quand tu es gagnant : simplifier (échanger les pièces, pas les pions), supprimer le contre-jeu adverse avant d\'attaquer, et vérifier les menaces adverses à chaque coup. S\'entraîner en rejouant ces positions gagnantes contre Stockfish.',
 positionnel:'Tu perds ces parties sans gaffe nette : l\'adversaire prend l\'avantage petit à petit. Travailler les structures de pions de ton répertoire, l\'activité des pièces et les plans typiques, par exemple avec des parties de maîtres commentées.'};
function renderPriorities(A,ranked,totalLost,G){
 const cad=$('fCadence').value;$('prioSub').textContent=`Classées selon les points perdus dans les ${A.n} parties analysées${cad?' en '+cad:' (toutes cadences analysées confondues : filtre « Cadence » pour les séparer)'}. Seules les parties non gagnées comptent.`;
 const evidence=(c,v)=>{const ph=A.ph[c];const base=`${fmt(v.pts,1)} points perdus dans ${v.games.length} parties (${fmt(pct(v.pts,totalLost),0)} % du total).`;
  if(ph)return base+` Dans cette phase, tu fais ${fmt(100*ph.gaf/ph.coups,1)} gaffes pour 100 coups.`+(c==='milieu'&&A.occ?` Tu as aussi laissé passer ${A.occ} grosses erreurs adverses sans les punir.`:'');
  if(c==='temps')return base+` ${fmt(pct(A.zt,A.errs),0)} % de tes erreurs et gaffes sont commises en zeitnot, et ${A.timeouts} défaites sont des pertes au temps.`;
  if(c==='conversion')return base+` Tu as été gagnant dans ${A.winning} parties et n'en as pas gagné ${A.notConv}.`;
  return base};
 const worstOpenings=c=>c!=='ouverture'?'':(()=>{const r=openingRows(G,'variante',5).filter(r=>r.ev!=null&&r.na>=3).sort((a,b)=>a.ev-b.ev).slice(0,3);return r.length?`<p>Lignes les plus difficiles : ${r.map(x=>`${esc(x.name)} (${x.col}, ${(x.ev>0?'+':'')+fmt(x.ev,2)})`).join(' ; ')}.</p>`:''})();
 $('prio').innerHTML=ranked.slice(0,3).map(([c,v],i)=>{const ex=v.games.slice(-3).reverse().map(g=>{const d=g.sf.decisive&&momentOf(g.i,g.sf.decisive.ply);
   return `<li>${esc(g.date)} contre ${esc(g.adversaire)} : ${d?`<a href="${lichess(d.fen,g.couleur)}" target="_blank" rel="noopener">${esc(d.n+' '+d.san)}</a> (meilleur : ${esc(d.best)}) · `:''}<a href="${esc(g.lien)}" target="_blank" rel="noopener">partie</a></li>`}).join('');
  return `<div class="panel"><div class="rank">Priorité ${i+1}</div><h3>${CAUSES[c]}</h3><div class="impact">${evidence(c,v)}</div>${worstOpenings(c)}<p><b>À travailler :</b> ${ADVICE[c]}</p><div class="muted" style="font-size:12px">Exemples récents :</div><ul>${ex}</ul></div>`}).join('')||'<div class="empty">Pas assez de parties non gagnées analysées.</div>'}

/* ---------- constats ---------- */
function renderInsights(G,GA){const out=[];
 const byCad=cadences.map(c=>({c,...score(GA.filter(g=>g.cadence===c))})).filter(x=>x.n>=30).sort((a,b)=>b.s-a.s);
 if(byCad.length>1){const b=byCad[0],w=byCad[byCad.length-1],share=pct(GA.filter(g=>g.cadence==='blitz').length,GA.length);
  out.push(`Tu scores <b>${fmt(b.s)} %</b> en ${b.c} contre <b>${fmt(w.s)} %</b> en ${w.c} : ${fmt(b.s-w.s)} points d'écart.`+(share>40?` Le blitz représente ${fmt(share,0)} % de tes parties.`:''))}
 const col=['Blancs','Noirs'].map(c=>({c,...score(G.filter(g=>g.couleur===c))}));
 if(col[0].n>=10&&col[1].n>=10){const [hi,lo]=col[0].s>=col[1].s?col:[col[1],col[0]];out.push(`Avec les ${hi.c}, ton score est de <b>${fmt(hi.s)} %</b> contre ${fmt(lo.s)} % avec les ${lo.c} (${fmt(hi.s-lo.s)} points d'écart).`)}
 const comp=score(G.filter(g=>Math.abs(gap(g))<=50));if(comp.n>=10)out.push(`Contre des adversaires de niveau comparable (±50 Elo), ton score est de <b>${fmt(comp.s)} %</b> sur ${comp.n} parties.`);
 const op=openingRows(G,'famille',10).sort((a,b)=>b.s-a.s);if(op.length>1){const b=op[0],w=op[op.length-1];out.push(`Ouverture la plus rentable (≥ 10 parties) : <b>${esc(b.name)}</b> avec les ${b.col} (${fmt(b.s)} %). La moins rentable : <b>${esc(w.name)}</b> avec les ${w.col} (${fmt(w.s)} %, ${vnd(w)}).`)}
 const A=sfAgg(G);if(A){const phs=['ouverture','milieu','finale'].filter(p=>A.ph[p].coups>=50).map(p=>({p,r:100*A.ph[p].gaf/A.ph[p].coups})).sort((a,b)=>b.r-a.r);
  if(phs.length)out.push(`Stockfish : ${fmt(A.gaf/A.n,2)} gaffe par partie en moyenne ; c'est en <b>${PHASE[phs[0].p].toLowerCase()}</b> que tu gaffes le plus (${fmt(phs[0].r,1)} pour 100 coups).`);
  if(A.winning)out.push(`Tu as obtenu une position gagnante dans ${A.winning} parties analysées et n'en as pas gagné <b>${A.notConv}</b> (${fmt(pct(A.notConv,A.winning),0)} %).`)}
 $('insights').innerHTML=out.map(x=>`<li>${x}</li>`).join('')||'<li class="muted">Pas assez de parties dans la sélection.</li>'}

/* ---------- entraînement ---------- */
const DECKS={
 conversion:['Conversion des positions gagnantes',(m,g)=>m.wb>=T.win&&g.resultat!=='Victoire'],
 milieu:['Tactique en milieu de partie',m=>m.ph==='milieu'],
 finale:['Technique de finale',m=>m.ph==='finale'],
 ouverture:['Sortie d\'ouverture',m=>m.ph==='ouverture'],
 occ:['Occasions manquées',m=>m.occ],
 mm:['Mats manqués',m=>m.mm],
 temps:['Erreurs en zeitnot',m=>m.zt],
 tout:['Toutes mes erreurs',()=>true]};
const CAUSE_DECK={temps:'temps',conversion:'conversion',ouverture:'ouverture',milieu:'milieu',finale:'finale',positionnel:'tout'};
const SRS_KEY='chess-up:entrainement:'+D.username,INTERVALS=[0,1,3,7,16,35];   // jours avant de revoir une position, selon sa boîte
const srs=(()=>{try{return JSON.parse(localStorage.getItem(SRS_KEY))||{}}catch(e){return {}}})();
const saveSrs=()=>{try{localStorage.setItem(SRS_KEY,JSON.stringify(srs))}catch(e){}};
const cardId=m=>D.games[m.g].lien+'#'+m.ply;
const GLYPH={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'},PIECE={p:'de pion',n:'de cavalier',b:'de fou',r:'de tour',q:'de la dame',k:'du roi'};
const bare=s=>String(s).replace(/[+#?!]/g,'');
let topCause=null,deckChosen=false,queue=[],cur=null,session={ok:0,n:0},trIds=new Set();

function renderTraining(G){const ok=typeof Chess!=='undefined'&&D.moments.some(m=>m.best);
 $('trBlock').hidden=!ok;$('trMissing').hidden=ok;
 if(!ok){$('trMissing').textContent=typeof Chess==='undefined'?'L\'échiquier n\'a pas pu être chargé : il faut une connexion internet.':'Aucune position à travailler : lance d\'abord l\'analyse Stockfish.';return}
 trIds=new Set(G.map(g=>g.i));
 const sel=$('tDeck'),prev=sel.value,def=CAUSE_DECK[topCause]||'tout';sel.innerHTML='';
 Object.entries(DECKS).forEach(([k,[l]])=>{const n=deckCards(k).length;if(n||k===def)sel.add(new Option(`${l} (${n})${k===def?' · priorité 1':''}`,k))});
 sel.value=deckChosen&&[...sel.options].some(o=>o.value===prev)?prev:def;
 buildQueue(false)}
function deckCards(k){const f=DECKS[k][1];return D.moments.filter(m=>m.best&&trIds.has(m.g)&&f(m,D.games[m.g]))}
function buildQueue(all){const now=Date.now();
 const due=deckCards($('tDeck').value).map(m=>({m,s:srs[cardId(m)]})).filter(c=>all||!c.s||c.s.due<=now);
 // d'abord les positions déjà vues à revoir, puis les nouvelles, des plus récentes aux plus anciennes
 due.sort((a,b)=>(!a.s)-(!b.s)||(a.s?a.s.due-b.s.due:(b.m.g-a.m.g)||(a.m.ply-b.m.ply)));
 queue=due.map(c=>c.m);cur=null;nextCard()}
function updateStats(){const cards=deckCards($('tDeck').value),mastered=cards.filter(m=>(srs[cardId(m)]?.b||0)>=3).length;
 $('tStats').textContent=`${queue.length+(cur&&!cur.done?1:0)} à faire · ${mastered}/${cards.length} maîtrisées · séance : ${session.ok}/${session.n} réussies du premier coup`}
function setFeedback(cls,html){$('tFeedback').className='feedback '+cls;$('tFeedback').innerHTML=html}
const gameNote=()=>`En partie, tu as joué <b>${esc(cur.m.san)}</b> : tes chances de gain sont passées de ${cur.m.wb} % à ${cur.m.wa} %.`;

function grade(ok){const id=cardId(cur.m),s=srs[id]||{b:0,n:0};
 if(!ok)s.b=0;else if(!cur.hint)s.b=Math.min(s.b+1,INTERVALS.length-1);   // avec indice : réussie, mais la boîte ne monte pas
 s.n++;s.due=Date.now()+(ok?Math.max(1,INTERVALS[s.b]):0)*864e5;srs[id]=s;saveSrs();
 cur.done=true;session.n++;if(ok&&!cur.hint)session.ok++;
 if(!ok)queue.splice(Math.min(3,queue.length),0,cur.m);   // une position ratée revient quelques positions plus loin
 updateStats()}

function nextCard(){if(cur&&!cur.done&&cur.failed)grade(false);cur=null;
 while(queue.length&&!cur){const m=queue.shift(),best=new Chess(m.fen).move(m.best,{sloppy:true});
  if(best)cur={m,g:D.games[m.g],game:new Chess(m.fen),best,sel:null,last:null,hint:false,failed:false,done:false,locked:false}}
 if(!cur){$('board').innerHTML='';$('tMeta').textContent='';$('tTitle').textContent='Rien à revoir aujourd\'hui dans ce thème';$('tLinks').innerHTML='';setFeedback('','');
  $('tPrompt').innerHTML='Change de thème, ou <a href="#" id="tAll">reprends toutes les positions de ce thème</a>.';$('tAll').onclick=e=>{e.preventDefault();buildQueue(true)};
  $('tHint').disabled=$('tSolve').disabled=true;updateStats();return}
 const g=cur.g,m=cur.m;
 $('tMeta').textContent=`${g.date} · ${g.cadence} · contre ${g.adversaire} (${g.elo_adversaire}) · ${PHASE[m.ph]}`;
 $('tTitle').textContent=`Coup ${m.n.replace(/\.+$/,'')} · les ${g.couleur} jouent`;
 $('tPrompt').textContent=m.mm?'Il y a un mat en 3 coups ou moins. Trouve-le.':m.occ?`Ton adversaire vient de se tromper : tu as ${m.wb} % de chances de gain. Punis l'erreur.`
  :m.wb>=T.win?`Tu es gagnant (${m.wb} % de chances de gain). Trouve le coup qui garde l'avantage.`:`Tes chances de gain : ${m.wb} %. Trouve le meilleur coup.`;
 setFeedback('','');
 $('tLinks').innerHTML=`<a href="${lichess(m.fen,g.couleur)}" target="_blank" rel="noopener">Analyse</a> · <a href="https://lichess.org/?fen=${encodeURIComponent(m.fen)}#ai" target="_blank" rel="noopener">Jouer la suite contre Stockfish</a> · <a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a>`;
 draw();updateStats()}

function draw(){const flip=cur.g.couleur==='Noirs',G=cur.game,targets=cur.sel?G.moves({square:cur.sel,verbose:true}):[];let h='';
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){const f=flip?7-c:c,rk=flip?r+1:8-r,sq='abcdefgh'[f]+rk,p=G.get(sq),t=targets.some(x=>x.to===sq);
  const cls=['sq',(f+rk)%2?'light':'dark'];
  if(cur.last&&cur.last.includes(sq))cls.push('last');if(cur.sel===sq)cls.push('sel');if(cur.hint&&!cur.done&&sq===cur.best.from)cls.push('hint');if(t)cls.push('target',p?'capt':'');
  h+=`<div class="${cls.join(' ')}" data-sq="${sq}">${c===0?`<span class="coord r">${rk}</span>`:''}${r===7?`<span class="coord f">${'abcdefgh'[f]}</span>`:''}${p?`<span class="pc ${p.color}">${GLYPH[p.type]}</span>`:''}</div>`}
 $('board').innerHTML=h;$('tHint').disabled=$('tSolve').disabled=cur.done}

function play(from,to){const c=cur,m=c.m,isBest=from===c.best.from&&to===c.best.to;
 const mv=c.game.move({from,to,promotion:isBest&&c.best.promotion||'q'});c.sel=null;c.last=[from,to];
 if(isBest){const first=!c.failed;grade(first);
  setFeedback('ok',`<b>${first?(c.hint?'Trouvé avec l\'indice.':'Bien joué !'):'Trouvé.'}</b> ${esc(m.best)} est le coup de Stockfish. ${gameNote()}${first?'':' La position reviendra dans la séance.'}`);draw();return}
 c.failed=true;c.locked=true;
 setFeedback('ko',bare(mv.san)===bare(m.san)?`<b>${esc(mv.san)}</b>, c'est le coup joué en partie : il fait passer tes chances de gain de ${m.wb} % à ${m.wa} %. Cherche mieux.`
  :`<b>${esc(mv.san)}</b> n'est pas le coup de Stockfish. Réessaie, demande un indice ou regarde la solution.`);
 draw();setTimeout(()=>{if(cur!==c)return;c.game.undo();c.last=null;c.locked=false;draw()},900)}

$('board').addEventListener('click',e=>{const el=e.target.closest('.sq');if(!el||!cur||cur.done||cur.locked)return;const sq=el.dataset.sq,p=cur.game.get(sq);
 if(cur.sel&&cur.game.moves({square:cur.sel,verbose:true}).some(x=>x.to===sq))return play(cur.sel,sq);
 cur.sel=p&&p.color===cur.game.turn()&&cur.sel!==sq?sq:null;draw()});
$('tHint').onclick=()=>{if(!cur||cur.done)return;cur.hint=true;setFeedback('',`Indice : c'est un coup ${PIECE[cur.best.piece]} (case surlignée).`);draw()};
$('tSolve').onclick=()=>{if(!cur||cur.done||cur.locked)return;cur.failed=true;grade(false);cur.game.move(cur.best.san);cur.last=[cur.best.from,cur.best.to];cur.sel=null;
 setFeedback('ko',`Solution : <b>${esc(cur.m.best)}</b>. ${gameNote()} La position reviendra dans la séance.`);draw()};
$('tNext').onclick=()=>nextCard();
$('tDeck').addEventListener('change',()=>{deckChosen=true;buildQueue(false)});

/* ---------- historique ---------- */
function renderGames(G){const q=$('search').value.toLowerCase(),r=$('resultFilter').value;
 const list=G.filter(g=>(!q||(g.adversaire+' '+g.ouverture).toLowerCase().includes(q))&&(!r||g.resultat===r)).slice().reverse();
 $('games').innerHTML=list.map(g=>{const pc=g['precision_joueur_%']!==''?fmt(+g['precision_joueur_%'])+' %':g.sf?.prec!=null?fmt(g.sf.prec)+' %*':'—';
  const gf=g.sf?g.sf.phases.ouverture.gaf+g.sf.phases.milieu.gaf+g.sf.phases.finale.gaf:'—';
  return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(g.couleur)}</td><td class="${g.resultat==='Victoire'?'win':g.resultat==='Défaite'?'loss':'draw'}">${esc(g.resultat)}</td><td class="muted">${esc(FIN[g.fin]||g.fin)}</td><td class="num">${esc(g.elo_joueur)}</td><td>${esc(g.adversaire)}</td><td class="num">${esc(g.elo_adversaire)}</td><td class="num">${pc}</td><td class="num">${gf}</td><td>${esc(g.ouverture)}</td><td><a href="${esc(g.lien)}" target="_blank" rel="noopener">Voir</a></td></tr>`}).join('')}

['fCadence','fPeriod','fRated'].forEach(id=>$(id).addEventListener('change',render));
['oGroup','oMin'].forEach(id=>$(id).addEventListener('change',()=>renderOpenings(baseFilter(false))));
['mType','mPhase'].forEach(id=>$(id).addEventListener('change',()=>renderMoments(baseFilter(false))));
$('search').addEventListener('input',()=>renderGames(baseFilter(false)));$('resultFilter').addEventListener('change',()=>renderGames(baseFilter(false)));
$('csvBtn').onclick=()=>{const keys=['date','cadence','couleur','resultat','fin','elo_joueur','adversaire','elo_adversaire','precision_joueur_%','ouverture','famille','variante','ECO','lien'];
 const rows=baseFilter(false);const csv=[[...keys,'precision_stockfish_%','acpl','gaffes'].join(';'),...rows.map(r=>[...keys.map(k=>r[k]),r.sf?.prec??'',r.sf?.acpl??'',r.sf?r.sf.phases.ouverture.gaf+r.sf.phases.milieu.gaf+r.sf.phases.finale.gaf:''].map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';'))].join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));a.download='chess_games.csv';a.click();URL.revokeObjectURL(a.href)};
if(cadences.includes('rapid')&&D.games.some(g=>g.sf&&g.cadence==='rapid'))$('fCadence').value='rapid';
render();
</script></body></html>'''

if __name__ == "__main__":
    main()
