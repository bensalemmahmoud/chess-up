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


    def test_motif_of_the_blunder(self):
        _, moments = ca.game_metrics(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertEqual(moments[0]["mot"], ["mat_subi"])   # Nf6 permet Qxf7#

    def test_defence_uses_the_lowest_chances(self):
        # 12 demi-coups : seules les positions à partir du 10e comptent (0, puis -200 pour les Noirs)
        pgn = "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. Nf3 Nf6 6. Ng1 Ng8"
        analysis = {"v": ca.CACHE_VERSION, "d": 14, "e": [0] * 11 + [200, 0], "b": [""] * 13}
        metrics, _ = ca.game_metrics(row("Noirs"), pgn, analysis)
        self.assertEqual(metrics["min_win"], round(ca.win_pct(-200)))
        self.assertEqual(metrics["max_win"], 50)

    def test_thinking_time_per_move(self):
        # Les Noirs jouent e5 en 2 s, Nc6 en 28 s et la gaffe Nf6 en 90 s (partie de 10 min).
        pgn = ("1. e4 {[%clk 0:10:00]} e5 {[%clk 0:09:58]} 2. Qh5 {[%clk 0:09:55]} Nc6 {[%clk 0:09:30]} "
               "3. Bc4 {[%clk 0:09:50]} Nf6 {[%clk 0:08:00]} 4. Qxf7# {[%clk 0:09:45]} 1-0")
        metrics, moments = ca.game_metrics(row("Noirs"), pgn, SCHOLAR_ANALYSIS)
        self.assertEqual(metrics["tps"], {"coups": [1, 0, 1, 1], "err": [0, 0, 0, 1]})
        self.assertEqual(moments[0]["t"], 90)
        self.assertIsNone(metrics["t15"])   # partie trop courte

    def test_no_thinking_time_without_clocks(self):
        metrics, moments = ca.game_metrics(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        self.assertIsNone(metrics["tps"])
        self.assertIsNone(moments[0]["t"])


class Motifs(unittest.TestCase):
    def test_fork(self):
        board = chess.Board("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1")
        self.assertTrue(ca.is_fork(board, chess.Move.from_uci("b5c7")))    # roi et tour
        self.assertFalse(ca.is_fork(board, chess.Move.from_uci("b5d6")))   # le roi seul

    def test_fork_on_a_square_taken_for_free_does_not_count(self):
        board = chess.Board("r3k3/8/1q6/1N6/8/8/8/4K3 w - - 0 1")   # la dame b6 prend le cavalier en c7
        self.assertFalse(ca.is_fork(board, chess.Move.from_uci("b5c7")))
        board = chess.Board("r3k3/8/1q6/1N6/8/8/8/2R1K3 w - - 0 1")   # ... mais pas s'il est défendu par la tour c1
        self.assertTrue(ca.is_fork(board, chess.Move.from_uci("b5c7")))

    def test_material(self):
        self.assertTrue(ca.wins_material(chess.Board("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1"), chess.Move.from_uci("d2d5")))
        self.assertFalse(ca.wins_material(chess.Board("4k3/4p3/3p4/8/8/8/3R4/4K3 w - - 0 1"), chess.Move.from_uci("d2d6")))
        self.assertTrue(ca.wins_material(chess.Board("4k3/8/3p4/8/8/8/3R4/4K3 w - - 0 1"), chess.Move.from_uci("d2d6")))

    def test_pin(self):
        board = chess.Board("4k3/3n4/8/8/8/8/8/4KB2 w - - 0 1")
        self.assertTrue(ca.pins(board, chess.Move.from_uci("f1b5")))
        self.assertFalse(ca.pins(board, chess.Move.from_uci("f1c4")))


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
