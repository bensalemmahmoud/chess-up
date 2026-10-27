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


    def test_accuracy_per_phase(self):
        metrics, _ = ca.game_metrics(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS)
        ouv = metrics["phases"]["ouverture"]
        self.assertEqual(ouv["coups"], 3)
        self.assertLess(ouv["acc"] / ouv["coups"], 70)    # la gaffe Nf6 fait chuter la moyenne
        self.assertGreater(ouv["acc"], 2 * 99)            # e5 et Nc6 sont parfaits

    def test_first_endgame_reached(self):
        pgn = '[FEN "4k3/8/8/8/8/8/4P3/R3K3 w - - 0 40"]\n\n40. Ra8+ Kd7 41. Ra7+ *'
        analysis = {"v": ca.CACHE_VERSION, "d": 14, "e": [300, 310, 320, 330], "b": ["a1a8", "e8d7", "a8a7", ""]}
        metrics, _ = ca.game_metrics(row("Blancs"), pgn, analysis)
        self.assertEqual(metrics["finale"], {"type": "tours", "w": round(ca.win_pct(300))})


class EndgameTypes(unittest.TestCase):
    def test_types(self):
        self.assertEqual(ca.endgame_type(chess.Board("4k3/p7/8/8/8/8/P7/4K3 w - - 0 1")), "pions")
        self.assertEqual(ca.endgame_type(chess.Board("r3k3/8/8/8/8/8/8/R3K3 w - - 0 1")), "tours")
        self.assertEqual(ca.endgame_type(chess.Board("2b1k3/8/8/8/8/8/8/1N2K3 w - - 0 1")), "mineures")
        self.assertEqual(ca.endgame_type(chess.Board("2b1k3/8/8/8/8/8/8/R3K3 w - - 0 1")), "tours_mineures")
        self.assertEqual(ca.endgame_type(chess.Board("3qk3/8/8/8/8/8/8/R3K3 w - - 0 1")), "dames_pieces")


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


class PositionFeatures(unittest.TestCase):
    def feats(self, fen):
        return ca.position_features(chess.Board(fen))

    def test_isolated_pawn_against_an_outpost(self):
        f = self.feats("r2q1rk1/1b3ppp/p3pn2/1p1n4/3P4/P1NB1N2/1P3PPP/R2Q1RK1 w - - 0 15")
        self.assertEqual(f["w"]["isoles"], ["d4"])
        self.assertEqual(f["b"]["avant_poste"], ["d5"])
        self.assertNotIn("passes", f["w"])   # le pion e6 surveille sa route

    def test_doubled_and_passed_pawns(self):
        f = self.feats("4k3/p7/8/8/8/2P5/2P5/4K3 w - - 0 1")
        self.assertEqual(sorted(f["w"]["doubles"]), ["c2", "c3"])
        self.assertEqual(sorted(f["w"]["passes"]), ["c2", "c3"])
        self.assertEqual(f["b"]["passes"], ["a7"])

    def test_backward_pawn_open_file_and_hanging_rooks(self):
        f = self.feats("2r3k1/p4ppp/1p2p3/3nP3/3P4/P4N2/1P3PPP/2R3K1 b - - 0 25")
        self.assertEqual(f["w"]["arrieres"], ["d4"])
        self.assertEqual(f["w"]["colonne"], ["c1"])
        self.assertEqual(f["b"]["en_prise"], ["c8"])   # face à face sur la colonne, sans défenseur

    def test_piece_attacked_by_a_pawn(self):
        self.assertEqual(self.feats("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1")["b"]["en_prise"], ["d5"])

    def test_pinned_defender_does_not_defend(self):
        # le cavalier e5, attaqué par la tour e1, n'est défendu que par la dame d6, clouée sur la colonne d
        self.assertEqual(self.feats("3k4/8/3q4/4n3/8/8/8/3RRK2 w - - 0 1")["b"].get("en_prise"), ["e5", "d6"])   # et la dame clouée
        self.assertNotIn("en_prise", self.feats("3k4/8/3q4/4n3/8/8/8/R3RK2 w - - 0 1")["b"])

    def test_isolated_rook_pawn_is_ignored(self):
        self.assertNotIn("isoles", self.feats("4k3/8/8/8/8/8/P7/4K3 w - - 0 1")["w"])

    def test_context_from_the_players_side(self):
        board = chess.Board("r2q1rk1/1b3ppp/p3pn2/1p1n4/3P4/P1NB1N2/1P3PPP/R2Q1RK1 w - - 0 15")
        self.assertEqual(sorted(ca.position_context(board, chess.WHITE)), ["adv_avant_poste", "moi_isoles"])
        self.assertEqual(sorted(ca.position_context(board, chess.BLACK)), ["adv_isoles", "moi_avant_poste"])

    def test_king_safety(self):
        f = self.feats("rn1q1rk1/5p2/8/8/8/8/5PPP/RN1Q1RK1 w - - 0 25")
        self.assertIn("roi_ouvert", f["b"])
        self.assertNotIn("roi_ouvert", f["w"])
        f = self.feats("r2qk2r/ppp2ppp/8/8/8/8/PPP2PPP/R2QK2R w KQkq - 0 15")
        self.assertEqual(f["w"]["roi_centre"], ["e1"])
        self.assertEqual(f["b"]["roi_centre"], ["e8"])

    def test_active_king_and_bishop_pair_in_the_endgame(self):
        f = self.feats("4k3/8/8/8/4K3/8/8/2B2B2 w - - 0 40")
        self.assertEqual(f["w"]["roi_actif"], ["e4"])
        self.assertEqual(sorted(f["w"]["paire_fous"]), ["c1", "f1"])
        self.assertNotIn("roi_actif", f["b"])


