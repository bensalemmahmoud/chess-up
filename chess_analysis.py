#!/usr/bin/env python3
# Analyse Stockfish des parties Chess.com.
# - analyse chaque position une seule fois (évaluation + meilleur coup) et met le résultat en cache,
#   pour que les exécutions suivantes n'analysent que les nouvelles parties ;
# - calcule ensuite, à partir du cache, les erreurs par phase, le zeitnot, les occasions manquées, etc.
# Requirements: python -m pip install chess

import io, json, math, os, platform, re, shutil, stat, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import chess, chess.engine, chess.pgn

CACHE_VERSION = 1
MATE = 10000            # un mat en n coups est encodé MATE - n (point de vue des Blancs)
OPENING_END_PLY = 24    # position évaluée « en sortie d'ouverture » : après le 12e coup des Noirs

# Seuils de perte de chances de gain (en points de %), les mêmes que Lichess
INACCURACY, MISTAKE, BLUNDER = 10, 20, 30
WINNING = 80            # au-dessus : position considérée comme gagnante (≈ +4)


STOCKFISH_DIR = Path(__file__).resolve().parent / "stockfish"
STOCKFISH_RELEASE = "https://github.com/official-stockfish/Stockfish/releases/latest/download/"


def find_stockfish():
    env = os.environ.get("STOCKFISH_PATH")
    if env and Path(env).is_file():
        return env
    if STOCKFISH_DIR.is_dir():
        if platform.system() == "Windows":
            candidates = STOCKFISH_DIR.rglob("stockfish*.exe")
        else:
            candidates = (p for p in STOCKFISH_DIR.rglob("stockfish*") if not p.suffix and os.access(p, os.X_OK))
        for exe in sorted(candidates):
            if exe.is_file():
                return str(exe)
    return shutil.which("stockfish")


def download_stockfish():
    """Télécharge la dernière version officielle de Stockfish dans ./stockfish/ et renvoie son chemin."""
    system, machine = platform.system(), platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    asset = {"Windows": "stockfish-windows-arm64-universal.zip" if arm else "stockfish-windows-x86-64-universal.zip",
             "Linux": "stockfish-linux-arm64-universal.tar.gz" if arm else "stockfish-linux-x86-64-universal.tar.gz",
             "Darwin": "stockfish-macos-universal.tar.gz"}.get(system)
    if not asset:
        return None
    print(f"Stockfish introuvable : téléchargement de {asset}...")
    STOCKFISH_DIR.mkdir(exist_ok=True)
    archive = STOCKFISH_DIR / asset
    try:
        with urllib.request.urlopen(STOCKFISH_RELEASE + asset, timeout=120) as resp, archive.open("wb") as out:
            shutil.copyfileobj(resp, out)
        shutil.unpack_archive(str(archive), str(STOCKFISH_DIR))
    except Exception as exc:
        print(f"Téléchargement de Stockfish impossible : {exc}")
        return None
    finally:
        archive.unlink(missing_ok=True)
    if system != "Windows":
        for p in STOCKFISH_DIR.rglob("stockfish*"):
            if p.is_file() and not p.suffix:
                p.chmod(p.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return find_stockfish()


# ---------------------------------------------------------------- analyse moteur

def analyse_pgn(engine, pgn, depth):
    game = chess.pgn.read_game(io.StringIO(pgn))
    board = game.board()
    evals, best = [], []

    def evaluate(b):
        if b.is_checkmate():
            return (-MATE if b.turn == chess.WHITE else MATE), ""
        if b.is_game_over(claim_draw=False):
            return 0, ""
        info = engine.analyse(b, chess.engine.Limit(depth=depth))
        pv = info.get("pv") or []
        return info["score"].white().score(mate_score=MATE), (pv[0].uci() if pv else "")

    for move in game.mainline_moves():
        e, b = evaluate(board)
        evals.append(e); best.append(b)
        board.push(move)
    e, b = evaluate(board)
    evals.append(e); best.append(b)
    return {"v": CACHE_VERSION, "d": depth, "e": evals, "b": best}


def load_cache(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(path, cache):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def analyse_games(games, cache_path, depth=14, workers=None, stockfish=None):
    """games : liste de dicts {"lien", "pgn"}. Remplit le cache et le renvoie."""
    cache = load_cache(cache_path)
    todo = [g for g in games
            if g["pgn"] and not (cache.get(g["lien"], {}).get("v") == CACHE_VERSION
                                 and cache[g["lien"]].get("d", 0) >= depth)]
    if not todo:
        print(f"Analyse Stockfish : les {len(games)} parties sont déjà en cache.")
        return cache

    stockfish = stockfish or find_stockfish() or download_stockfish()
    if not stockfish:
        print("Stockfish introuvable : installe-le (https://stockfishchess.org/download/) et place l'exécutable "
              "dans ./stockfish/ ou définis STOCKFISH_PATH. Analyse moteur ignorée.")
        return cache

    workers = workers or max(1, (os.cpu_count() or 2) - 2)
    print(f"Analyse Stockfish de {len(todo)} parties (profondeur {depth}, {workers} moteurs en parallèle)...")
    local, engines, lock = threading.local(), [], threading.Lock()

    def engine():
        if not hasattr(local, "engine"):
            local.engine = chess.engine.SimpleEngine.popen_uci(stockfish)
            local.engine.configure({"Threads": 1, "Hash": 32})
            with lock:
                engines.append(local.engine)
        return local.engine

    def job(g):
        return g["lien"], analyse_pgn(engine(), g["pgn"], depth)

    start, done = time.time(), 0
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(job, g) for g in todo]
            for fut in as_completed(futures):
                try:
                    link, result = fut.result()
                    cache[link] = result
                except Exception as exc:  # une partie illisible ne doit pas tout arrêter
                    print(f"  partie ignorée : {exc}")
                done += 1
                if done % 25 == 0 or done == len(todo):
                    save_cache(cache_path, cache)
                    elapsed = time.time() - start
                    eta = elapsed / done * (len(todo) - done)
                    print(f"  {done}/{len(todo)} parties analysées — reste environ {eta/60:.0f} min")
    finally:
        save_cache(cache_path, cache)
        for e in engines:
            try: e.quit()
            except Exception: pass
    return cache


# ---------------------------------------------------------------- métriques

def win_pct(cp):
    cp = max(-1000, min(1000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def move_accuracy(loss):
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * loss) - 3.1669))


