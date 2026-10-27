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
ALTERNATIVES = 3        # coups candidats calculés aux positions d'erreur, pour accepter d'autres bons coups à l'entraînement
OPENING_PLIES = 20      # demi-coups couverts par le répertoire d'ouvertures
# Temps de réflexion d'un coup, en part du temps total d'une partie (temps initial + 40 incréments) :
# moins de 1 % (réflexe), 1 à 3 %, 3 à 8 %, 8 % et plus (longue réflexion)
TIME_BUCKETS = (0.01, 0.03, 0.08)
TIME_CHECK_MOVE = 15    # temps consommé mesuré après ce coup du joueur
VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


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


def is_mistake(before, after):
    """Perte de chances de gain d'au moins MISTAKE, ou mat rapide manqué (évaluations du point de vue du joueur au trait)."""
    return win_pct(before) - win_pct(after) >= MISTAKE or (before >= MATE - 3 and after < MATE - 50)


def analyse_alternatives(engine, pgn, analysis, depth):
    """Aux positions où le joueur au trait (Blancs ou Noirs) s'est trompé, les ALTERNATIVES meilleurs coups de Stockfish :
    {demi-coup: [[coup uci, évaluation du point de vue des Blancs], ...]}. Sert à valider d'autres bons coups à l'entraînement."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    board, evals, alts = game.board(), analysis["e"], {}
    for ply, move in enumerate(game.mainline_moves()):
        if ply + 1 < len(evals):
            sign = 1 if board.turn == chess.WHITE else -1
            if is_mistake(sign * evals[ply], sign * evals[ply + 1]):
                infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=ALTERNATIVES)
                alts[str(ply)] = [[i["pv"][0].uci(), i["score"].white().score(mate_score=MATE)] for i in infos if i.get("pv")]
        board.push(move)
    return alts


def load_cache(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(path, cache):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    for attempt in range(10):   # sous Windows, le remplacement échoue si un autre programme lit le fichier à cet instant
        try:
            tmp.replace(path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.5)


def analyse_games(games, cache_path, depth=14, workers=None, stockfish=None, alternatives=True):
    """games : liste de dicts {"lien", "pgn"}. Remplit le cache et le renvoie.
    alternatives=False : sans les coups alternatifs (inutiles hors entraînement, par exemple pour l'objectif +200 Elo)."""
    cache = load_cache(cache_path)
    up_to_date = lambda g: cache.get(g["lien"], {}).get("v") == CACHE_VERSION and cache[g["lien"]].get("d", 0) >= depth
    todo = [g for g in games if g["pgn"] and not up_to_date(g)]
    # parties analysées avant l'ajout des coups alternatifs : seul ce complément est calculé
    todo_alts = [g for g in games if alternatives and g["pgn"] and up_to_date(g) and "a" not in cache[g["lien"]]]
    if not todo and not todo_alts:
        print(f"Analyse Stockfish : les {len(games)} parties sont déjà en cache.")
        return cache

    stockfish = stockfish or find_stockfish() or download_stockfish()
    if not stockfish:
        print("Stockfish introuvable : installe-le (https://stockfishchess.org/download/) et place l'exécutable "
              "dans ./stockfish/ ou définis STOCKFISH_PATH. Analyse moteur ignorée.")
        return cache

    workers = workers or max(1, (os.cpu_count() or 2) - 2)
    print(f"Analyse Stockfish de {len(todo)} parties" + (f", coups alternatifs de {len(todo_alts)} autres" if todo_alts else "")
          + f" (profondeur {depth}, {workers} moteurs en parallèle)...")
    local, engines, lock = threading.local(), [], threading.Lock()

    def engine():
        if not hasattr(local, "engine"):
            local.engine = chess.engine.SimpleEngine.popen_uci(stockfish)
            local.engine.configure({"Threads": 1, "Hash": 32})
            with lock:
                engines.append(local.engine)
        return local.engine

    def job(g, full):
        result = analyse_pgn(engine(), g["pgn"], depth) if full else dict(cache[g["lien"]])
        if alternatives:
            result["a"] = analyse_alternatives(engine(), g["pgn"], result, depth)
        return g["lien"], result

    start, done, total = time.time(), 0, len(todo) + len(todo_alts)
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(job, g, True) for g in todo] + [pool.submit(job, g, False) for g in todo_alts]
            for fut in as_completed(futures):
                try:
                    link, result = fut.result()
                    cache[link] = result
                except Exception as exc:  # une partie illisible ne doit pas tout arrêter
                    print(f"  partie ignorée : {exc}")
                done += 1
                if done % 25 == 0 or done == total:
                    save_cache(cache_path, cache)
                    elapsed = time.time() - start
                    eta = elapsed / done * (total - done)
                    print(f"  {done}/{total} parties analysées — reste environ {eta/60:.0f} min")
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