class StudyPositions(unittest.TestCase):
    # Pion isolé d4 contre cavalier en avant-poste d5 : 15. Qe2 Rc8 16. Rfd1 Qb6 17. Rac1 Rfd8 18. h3 h6
    PGN = '[FEN "r2q1rk1/1b3ppp/p3pn2/1p1n4/3P4/P1NB1N2/1P3PPP/R2Q1RK1 w - - 0 15"]\n\n15. Qe2 Rc8 16. Rfd1 Qb6 17. Rac1 Rfd8 18. h3 h6 *'
    BEST = ["d1e2", "a8c8", "f1d1", "d8b6", "a1c1", "f8d8", "h2h3", "h7h6", ""]

    def study(self, evals, best=BEST, color="Blancs"):
        return ca.study_positions(row(color), self.PGN, {"v": ca.CACHE_VERSION, "d": 14, "e": evals, "b": best})

    def test_one_middlegame_position_for_the_player(self):
        positions = self.study([30] * 9)
        self.assertEqual(len(positions), 1)
        p = positions[0]
        # après 15...Rc8, la tour noire tient la colonne c ouverte : la position la plus riche est retenue
        # (17. Rac1 en a autant, mais la première l'emporte ; 18. h3 n'a pas assez de suite pour juger le calme)
        self.assertEqual((p["ply"], p["best"], p["ph"], p["n"]), (2, "Rfd1", "milieu", "16."))
        self.assertEqual(p["f"]["w"]["isoles"], ["d4"])
        self.assertEqual(p["f"]["b"]["colonne"], ["c8"])

    def test_capture_as_best_move_is_not_calm(self):
        best = self.BEST[:2] + ["c3d5"] + self.BEST[3:4] + ["c3d5"] + self.BEST[5:]
        self.assertEqual([p["ply"] for p in self.study([30] * 9, best)], [0])

    def test_unstable_evaluation_is_not_calm(self):
        # l'évaluation s'effondre deux demi-coups après la position 2 et la position 4 : une tactique s'y cachait
        self.assertEqual(self.study([30, 30, 30, 30, -600, -600, -600, -600, -600]), [])
        self.assertEqual([p["ply"] for p in self.study([30, 30, 30, 30, 30, 30, 30, 30, -300])], [2])

    def test_error_context(self):
        # 16. Rfd1 fait chuter l'évaluation : une erreur commise avec un pion isolé, face à un avant-poste
        analysis = {"v": ca.CACHE_VERSION, "d": 14, "e": [30, 30, 30, -300, -300, -300, -300, -300, -300], "b": self.BEST}
        metrics, moments = ca.game_metrics(row("Blancs"), self.PGN, analysis)
        self.assertEqual(metrics["ctx"]["coups"]["moi_isoles"], 4)
        self.assertEqual(metrics["ctx"]["err"], {"moi_isoles": 1, "adv_avant_poste": 1, "adv_colonne": 1})
        self.assertEqual(sorted(moments[0]["ctx"]), ["adv_avant_poste", "adv_colonne", "moi_isoles"])

    def test_decided_positions_are_skipped(self):
        self.assertEqual(self.study([900] * 9), [])

    def test_too_early_in_the_game(self):
        self.assertEqual(ca.study_positions(row("Noirs"), SCHOLAR_PGN, SCHOLAR_ANALYSIS), [])


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
