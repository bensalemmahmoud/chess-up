"""Tests du dashboard dans un vrai navigateur (Edge ou Chrome sans fenêtre), pilotés par tests/navigateur.mjs.

La page est assemblée par le générateur à partir de données synthétiques (aucun vrai pseudo ni lien de partie).
Il faut Node 22 ou plus (WebSocket intégré) et Edge, Chrome ou Chromium ; sinon le test est ignoré. Variables :
NAVIGATEUR (chemin du navigateur), SANS_MOTEUR=1 (saute les scénarios qui chargent Stockfish depuis le CDN).
La page charge chess.js, Chart.js et Stockfish depuis des CDN : il faut une connexion internet.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import chess_analysis
import chess_dashboard_generator as gen

ROOT = Path(__file__).resolve().parent

SF = {"coups": 40, "phases": {"ouverture": {"coups": 10, "imp": 1, "err": 0, "gaf": 0, "acc": 900.0},
                              "milieu": {"coups": 20, "imp": 1, "err": 1, "gaf": 1, "acc": 1700.0},
                              "finale": {"coups": 10, "imp": 0, "err": 0, "gaf": 0, "acc": 950.0}},
      "acpl": 40.0, "prec": 88.0, "zt_err": 0, "occ": 1, "mm": 0, "max_win": 90, "min_win": 30,
      "tps": {"coups": [20, 10, 6, 4], "err": [1, 1, 0, 0]}, "t15": 20, "finale": {"type": "tours", "w": 60},
      "ctx": {"coups": {"moi_mobilite": 10, "adv_isoles": 5}, "err": {"moi_mobilite": 1}}, "eval_ouv": 10, "decisive": None}

# Partie entière pour « Deviner le coup » (une Espagnole fermée), le joueur fort a les Blancs
MASTER = ("e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 "
          "c4 c6 cxb5 axb5 Nc3 Bb7 Bg5 b4 Nb1 h6 Bh4 c5 dxe5 Nxe4 Bxe7 Qxe7 exd6 Qf6 Nbd2 Nxd6").split()


def moment(fen, best, played, g, ply, **extra):
    board = chess.Board(fen)
    board.parse_san(best), board.parse_san(played)   # lève une erreur si la position et les coups ne vont pas ensemble
    return {"ply": ply, "n": f"{board.fullmove_number}{'.' if board.turn else '...'}", "san": played, "best": best, "fen": fen,
            "wb": 90, "wa": 40, "ph": "ouverture", "zt": False, "sev": "gaf", "occ": False, "mm": False, "clk": 300,
            "alts": [], "t": 5, "tb": 1, "ft": None, "ctx": [], "mot": [], "g": g, **extra}


def payload():
    games = []
    for i in range(12):
        games.append({
            "date": f"2026-{6 + i // 4:02d}-{1 + i:02d}", "mois": f"2026-{6 + i // 4:02d}", "cadence": "rapid",
            "couleur": "Blancs" if i % 2 == 0 else "Noirs", "resultat": ["Victoire", "Défaite", "Nulle"][i % 3],
            "elo_joueur": 1500 + 5 * i, "elo_adversaire": 1490 + 3 * i, "adversaire": f"adversaire{i}",
            "precision_joueur_%": "", "precision_adversaire_%": "", "ouverture": "Italian Game", "famille": "Italian Game",
            "variante": "Italian Game", "ECO": "C50", "lien": f"https://exemple.invalid/partie/{i}", "time_control": "600",
            "rated": True, "fin": "resigned", "coups": "e4 e5 Nf3 Nc6 Bc4 Bc5", "ts": 1780000000 + 86400 * i, "sf": SF})
    moments = [   # pas de mat : la partie doit pouvoir continuer contre Stockfish
        moment("r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", "Nxe5", "Nxd4", 0, 6),    # partie 0, Blancs
        moment("r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4", "d5", "Bc5", 1, 7),   # partie 1, Noirs
    ]
    sfen = "2r1kb1r/pp3p1p/4pp2/3p4/2nP4/1PP2N2/P4PPP/RN2K2R b KQk - 0 14"
    etudes = [{"ply": 27, "fen": sfen, "e": -96, "ph": "milieu", "best": "Nd6", "jo": "Nd6", "n": "14...",
               "f": chess_analysis.position_features(chess.Board(sfen)), "g": 1}]
    board, ucis = chess.Board(), []
    for san in MASTER:
        ucis.append(board.push_san(san).uci())
    parties = [{"id": "partie0001", "m": " ".join(ucis), "e": [20] * (len(ucis) + 1), "b": ucis + [""], "c": "w",
                "elo": 2700, "eloa": 2650, "fam": "Ruy Lopez", "res": "Nulle"}]
    objectif = {"cadence": "rapid", "target": 1700, "elo": 1690, "players": 3, "date": "2026-11-01",
                "games": [{"resultat": r, "fin": "resigned", "sf": SF} for r in ("Victoire", "Défaite", "Nulle", "Victoire")]}
    return {"username": "testeur", "generated": "2026-11-13 12:00", "period": "Depuis juin 2026",
            "thresholds": {"imp": chess_analysis.INACCURACY, "err": chess_analysis.MISTAKE, "gaf": chess_analysis.BLUNDER,
                           "win": chess_analysis.WINNING, "tps": chess_analysis.TIME_BUCKETS, "t15": chess_analysis.TIME_CHECK_MOVE},
            "site": "chesscom", "games": games, "moments": moments, "repertoire": {"": {"b": "e4", "w": 52, "m": {"e4": 52}}},
            "objectif": objectif, "etudes": etudes, "parties": parties}


def page():
    data = json.dumps(payload(), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return gen.dashboard_page().replace("__SITE__", "Chess.com").replace("__HOME__", "").replace("__DATA__", data)


def browser():
    if os.environ.get("NAVIGATEUR"):
        return os.environ["NAVIGATEUR"]
    for name in ("msedge", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        if shutil.which(name):
            return shutil.which(name)
    for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe"):
        if Path(p).exists():
            return p
    return None


def node():
    exe = shutil.which("node")
    if not exe:
        return None
    try:
        major = int(subprocess.run([exe, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v").split(".")[0])
    except (OSError, ValueError):
        return None
    return exe if major >= 22 else None


class FixturePayload(unittest.TestCase):
    def test_page_is_complete(self):
        html = page()
        for marker in ("__DATA__", "__SCRIPT__", "__SITE__", "__HOME__"):
            self.assertNotIn(marker, html)
        self.assertNotIn("chess.com/game", html)   # données synthétiques seulement


@unittest.skipUnless(node() and browser(), "Node 22+ et Edge/Chrome nécessaires")
class Dashboard(unittest.TestCase):
    def test_scenarios(self):
        with tempfile.TemporaryDirectory() as tmp:
            html = Path(tmp) / "chess_dashboard.html"
            html.write_text(page(), encoding="utf-8")
            run = subprocess.run([node(), str(ROOT / "navigateur.mjs"), str(html), browser()],
                                 capture_output=True, text=True, encoding="utf-8", timeout=420)
        print(run.stdout, run.stderr, sep="\n", file=sys.stderr)
        self.assertEqual(run.returncode, 0, "scénarios du navigateur en échec (détail ci-dessus)")


if __name__ == "__main__":
    unittest.main()
