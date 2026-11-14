#!/usr/bin/env python3
# Structures de pions : reconnaissance (règles sur les pions seuls) et ce qu'en font les grands maîtres.
# - classify() donne la structure d'une position de milieu de partie, et le camp qui la « possède » (celui qui a le
#   pion isolé, la chaîne avancée, l'attaque de minorité…) ; None pour une structure symétrique ;
# - master_stats() parcourt des parties de maîtres : score, exemples des coups-clés du plan de chaque camp (PLAN_MOVES)
#   dans des parties gagnées, position d'exemple et parties à rejouer. Les coups sont repérés dans un même repère : le
#   camp propriétaire de la structure joue les Blancs (pour une structure symétrique, le camp qui a le trait).
# Le texte des cours est dans templates/js/cours.js ; seules les clés (STRUCTURES) sont partagées.

import io

import chess, chess.pgn

STRUCT_START_PLY = 16   # structures reconnues à partir du 9e coup des Blancs (l'ouverture a posé les pions)
STRUCT_MIN_NPM = 27     # et tant qu'il reste des pièces (au-delà, c'est une finale : d'autres plans)
STRUCT_MIN_PLIES = 8    # une partie « passe par » une structure si elle y reste au moins ce nombre de demi-coups
EXAMPLES = 4            # coups-clés du plan montrés en exemple par camp (une partie de maître gagnée pour chacun)
EXAMPLE_GAMES = 4       # parties de maîtres à rejouer par structure


def _pawns(board, color):
    """Rangées (vues du camp color, 1 = sa première rangée) de ses pions, par colonne (0 = a)."""
    out = [[] for _ in range(8)]
    for sq in board.pieces(chess.PAWN, color):
        r = chess.square_rank(sq)
        out[chess.square_file(sq)].append(r + 1 if color == chess.WHITE else 8 - r)
    return out


def _f(name):
    return "abcdefgh".index(name)


def _at(P, file, rank):
    return rank in P[_f(file)]


def _none(P, *files):
    return not any(P[_f(f)] for f in files)


def _any(P, file):
    return bool(P[_f(file)])


# Structures asymétriques : règle(X = pions du camp propriétaire, Y = pions de l'adversaire), rangées vues de chaque camp.
# Ordre = priorité (la première qui s'applique l'emporte).
ASYMMETRIC = [
    ("pions_pendants", lambda X, Y: _at(X, "d", 4) and (_at(X, "c", 4) or _at(X, "c", 3)) and _none(X, "b", "e") and _none(Y, "c", "d")),
    ("pion_isole", lambda X, Y: _any(X, "d") and _none(X, "c", "e") and _none(Y, "d")),
    ("carlsbad", lambda X, Y: _at(X, "d", 4) and _none(X, "c") and _any(X, "e") and _at(Y, "c", 3) and _at(Y, "d", 4) and _none(Y, "e")),
    ("benoni", lambda X, Y: _at(X, "d", 5) and _none(X, "c") and _at(Y, "c", 4) and _at(Y, "d", 3) and _none(Y, "e")),
    ("chaine_francaise", lambda X, Y: _at(X, "e", 5) and _at(X, "d", 4) and _at(Y, "e", 3) and _at(Y, "d", 4)),
    ("chaine_est_indienne", lambda X, Y: _at(X, "d", 5) and _at(X, "e", 4) and _at(Y, "d", 3) and _at(Y, "e", 4)),
    ("maroczy", lambda X, Y: _at(X, "c", 4) and _at(X, "e", 4) and _none(X, "d") and _none(Y, "c") and (_at(Y, "d", 2) or _at(Y, "d", 3))),
    ("sicilienne", lambda X, Y: _at(X, "e", 4) and _none(X, "d") and not _at(X, "c", 4) and _none(Y, "c") and (_at(Y, "d", 2) or _at(Y, "d", 3))),
    ("stonewall", lambda X, Y: _at(X, "d", 4) and _at(X, "e", 3) and _at(X, "f", 4)),
    ("londres", lambda X, Y: _at(X, "d", 4) and _at(X, "e", 3) and _at(X, "c", 3) and _at(Y, "d", 4)),
]
# Structures symétriques : règle(W, B), la même vue de chaque camp.
SYMMETRIC = [
    ("italienne", lambda W, B: _at(W, "e", 4) and _at(W, "d", 3) and _at(B, "e", 4) and _at(B, "d", 3)),
    ("colonne_d", lambda W, B: _at(W, "e", 4) and _none(W, "d") and _at(B, "e", 4) and _none(B, "d")),
    ("colonne_e", lambda W, B: _at(W, "d", 4) and _none(W, "e") and _at(B, "d", 4) and _none(B, "e")),
    ("centre_ouvert", lambda W, B: _none(W, "d", "e") and _none(B, "d", "e")),
]
STRUCTURES = [k for k, _ in ASYMMETRIC] + [k for k, _ in SYMMETRIC]