def endgame_type(board):
    """Type de finale selon les pièces restantes (rois et pions exclus), pour les deux camps."""
    kinds = {pt for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN) if board.pieces(pt, chess.WHITE) or board.pieces(pt, chess.BLACK)}
    if not kinds:
        return "pions"
    if kinds == {chess.ROOK}:
        return "tours"
    if kinds <= {chess.KNIGHT, chess.BISHOP}:
        return "mineures"
    if kinds == {chess.QUEEN}:
        return "dames"
    if kinds <= {chess.ROOK, chess.KNIGHT, chess.BISHOP}:
        return "tours_mineures"
    return "dames_pieces"


def base_seconds(time_control):
    m = re.match(r"^(\d+)(?:\+\d+)?$", str(time_control or ""))
    return int(m.group(1)) if m else None   # None pour les parties par correspondance (« 1/86400 »)


def increment_seconds(time_control):
    m = re.match(r"^\d+\+(\d+)$", str(time_control or ""))
    return int(m.group(1)) if m else 0


# ---------------------------------------------------------------- motifs tactiques
# Détection volontairement simple (un coup, sans la suite de la variante) : la position, le coup et le cache suffisent.

def wins_material(board, move):
    """Le coup prend une pièce non défendue, ou une pièce plus précieuse que celle qui prend."""
    if not board.is_capture(move):
        return False
    if board.is_en_passant(move):
        return False
    victim, attacker = board.piece_at(move.to_square), board.piece_at(move.from_square)
    return VALUE[victim.piece_type] > VALUE[attacker.piece_type] or not board.attackers(victim.color, move.to_square)


def is_fork(board, move):
    """Après le coup, la pièce jouée attaque au moins deux cibles (le roi, une pièce plus précieuse qu'elle
    ou une pièce non défendue) sans pouvoir être prise gratuitement ou par une pièce de moindre valeur."""
    piece = board.piece_at(move.from_square)
    after = board.copy(stack=False)
    after.push(move)
    me, to = piece.color, move.to_square
    takers = after.attackers(not me, to)
    if takers and (not after.attackers(me, to) or min(VALUE[after.piece_type_at(s)] or 99 for s in takers) < VALUE[piece.piece_type]):
        return False
    targets = 0
    for sq in after.attacks(to):
        t = after.piece_at(sq)
        if t and t.color != me and (t.piece_type == chess.KING or VALUE[t.piece_type] > VALUE[piece.piece_type]
                                    or (t.piece_type != chess.PAWN and not after.attackers(t.color, sq))):
            targets += 1
    return targets >= 2


def pins(board, move):
    """Après le coup, une pièce adverse (hors pion) est clouée sur son roi alors qu'elle ne l'était pas."""
    opp = not board.turn
    before = {sq for sq in chess.SquareSet(board.occupied_co[opp]) if board.is_pinned(opp, sq)}
    after = board.copy(stack=False)
    after.push(move)
    return any(sq not in before and after.piece_type_at(sq) not in (chess.PAWN, chess.KING) and after.is_pinned(opp, sq)
               for sq in chess.SquareSet(after.occupied_co[opp]))


def motifs(board, move, best_uci, reply_uci, before, after):
    """Motifs d'une erreur du joueur au trait : ce que le meilleur coup gagnait (« _manque ») et ce que la meilleure
    réponse adverse après le coup joué gagne (« _subi »). Évaluations du point de vue du joueur."""
    out = []
    if before >= MATE - 3 and after < MATE - 50:
        out.append("mat_manque")
    best = chess.Move.from_uci(best_uci) if best_uci else None
    if best and best in board.legal_moves:
        if wins_material(board, best): out.append("materiel_manque")
        if is_fork(board, best): out.append("fourchette_manquee")
        if pins(board, best): out.append("clouage_manque")
    played = board.copy(stack=False)
    played.push(move)
    if after <= -(MATE - 5):
        out.append("mat_subi")
    reply = chess.Move.from_uci(reply_uci) if reply_uci else None
    if reply and reply in played.legal_moves:
        if wins_material(played, reply): out.append("materiel_subi")
        if is_fork(played, reply): out.append("fourchette_subie")
        if pins(played, reply): out.append("clouage_subi")
    return out


