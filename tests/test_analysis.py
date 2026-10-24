import sys
import unittest
from pathlib import Path

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import chess_analysis as ca

# Le mat du berger : les Noirs gaffent au 4e coup (4...Nf6) puis sont mats.
SCHOLAR_PGN = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0"
# Évaluations (point de vue des Blancs) des positions 0 à 7, meilleurs coups de chaque position.
SCHOLAR_ANALYSIS = {
    "v": ca.CACHE_VERSION, "d": 14,
    "e": [30, 30, 30, 30, 40, 50, ca.MATE - 1, ca.MATE],
    "b": ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g7g6", "h5f7", ""],
}


def row(color, tc="600"):
    return {"couleur": color, "time_control": tc}


class WinPct(unittest.TestCase):
    def test_equal_position_is_fifty_percent(self):
        self.assertAlmostEqual(ca.win_pct(0), 50)

    def test_symmetric_and_increasing(self):
        self.assertAlmostEqual(ca.win_pct(300) + ca.win_pct(-300), 100)
        self.assertLess(ca.win_pct(100), ca.win_pct(200))

    def test_mates_are_clamped(self):
        self.assertAlmostEqual(ca.win_pct(ca.MATE), ca.win_pct(1000))


class Phases(unittest.TestCase):
    def test_start_is_opening(self):
        self.assertEqual(ca.phase_of(chess.Board()), "ouverture")

    def test_full_material_after_move_12_is_middlegame(self):
        board = chess.Board()
        board.fullmove_number = 13
        self.assertEqual(ca.phase_of(board), "milieu")

    def test_few_pieces_is_endgame(self):
        self.assertEqual(ca.phase_of(chess.Board("4k3/8/8/8/8/8/4P3/R3K3 w - - 0 40")), "finale")


class BaseSeconds(unittest.TestCase):
    def test_parsing(self):
        self.assertEqual(ca.base_seconds("600+5"), 600)
        self.assertEqual(ca.base_seconds("180"), 180)
        self.assertIsNone(ca.base_seconds("1/86400"))
        self.assertIsNone(ca.base_seconds(""))


class GameMetrics(unittest.TestCase):
    def test_blunder_is_reported_for_the_player_who_made_it(self):
        metrics, moments = ca.game_metrics(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertEqual(metrics["phases"]["ouverture"]["gaf"], 1)
        self.assertEqual(len(moments), 1)
        m = moments[0]
        self.assertEqual((m["ply"], m["san"], m["best"], m["sev"], m["ph"]), (5, "Nf6", "g6", "gaf", "ouverture"))
        self.assertEqual(m["fen"], "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3")

    def test_winner_has_no_mistake(self):
        metrics, moments = ca.game_metrics(row("Blancs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertEqual(moments, [])
        self.assertEqual(sum(p["gaf"] + p["err"] for p in metrics["phases"].values()), 0)
        self.assertIsNone(metrics["max_win"])   # les 10 premiers demi-coups ne comptent pas pour « position gagnante »

    def test_moves_counted_per_side(self):
        metrics, _ = ca.game_metrics(row("Blancs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertEqual(metrics["coups"], 4)

    def test_alternatives_close_to_the_position_are_accepted(self):
        # Évaluations du point de vue des Blancs : Qe7 (-35 pour les Noirs) vaut la position (-50), Nh6 perd tout.
        analysis = {**SCHOLAR_ANALYSIS, "a": {"5": [["g7g6", 40], ["d8e7", 35], ["g8h6", 900]]}}
        _, moments = ca.game_metrics(row("Noirs"), SCHOLAR_PGN, analysis)
        self.assertEqual(moments[0]["alts"], ["Qe7"])   # g6 est déjà le meilleur coup, pas répété

    def test_no_alternatives_without_data(self):
        _, moments = ca.game_metrics(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertEqual(moments[0]["alts"], [])


class OpeningPositions(unittest.TestCase):
    def test_only_the_players_turns(self):
        positions = ca.opening_positions(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertEqual([p[0] for p in positions], ["e4", "e4 e5 Qh5", "e4 e5 Qh5 Nc6 Bc4"])
        key, best, before, played, after = positions[-1]
        self.assertEqual((best, played), ("g6", "Nf6"))
        self.assertGreater(before - after, ca.BLUNDER)   # Nf6 laisse le mat

    def test_limited_to_the_opening(self):
        self.assertEqual(len(ca.opening_positions(row("Blancs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS, max_ply=2)), 1)


class Mistakes(unittest.TestCase):
    def test_threshold(self):
        self.assertTrue(ca.is_mistake(300, -300))
        self.assertFalse(ca.is_mistake(30, 20))

    def test_missed_mate(self):
        self.assertTrue(ca.is_mistake(ca.MATE - 2, 800))


@unittest.skipUnless(ca.find_stockfish(), "Stockfish introuvable")
class EngineAlternatives(unittest.TestCase):
    def test_multipv_only_at_mistakes(self):
        import chess.engine
        engine = chess.engine.SimpleEngine.popen_uci(ca.find_stockfish())
        try:
            alts = ca.analyse_alternatives(engine, SCHOLAR_PGN, SCHOLAR_ANALYSIS, depth=8)
        finally:
            engine.quit()
        self.assertEqual(list(alts), ["5"])
        board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3")
        self.assertTrue(1 <= len(alts["5"]) <= ca.ALTERNATIVES)
        for uci, _ in alts["5"]:
            self.assertIn(chess.Move.from_uci(uci), board.legal_moves)
        self.assertNotIn("g8f6", [u for u, _ in alts["5"]])   # le coup joué, qui perd, n'est pas un bon candidat


if __name__ == "__main__":
    unittest.main()