def in_scope(board):
    """Milieu de partie où la structure compte : ouverture jouée, pièces encore sur l'échiquier."""
    npm = sum(len(board.pieces(pt, c)) * v for pt, v in ((chess.KNIGHT, 3), (chess.BISHOP, 3), (chess.ROOK, 5), (chess.QUEEN, 9))
              for c in chess.COLORS)
    return board.ply() >= STRUCT_START_PLY and npm >= STRUCT_MIN_NPM


def classify(board):
    """(structure, camp propriétaire ou None si symétrique), ou None si aucune structure connue."""
    W, B = _pawns(board, chess.WHITE), _pawns(board, chess.BLACK)
    for key, rule in ASYMMETRIC:
        if rule(W, B):
            return key, chess.WHITE
        if rule(B, W):
            return key, chess.BLACK
    for key, rule in SYMMETRIC:
        if rule(W, B):
            return key, None
    return None


def role_of(owner, color):
    """Rôle du camp color : « a » (il possède la structure), « c » (il joue contre), « s » (structure symétrique)."""
    return "s" if owner is None else "a" if owner == color else "c"


def flip_of(owner, color):
    """Faut-il retourner l'échiquier (miroir haut/bas) pour que le propriétaire — ou, en symétrique, color — ait les Blancs ?"""
    return (owner if owner is not None else color) == chess.BLACK


def norm_square(sq, flip):
    return chess.square_mirror(sq) if flip else sq


def pawn_move_name(board, move, flip):
    """Coup de pion dans le repère normalisé : « b5 », ou « cxd5 » pour une prise."""
    to = chess.square_name(norm_square(move.to_square, flip))
    return f"{chess.square_name(move.from_square)[0]}x{to}" if board.is_capture(move) else to


def structure_at(board):
    """Structure de la position si elle est dans le champ (milieu de partie), sinon None."""
    return classify(board) if in_scope(board) else None


def _score(result, color):
    if result == "1/2-1/2":
        return 0.5
    return 1.0 if (result == "1-0") == (color == chess.WHITE) else 0.0


# Coups-clés du plan de chaque camp (ceux du texte des cours, templates/js/cours.js), dans le repère normalisé : le
# propriétaire joue les Blancs, l'adversaire les Noirs ; en symétrique, le camp au trait joue les Blancs.
# « d5 » = un pion arrive en d5 (poussée ou prise) ; « Nd5 » = un cavalier arrive en d5 (N, B, R, Q).
PLAN_MOVES = {
    "pions_pendants": {"a": ("d5", "c5"), "c": ("b5", "e5")},
    "pion_isole": {"a": ("d5", "Ne5"), "c": ("Nd5",)},
    "carlsbad": {"a": ("b4", "b5", "e4"), "c": ("Ne4", "c5", "a5")},
    "benoni": {"a": ("e5", "a4"), "c": ("b5", "c4")},
    "chaine_francaise": {"a": ("f4", "f5"), "c": ("c5", "f6")},
    "chaine_est_indienne": {"a": ("c5", "b4"), "c": ("f5", "f4", "g5")},
    "maroczy": {"a": ("Nd5", "f3"), "c": ("b5", "d5")},
    "sicilienne": {"a": ("Nd5", "f4", "f5", "g4", "g5"), "c": ("d5", "b5", "b4")},
    "stonewall": {"a": ("Ne5",), "c": ("Ne4", "c5", "f6")},
    "londres": {"a": ("Ne5", "e4", "f4"), "c": ("c5", "Qb6", "c4", "e5")},
    "italienne": {"s": ("d4", "f4", "Ng3", "a4")},
    "colonne_d": {"s": ("Rd1", "Nd5", "f4")},
    "colonne_e": {"s": ("Re1", "Ne5", "c4")},
    "centre_ouvert": {"s": ("Rd1", "Re1", "Nd5", "Ne5")},
}
LETTERS = {chess.KNIGHT: "N", chess.BISHOP: "B", chess.ROOK: "R", chess.QUEEN: "Q"}