# ---------------------------------------------------------------- éléments de la position (exercices d'étude)
# Règles simples, calculées pour chaque camp : des pistes pour évaluer une position, pas des verdicts.
# Chaque élément présent donne la liste des cases concernées (surlignées dans l'explication).

STUDY_START_PLY = 16    # positions d'étude : à partir du 9e coup des Blancs (ouverture jouée)
STUDY_MAX_EVAL = 400    # au-delà de ±4, la position est déjà décidée : il n'y a plus grand-chose à évaluer
STUDY_MIN_FEATURES = 2  # une position d'étude doit présenter au moins ce nombre d'éléments
STUDY_STABLE_PLIES = 4  # position calme : l'évaluation ne bouge presque pas pendant les demi-coups suivants...
STUDY_STABLE_WIN = 8    # ... au plus ce nombre de points de chances de gain d'écart (pas de tactique cachée)
MOBILITY_RATIO = 1.3    # « pièces plus actives » : au moins 30 % de cases accessibles en plus...
MOBILITY_GAP = 6        # ... et au moins 6 cases d'écart


def _rel_rank(sq, color):
    """Rangée vue du camp color (0 = sa première rangée)."""
    return chess.square_rank(sq) if color == chess.WHITE else 7 - chess.square_rank(sq)


def _front(sq, color):
    return sq + 8 if color == chess.WHITE else sq - 8


def pawn_structure(board, color):
    mine, theirs = board.pieces(chess.PAWN, color), board.pieces(chess.PAWN, not color)
    files = [chess.square_file(s) for s in mine]
    out = {"isoles": [], "doubles": [], "arrieres": [], "passes": []}
    for sq in mine:
        f, r = chess.square_file(sq), _rel_rank(sq, color)
        neighbours = [s for s in mine if abs(chess.square_file(s) - f) == 1]
        if not neighbours and 0 < f < 7:   # un pion de tour isolé est rarement une vraie faiblesse
            out["isoles"].append(sq)
        if files.count(f) > 1:
            out["doubles"].append(sq)
        if not any(abs(chess.square_file(s) - f) <= 1 and _rel_rank(s, color) > r for s in theirs):
            out["passes"].append(sq)
        # arriéré : ses voisins sont tous plus avancés (plus aucun pion pour le protéger), la case devant lui
        # est tenue par un pion adverse, et sa colonne est semi-ouverte pour l'adversaire
        elif (neighbours and all(_rel_rank(s, color) > r for s in neighbours)
              and not any(chess.square_file(s) == f for s in theirs)
              and 0 <= _front(sq, color) < 64 and board.attackers(not color, _front(sq, color)) & theirs):
            out["arrieres"].append(sq)
    return out


def hanging_pieces(board, color):
    """Pièces (hors pions et roi) attaquées et non défendues, ou attaquées par une pièce de moindre valeur.
    Une pièce clouée sur son roi ne compte ni pour attaquer ni pour défendre, sauf le long du clouage."""
    out = []
    for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        for sq in board.pieces(pt, color):
            free = lambda side, a: sq in board.pin(side, a)
            attackers = [a for a in board.attackers(not color, sq) if free(not color, a)]
            defenders = [d for d in board.attackers(color, sq) if free(color, d)]
            if attackers and (not defenders or min(VALUE[board.piece_type_at(a)] or 99 for a in attackers) < VALUE[pt]):
                out.append(sq)
    return out


