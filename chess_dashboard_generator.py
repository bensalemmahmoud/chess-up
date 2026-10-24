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
BUILD = datetime.now().strftime("%Y%m%d%H%M%S")   # version de cette publication (site/version.txt) : les pages plus anciennes se rechargent
TEMPLATES_DIR = BASE_DIR / "templates"
CACHE_DIR = BASE_DIR / "cache"
ANALYSIS_CACHE = CACHE_DIR / "analyses.json"   # partagé entre joueurs : une partie entre deux amis n'est analysée qu'une fois
OBJECTIVES_CACHE = CACHE_DIR / "objectifs.json"   # échantillons de joueurs plus forts, partagés entre joueurs de même niveau
OBJECTIVE_GAP = 200        # objectif : les joueurs de cet écart d'Elo au-dessus du joueur, dans sa cadence principale
OBJECTIVE_PLAYERS = 15     # joueurs de l'échantillon...
OBJECTIVE_GAMES = 6        # ... et parties récentes analysées pour chacun
OBJECTIVE_WIDTH = 75       # « autour de » l'objectif : à ± ce nombre de points
OBJECTIVE_MAX_AGE = 30     # jours avant de renouveler l'échantillon
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

def first_moves(pgn, n=chess_analysis.OPENING_PLIES):
    """Premiers coups (SAN) d'un PGN, sans python-chess : rapide même sur des milliers de parties."""
    text = re.sub(r"\[[^\]]*\]|\{[^}]*\}|\([^)]*\)|\$\d+", " ", pgn)
    moves = []
    for token in text.split():
        token = re.sub(r"^\d+\.+", "", token)
        if token and token not in ("1-0", "0-1", "1/2-1/2", "*"):
            moves.append(token)
    return " ".join(moves[:n])

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
        "rules": game.get("rules", "chess"), "coups": first_moves(pgn),
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
        "coups": " ".join(game.get("moves", "").split()[:chess_analysis.OPENING_PLIES]),
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

def opening_repertoire(rows, pgns, cache):
    """Évaluation Stockfish des positions d'ouverture où le joueur a le trait, agrégée sur ses parties analysées :
    {coups qui y mènent: {"b": meilleur coup, "w": chances de gain, "m": {coup joué: chances de gain après}}}."""
    acc = {}
    for r in rows:
        if not r["sf"]:
            continue
        try:
            positions = chess_analysis.opening_positions(r, pgns[r["lien"]], cache[r["lien"]])
        except Exception:
            continue
        for key, best, before, san, after in positions:
            rec = acc.setdefault(key, {"b": best, "w": [], "m": {}})
            rec["w"].append(before)
            rec["m"].setdefault(san, []).append(after)
    avg = lambda xs: round(sum(xs) / len(xs))
    return {k: {"b": v["b"], "w": avg(v["w"]), "m": {san: avg(w) for san, w in v["m"].items()}} for k, v in acc.items()}

def build_objective(args, rows, lichess, cache):
    """Parties récentes de joueurs ~OBJECTIVE_GAP Elo au-dessus du joueur, dans sa cadence la plus analysée,
    pour comparer leurs indicateurs Stockfish aux siens. Les joueurs sont choisis parmi ses propres adversaires."""
    analysed = Counter(r["cadence"] for r in rows if r["sf"])
    cadence = analysed.most_common(1)[0][0]
    elos = [int(r["elo_joueur"]) for r in rows if r["cadence"] == cadence and r["elo_joueur"]]
    if not elos:
        return None
    target = round((elos[-1] + OBJECTIVE_GAP) / 50) * 50
    key = f"{'lichess' if lichess else 'chesscom'}:{cadence}:{target}"
    store = chess_analysis.load_cache(OBJECTIVES_CACHE)
    entry = store.get(key)
    age = (datetime.now() - datetime.fromisoformat(entry["date"])).days if entry else None
    if (entry is None or age > OBJECTIVE_MAX_AGE) and not args.no_analysis:
        entry = sample_objective(rows, lichess, cadence, target) or entry
        if entry:
            store[key] = entry
            chess_analysis.save_cache(OBJECTIVES_CACHE, store)
    if not entry:
        return None
    games = entry["games"]
    if not args.no_analysis:
        cache = chess_analysis.analyse_games([{"lien": g["lien"], "pgn": g["pgn"]} for g in games], ANALYSIS_CACHE,
                                             depth=args.depth, workers=args.workers, alternatives=False)
    metrics = []
    for g in games:
        if g["lien"] in cache:
            try:
                sf, _ = chess_analysis.game_metrics(g, g["pgn"], cache[g["lien"]])
                metrics.append({"resultat": g["resultat"], "fin": g["fin"], "sf": sf})
            except Exception:
                pass
    print(f"Objectif {target} en {cadence} : {entry['players']} joueurs, {len(metrics)} parties analysées")
    return {"cadence": cadence, "target": target, "elo": entry["elo"], "players": entry["players"],
            "date": entry["date"][:10], "games": metrics} if metrics else None