def phase_of(board):
    npm = sum(len(board.pieces(pt, c)) * v
              for pt, v in ((chess.KNIGHT, 3), (chess.BISHOP, 3), (chess.ROOK, 5), (chess.QUEEN, 9))
              for c in chess.COLORS)
    if npm <= 26:
        return "finale"
    if board.fullmove_number <= 12:
        return "ouverture"
    return "milieu"


def base_seconds(time_control):
    m = re.match(r"^(\d+)(?:\+\d+)?$", str(time_control or ""))
    return int(m.group(1)) if m else None   # None pour les parties par correspondance (« 1/86400 »)


def game_metrics(row, pgn, analysis):
    """Renvoie (métriques de la partie, liste des moments critiques) du point de vue du joueur."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    me = chess.WHITE if row["couleur"] == "Blancs" else chess.BLACK
    sign = 1 if me == chess.WHITE else -1
    evals = [sign * e for e in analysis["e"]]
    best = analysis["b"]
    base = base_seconds(row["time_control"])
    zeitnot_limit = max(15, base * 0.10) if base else None

    phases = ("ouverture", "milieu", "finale")
    stats = {p: {"coups": 0, "imp": 0, "err": 0, "gaf": 0} for p in phases}
    cpl, accs, moments = [], [], []
    zeit_err = missed_opp = missed_mate = 0
    decisive = None
    board = game.board()
    nodes = list(game.mainline())
    for ply, node in enumerate(nodes):
        move = node.move
        if board.turn == me and ply + 1 < len(evals):
            before, after = evals[ply], evals[ply + 1]
            wb, wa = win_pct(before), win_pct(after)
            loss = max(0.0, wb - wa)
            ph = phase_of(board)
            s = stats[ph]
            s["coups"] += 1
            cpl.append(max(0, min(1000, before) - min(1000, after)))
            accs.append(move_accuracy(loss))
            clock = node.clock()
            zeit = bool(zeitnot_limit and clock is not None and clock < zeitnot_limit)
            # occasion manquée : l'adversaire vient de faire une grosse erreur et on ne la punit pas
            opp_gift = ply > 0 and wb - win_pct(evals[ply - 1]) >= MISTAKE
            mate_missed = before >= MATE - 3 and after < MATE - 50
            sev = "gaf" if loss >= BLUNDER else "err" if loss >= MISTAKE else "imp" if loss >= INACCURACY else ""
            if sev:
                s[sev] += 1
            if sev in ("err", "gaf"):
                zeit_err += zeit
                missed_opp += opp_gift
            missed_mate += mate_missed
            if sev in ("err", "gaf") or mate_missed:
                best_san = ""
                if best[ply]:
                    try: best_san = board.san(chess.Move.from_uci(best[ply]))
                    except ValueError: pass
                moments.append({
                    "ply": ply, "n": f"{board.fullmove_number}{'.' if board.turn == chess.WHITE else '...'}",
                    "san": board.san(move), "best": best_san, "fen": board.fen(),
                    "wb": round(wb), "wa": round(wa), "ph": ph, "zt": zeit,
                    "sev": sev or "mat", "occ": bool(opp_gift and sev), "mm": mate_missed,
                    "clk": round(clock) if clock is not None else None,
                })
            if loss >= MISTAKE and (decisive is None or loss > decisive["loss"]):
                decisive = {"loss": round(loss), "ph": ph, "zt": zeit, "ply": ply}
        board.push(move)

    my_wins = [win_pct(e) for i, e in enumerate(evals) if i >= 10]
    opening_eval = evals[OPENING_END_PLY] if len(evals) > OPENING_END_PLY else None
    metrics = {
        "coups": sum(s["coups"] for s in stats.values()),
        "phases": stats,
        "acpl": round(sum(cpl) / len(cpl), 1) if cpl else None,
        "prec": round(sum(accs) / len(accs), 1) if accs else None,
        "zt_err": zeit_err, "occ": missed_opp, "mm": missed_mate,
        "max_win": round(max(my_wins)) if my_wins else None,
        "eval_ouv": None if opening_eval is None else round(max(-1000, min(1000, opening_eval))),
        "decisive": decisive,
    }
    return metrics, moments