def king_features(board, color, endgame):
    k = board.king(color)
    if k is None:
        return {}
    f, r = chess.square_file(k), _rel_rank(k, color)
    if endgame:   # en finale, le roi doit être actif : centralisé (colonnes c à f, rangées 3 à 6)
        return {"roi_actif": [k]} if 2 <= f <= 5 and 2 <= r <= 5 else {}
    if not board.pieces(chess.QUEEN, not color) or r > 1:
        return {}
    pawns = board.pieces(chess.PAWN, color)
    # roi resté au centre alors qu'une colonne centrale (d ou e) n'a plus de pion de son camp
    if r == 0 and f in (3, 4, 5) and any(not any(chess.square_file(p) == cf for p in pawns) for cf in (3, 4)):
        return {"roi_centre": [k]}
    step = 1 if color == chess.WHITE else -1
    files = range(max(0, f - 1), min(7, f + 1) + 1)
    shield = [chess.square(sf, chess.square_rank(k) + d * step) for sf in files for d in (1, 2)]
    if sum(1 for s in shield if s in pawns) <= 1:   # abri de pions détruit, avec la dame adverse sur l'échiquier
        return {"roi_ouvert": [k] + [chess.square(sf, chess.square_rank(k) + step) for sf in files]}
    return {}


def mobility(board, color):
    return sum(len(board.attacks(sq) & ~board.occupied_co[color])
               for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN) for sq in board.pieces(pt, color))


def piece_features(board, color):
    out = {}
    pawns, their_pawns = board.pieces(chess.PAWN, color), board.pieces(chess.PAWN, not color)
    open_files = {f for f in range(8) if not any(chess.square_file(p) == f for p in board.pieces(chess.PAWN, chess.WHITE) | board.pieces(chess.PAWN, chess.BLACK))}
    rooks = [s for s in board.pieces(chess.ROOK, color) if chess.square_file(s) in open_files]
    if rooks:
        out["colonne"] = rooks
    colour = lambda sq: (chess.square_file(sq) + chess.square_rank(sq)) % 2
    bishops = list(board.pieces(chess.BISHOP, color))
    their_bishops = board.pieces(chess.BISHOP, not color)
    if len({colour(b) for b in bishops}) == 2 and len({colour(b) for b in their_bishops}) < 2:
        out["paire_fous"] = bishops
    for b in bishops:   # mauvais fou : au moins 4 de ses pions sur sa couleur, dont 2 bloqués par un pion adverse
        same = [p for p in pawns if colour(p) == colour(b)]
        blocked = [p for p in same if 0 <= _front(p, color) < 64 and _front(p, color) in their_pawns]
        if len(same) >= 4 and len(blocked) >= 2:
            out.setdefault("mauvais_fou", []).extend([b] + same)
    for n in board.pieces(chess.KNIGHT, color):   # avant-poste : soutenu par un pion, aucun pion adverse ne peut le chasser
        f, r = chess.square_file(n), _rel_rank(n, color)
        if (3 <= r <= 5 and board.attackers(color, n) & pawns
                and not any(abs(chess.square_file(p) - f) == 1 and _rel_rank(p, color) > r for p in their_pawns)):
            out.setdefault("avant_poste", []).append(n)
    return out


def position_features(board):
    """Éléments de la position pour chaque camp : {"w": {élément: [cases]}, "b": {...}, "mob": [Blancs, Noirs],
    "mat": [Blancs, Noirs]} (mobilité = cases accessibles aux pièces, matériel en points)."""
    endgame = phase_of(board) == "finale"
    mob = {c: mobility(board, c) for c in chess.COLORS}
    out = {"mob": [mob[chess.WHITE], mob[chess.BLACK]],
           "mat": [sum(len(board.pieces(pt, c)) * v for pt, v in VALUE.items()) for c in (chess.WHITE, chess.BLACK)]}
    for c, key in ((chess.WHITE, "w"), (chess.BLACK, "b")):
        f = {k: v for k, v in pawn_structure(board, c).items() if v}
        hanging = hanging_pieces(board, c)
        if hanging:
            f["en_prise"] = hanging
        f.update(king_features(board, c, endgame))
        f.update(piece_features(board, c))
        if mob[c] >= MOBILITY_RATIO * mob[not c] and mob[c] - mob[not c] >= MOBILITY_GAP:
            f["mobilite"] = [s for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN) for s in board.pieces(pt, c)]
        out[key] = {k: [chess.square_name(s) for s in v] for k, v in f.items()}
    return out


def position_context(board, color):
    """Éléments de la position vus du camp color : « moi_<élément> » pour les siens, « adv_<élément> » pour l'adversaire."""
    f = position_features(board)
    me, opp = ("w", "b") if color == chess.WHITE else ("b", "w")
    return ["moi_" + k for k in f[me]] + ["adv_" + k for k in f[opp]]