def sample_objective(rows, lichess, cadence, target):
    """Joueurs autour de target : d'abord les adversaires du joueur à ce niveau, puis, s'il en manque,
    les adversaires de ces joueurs eux aussi à ce niveau (échantillon « boule de neige »)."""
    global USERNAME
    me = USERNAME
    near = lambda elo, width=OBJECTIVE_WIDTH: bool(elo) and abs(int(elo) - target) <= width
    usable = lambda name: name not in ("Inconnu", "Anonyme") and not name.startswith("Stockfish")
    queue = []
    for width in (OBJECTIVE_WIDTH, 2 * OBJECTIVE_WIDTH):
        queue += [r["adversaire"] for r in reversed(rows)
                  if r["cadence"] == cadence and near(r["elo_adversaire"], width) and usable(r["adversaire"])]
    seen, games, elos = {me}, [], []
    try:
        while queue and len(elos) < OBJECTIVE_PLAYERS:
            name = queue.pop(0)
            if name.lower() in seen:
                continue
            seen.add(name.lower())
            USERNAME = name.lower()
            try:
                found = recent_games_lichess(name, cadence) if lichess else recent_games_chesscom(name, cadence)
            except Exception:
                continue
            found = [(r, pgn) for r, pgn in found if r["couleur"] != "Inconnu" and r["rules"] == "chess" and pgn]
            # ses parties jouées à ce niveau, et ses adversaires de ce niveau pour compléter l'échantillon
            at_level = [(r, pgn) for r, pgn in found if near(r["elo_joueur"], 2 * OBJECTIVE_WIDTH)][-OBJECTIVE_GAMES:]
            queue += [r["adversaire"] for r, _ in reversed(found) if near(r["elo_adversaire"]) and usable(r["adversaire"])]
            if at_level:
                elos.append(int(at_level[-1][0]["elo_joueur"]))
                games += [{**r, "pgn": pgn} for r, pgn in at_level]
            time.sleep(0.5)
    finally:
        USERNAME = me
    if not games:
        return None
    return {"date": datetime.now().isoformat(timespec="seconds"), "players": len(elos),
            "elo": round(sum(elos) / len(elos)), "games": games}

def recent_games_chesscom(name, cadence):
    archives = get_json(f"https://api.chess.com/pub/player/{name.lower()}/games/archives").get("archives", [])
    found = []
    for url in reversed(archives[-2:]):
        found = [(game_row(g), g.get("pgn", "")) for g in get_json(url).get("games", []) if g.get("time_class") == cadence] + found
        if len(found) >= OBJECTIVE_GAMES:
            break
    return found

def recent_games_lichess(name, cadence):
    response = SESSION.get(f"https://lichess.org/api/games/user/{name}", timeout=60,
                           params={"max": 2 * OBJECTIVE_GAMES, "perfType": cadence, "rated": "true", "clocks": "true",
                                   "pgnInJson": "true", "opening": "true"},
                           headers={"Accept": "application/x-ndjson"})
    response.raise_for_status()
    games = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    return [(lichess_row(g), g.get("pgn", "")) for g in reversed(games) if g.get("moves")]

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
    repertoire = opening_repertoire(rows, pgns, cache)
    objective = None if not analysed else build_objective(args, rows, lichess, cache)

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
        "site": "lichess" if lichess else "chesscom",
        "games": [{k: v for k, v in r.items() if k != "rules"} for r in rows],
        "moments": moments, "repertoire": repertoire, "objectif": objective,
    }
    home = "" if args.publier else '<a href="../index.html" class="muted" style="font-size:13px">← Tous les joueurs</a>'
    page = (dashboard_page().replace("__SITE__", site_label).replace("__HOME__", home)
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
    return (template("verrou.html").replace("__SALT__", b64(salt)).replace("__IV__", b64(iv))
            .replace("__ITER__", str(PBKDF2_ITERATIONS)).replace("__BUILD__", BUILD).replace("__CIPHER__", b64(data)))

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
    page = template("accueil.html").replace("__CARDS__", "").replace("Choisis un joueur pour voir son rapport et lancer une séance d'entraînement.",
                                                         "Les rapports sont privés : ouvre le lien personnel qu'on t'a envoyé.")
    (SITE_DIR / "index.html").write_text(page.replace("__GENERATED__", datetime.now().strftime("%Y-%m-%d %H:%M")), encoding="utf-8")
    (SITE_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (SITE_DIR / "version.txt").write_text(BUILD, encoding="utf-8")
    print(f"\nSite prêt à publier : {SITE_DIR}")


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
    (REPORTS_DIR / "index.html").write_text(template("accueil.html").replace("__CARDS__", cards).replace("__GENERATED__", generated), encoding="utf-8")
    print(f"\nPage d'accueil : {REPORTS_DIR / 'index.html'} ({len(summaries)} joueurs)")



def template(name):
    return (TEMPLATES_DIR / name).read_text(encoding="utf-8")

# Code du tableau de bord, un fichier par fonctionnalité, réunis dans un seul <script> (l'ordre compte : demarrage.js en dernier)
DASHBOARD_SCRIPTS = ["base.js", "entrainement.js", "moteur.js", "repertoire.js", "objectif.js", "adversaire.js", "synchro.js", "demarrage.js"]

def dashboard_page():
    return template("dashboard.html").replace("__SCRIPT__", "\n".join(template(f"js/{name}") for name in DASHBOARD_SCRIPTS))

if __name__ == "__main__":
    main()