def plan_move_name(board, move, flip):
    """Nom d'un coup dans le repère normalisé, comme dans PLAN_MOVES : case d'arrivée (pion) ou lettre + case."""
    to = chess.square_name(norm_square(move.to_square, flip))
    return LETTERS.get(board.piece_type_at(move.from_square), "") + to if board.piece_type_at(move.from_square) != chess.KING else ""



def master_stats(games):
    """Statistiques par structure sur des parties de maîtres [{m: coups UCI, r: résultat, …}] :
    {structure: {n, pos, score (du propriétaire, %), roles: {a|c|s: {n, ex: [exemples]}}, ex: FEN d'exemple normalisée}}
    et, par structure, les parties les plus longues dans la structure (index, 1er demi-coup, camp, longueur).
    Exemples d'un rôle : les coups-clés du plan (PLAN_MOVES), les plus joués d'abord, chacun illustré par une partie que
    ce camp a gagnée — {i: index de la partie, fen: position avant le coup (vraie partie, non normalisée), uci, san,
    c: camp qui joue} ; au plus EXAMPLES par rôle, de parties différentes."""
    acc = {}
    for gi, g in enumerate(games):
        board = chess.Board()
        seen = {}   # structure -> {plies, first, owner, leviers: {rôle: {nom: (fen, uci, san, camp)}}, pos: {rôle: n}, ex}
        try:
            moves = [chess.Move.from_uci(u) for u in g["m"].split()]
        except ValueError:
            continue
        for ply, move in enumerate(moves):
            if move not in board.legal_moves:
                break
            s = structure_at(board)
            if s:
                key, owner = s
                e = seen.setdefault(key, {"plies": 0, "first": ply, "owner": owner, "leviers": {}, "pos": {}, "ex": None})
                mover = board.turn
                role, flip = role_of(owner, mover), flip_of(owner, mover)
                e["plies"] += 1
                e["pos"][role] = e["pos"].get(role, 0) + 1
                name = plan_move_name(board, move, flip)
                if name in PLAN_MOVES.get(key, {}).get(role, ()):
                    # coup-clé du plan, repéré dans le repère normalisé (le même, que le camp ait les Blancs ou les Noirs)
                    e["leviers"].setdefault(role, {}).setdefault(name, (board.fen(), move.uci(), board.san(move), mover))
                if e["plies"] == 6 and e["ex"] is None:   # position d'exemple : la structure est installée depuis quelques coups
                    b = board.mirror() if owner == chess.BLACK else board.copy()
                    e["ex"] = b.fen()
            board.push(move)
        for key, e in seen.items():
            if e["plies"] < STRUCT_MIN_PLIES:
                continue
            a = acc.setdefault(key, {"n": 0, "pos": 0, "score": 0.0, "roles": {}, "ex": [], "games": []})
            a["n"] += 1
            a["pos"] += e["plies"]
            owner = e["owner"]
            a["score"] += _score(g.get("r"), owner if owner is not None else chess.WHITE)
            for role in e["pos"]:
                r = a["roles"].setdefault(role, {"n": 0, "freq": {}, "won": {}})
                r["n"] += 1
                for name, (fen, uci, san, mover) in e["leviers"].get(role, {}).items():
                    r["freq"][name] = r["freq"].get(name, 0) + 1
                    if _score(g.get("r"), mover) == 1:
                        r["won"].setdefault(name, []).append({"i": gi, "fen": fen, "uci": uci, "san": san,
                                                              "c": "w" if mover == chess.WHITE else "b"})
            if e["ex"]:
                a["ex"].append((e["plies"], e["ex"]))
            a["games"].append({"i": gi, "first": e["first"], "owner": owner, "plies": e["plies"]})
    out, picks = {}, {}
    for key, a in acc.items():
        roles = {}
        for role, r in a["roles"].items():
            examples, used = [], set()
            for name in sorted(r["won"], key=lambda x: -r["freq"][x]):
                ex = next((x for x in r["won"][name] if x["i"] not in used), None)
                if ex and len(examples) < EXAMPLES:
                    examples.append(ex)
                    used.add(ex["i"])
            roles[role] = {"n": r["n"], "ex": examples}
        # position d'exemple : une des plus longues (structure stable), pas un cas extrême
        ex = sorted(a["ex"], key=lambda x: -x[0])
        out[key] = {"n": a["n"], "pos": a["pos"], "score": round(100 * a["score"] / a["n"]), "roles": roles,
                    "ex": ex[len(ex) // 4][1] if ex else None}
        picks[key] = sorted(a["games"], key=lambda x: -x["plies"])
    return out, picks