def study_positions(row, pgn, analysis):
    """Positions calmes où le joueur a le trait, pour les exercices d'étude : au plus une en milieu de partie et une
    en finale, celle qui présente le plus d'éléments. Calme : pas d'échec, le coup précédent n'est pas une prise
    (pas de reprise en attente), le meilleur coup n'en est pas une, et l'évaluation reste stable pendant les
    STUDY_STABLE_PLIES demi-coups suivants : elle vient alors de la structure et des pièces, pas d'une tactique.
    Position pas encore décidée."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    me = chess.WHITE if row["couleur"] == "Blancs" else chess.BLACK
    evals, best = analysis["e"], analysis["b"]
    chosen = {}
    board = game.board()
    prev_capture = False
    for ply, node in enumerate(game.mainline()):
        move = node.move
        if (board.ply() >= STUDY_START_PLY and board.turn == me and ply + STUDY_STABLE_PLIES < len(evals)
                and abs(evals[ply]) <= STUDY_MAX_EVAL and not prev_capture and not board.is_check()
                and all(abs(win_pct(evals[ply + k]) - win_pct(evals[ply])) <= STUDY_STABLE_WIN for k in range(1, STUDY_STABLE_PLIES + 1))):
            bm = chess.Move.from_uci(best[ply]) if ply < len(best) and best[ply] else None
            ph = phase_of(board)
            if bm and bm in board.legal_moves and not board.is_capture(bm) and ph != "ouverture":
                feats = position_features(board)
                n = sum(len(feats[k]) for k in ("w", "b"))
                if n >= STUDY_MIN_FEATURES and n > chosen.get(ph, {}).get("_n", 0):
                    chosen[ph] = {"_n": n, "ply": ply, "fen": board.fen(), "e": evals[ply], "ph": ph, "best": board.san(bm), "jo": board.san(move),
                                  "n": f"{board.fullmove_number}{'.' if board.turn == chess.WHITE else '...'}", "f": feats}
        prev_capture = board.is_capture(move)
        board.push(move)
    return [{k: v for k, v in s.items() if k != "_n"} for s in chosen.values()]


def game_metrics(row, pgn, analysis):
    """Renvoie (métriques de la partie, liste des moments critiques) du point de vue du joueur."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    me = chess.WHITE if row["couleur"] == "Blancs" else chess.BLACK
    sign = 1 if me == chess.WHITE else -1
    evals = [sign * e for e in analysis["e"]]
    best = analysis["b"]
    base, inc = base_seconds(row["time_control"]), increment_seconds(row["time_control"])
    zeitnot_limit = max(15, base * 0.10) if base else None
    budget = base + 40 * inc if base else None

    phases = ("ouverture", "milieu", "finale")
    # acc : somme des précisions des coups de la phase (la moyenne se calcule sur l'ensemble des parties)
    stats = {p: {"coups": 0, "imp": 0, "err": 0, "gaf": 0, "acc": 0.0} for p in phases}
    endgame = None
    # coups joués et erreurs (erreurs + gaffes) selon le temps de réflexion (TIME_BUCKETS)
    times = {"coups": [0] * (len(TIME_BUCKETS) + 1), "err": [0] * (len(TIME_BUCKETS) + 1)}
    cpl, accs, moments = [], [], []
    # contexte : éléments de la position (« moi_… » / « adv_… ») à chacun de tes coups hors ouverture, et à tes erreurs
    context = {"coups": {}, "err": {}}
    zeit_err = missed_opp = missed_mate = own_moves = 0
    decisive = time_used = None
    prev_clock = base
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
            s["acc"] += accs[-1]
            ft = endgame_type(board) if ph == "finale" else None
            if ft and endgame is None:   # première finale atteinte : son type et tes chances de gain à l'entrée
                endgame = {"type": ft, "w": round(wb)}
            clock = node.clock()
            zeit = bool(zeitnot_limit and clock is not None and clock < zeitnot_limit)
            own_moves += 1
            spent = None
            if budget and clock is not None and prev_clock is not None:
                spent = max(0.0, prev_clock - clock + inc)
                if own_moves == TIME_CHECK_MOVE:
                    time_used = round(100 * max(0.0, min(1.0, 1 - clock / base)))
            prev_clock = clock
            # occasion manquée : l'adversaire vient de faire une grosse erreur et on ne la punit pas
            opp_gift = ply > 0 and wb - win_pct(evals[ply - 1]) >= MISTAKE
            mate_missed = before >= MATE - 3 and after < MATE - 50
            sev = "gaf" if loss >= BLUNDER else "err" if loss >= MISTAKE else "imp" if loss >= INACCURACY else ""
            if sev:
                s[sev] += 1
            bucket = None
            if spent is not None:
                bucket = sum(spent >= budget * t for t in TIME_BUCKETS)
                times["coups"][bucket] += 1
                times["err"][bucket] += sev in ("err", "gaf")
            ctx = position_context(board, me) if ph != "ouverture" else []
            for k in ctx:
                context["coups"][k] = context["coups"].get(k, 0) + 1
                if sev in ("err", "gaf"):
                    context["err"][k] = context["err"].get(k, 0) + 1
            if sev in ("err", "gaf"):
                zeit_err += zeit
                missed_opp += opp_gift
            missed_mate += mate_missed
            if sev in ("err", "gaf") or mate_missed:
                best_san = ""
                if best[ply]:
                    try: best_san = board.san(chess.Move.from_uci(best[ply]))
                    except ValueError: pass
                # autres coups qui ne perdent pas plus qu'une imprécision par rapport à la position
                alts = []
                for uci, cp in analysis.get("a", {}).get(str(ply), []):
                    if uci != best[ply] and wb - win_pct(sign * cp) < INACCURACY:
                        try: alts.append(board.san(chess.Move.from_uci(uci)))
                        except ValueError: pass
                moments.append({
                    "ply": ply, "n": f"{board.fullmove_number}{'.' if board.turn == chess.WHITE else '...'}",
                    "san": board.san(move), "best": best_san, "fen": board.fen(),
                    "wb": round(wb), "wa": round(wa), "ph": ph, "zt": zeit,
                    "sev": sev or "mat", "occ": bool(opp_gift and sev), "mm": mate_missed,
                    "clk": round(clock) if clock is not None else None, "alts": alts,
                    "t": None if spent is None else round(spent), "tb": bucket, "ft": ft, "ctx": ctx,
                    "mot": motifs(board, move, best[ply], best[ply + 1] if ply + 1 < len(best) else "", before, after),
                })
            if loss >= MISTAKE and (decisive is None or loss > decisive["loss"]):
                decisive = {"loss": round(loss), "ph": ph, "zt": zeit, "ply": ply}
        board.push(move)

    my_wins = [win_pct(e) for i, e in enumerate(evals) if i >= 10]
    opening_eval = evals[OPENING_END_PLY] if len(evals) > OPENING_END_PLY else None
    metrics = {
        "coups": sum(s["coups"] for s in stats.values()),
        "phases": {p: {**s, "acc": round(s["acc"], 1)} for p, s in stats.items()},
        "acpl": round(sum(cpl) / len(cpl), 1) if cpl else None,
        "prec": round(sum(accs) / len(accs), 1) if accs else None,
        "zt_err": zeit_err, "occ": missed_opp, "mm": missed_mate,
        "max_win": round(max(my_wins)) if my_wins else None,
        "min_win": round(min(my_wins)) if my_wins else None,
        "tps": times if budget and sum(times["coups"]) else None,
        "t15": time_used, "finale": endgame, "ctx": context,
        "eval_ouv": None if opening_eval is None else round(max(-1000, min(1000, opening_eval))),
        "decisive": decisive,
    }
    return metrics, moments


def opening_positions(row, pgn, analysis, max_ply=OPENING_PLIES):
    """Positions d'ouverture où le joueur a le trait, pour son répertoire :
    [(coups qui y mènent, meilleur coup, chances de gain avant, coup joué, chances après), ...]."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    me = chess.WHITE if row["couleur"] == "Blancs" else chess.BLACK
    sign = 1 if me == chess.WHITE else -1
    evals, best = analysis["e"], analysis["b"]
    board, sans, out = game.board(), [], []
    for ply, move in enumerate(game.mainline_moves()):
        if ply >= max_ply or ply + 1 >= len(evals):
            break
        san = board.san(move)
        if board.turn == me:
            best_san = ""
            if best[ply]:
                try: best_san = board.san(chess.Move.from_uci(best[ply]))
                except ValueError: pass
            out.append((" ".join(sans), best_san, win_pct(sign * evals[ply]), san, win_pct(sign * evals[ply + 1])))
        sans.append(san)
        board.push(move)
    return out
