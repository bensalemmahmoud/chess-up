"""Structures de pions : reconnaissance, repère normalisé, statistiques des parties de maîtres."""
import sys
import unittest
from pathlib import Path

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import chess_structures as cs

# Défense Tarrasch : les Noirs ont le pion dame isolé à partir du 18e demi-coup (9...cxd4 10.Nxd4)
TARRASCH = ("d4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O Bg5 cxd4 Nxd4 h6 Be3 Re8 Rc1 Bf8 "
            "a3 a6 Qa4 Bd7 Qb3 Na5 Qd1 Nc4").split()


def pawns_only(white, black, turn="w", fullmove=20):
    """Position avec les rois, deux tours chacun (milieu de partie) et ces pions."""
    board = chess.Board(None)
    board.set_piece_at(chess.E1, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.E8, chess.Piece(chess.KING, chess.BLACK))
    for sq in ("a1", "h1"):
        board.set_piece_at(chess.parse_square(sq), chess.Piece(chess.ROOK, chess.WHITE))
    for sq in ("a8", "h8"):
        board.set_piece_at(chess.parse_square(sq), chess.Piece(chess.ROOK, chess.BLACK))
    for color, squares in ((chess.WHITE, white), (chess.BLACK, black)):
        for sq in squares.split():
            board.set_piece_at(chess.parse_square(sq), chess.Piece(chess.PAWN, color))
    board.turn = turn == "w"
    board.fullmove_number = fullmove
    return board


class Classify(unittest.TestCase):
    def test_structures(self):
        cases = [
            ("a2 b2 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7", ("pion_isole", chess.WHITE)),
            ("a2 c4 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7", ("pions_pendants", chess.WHITE)),
            ("a2 b2 d4 e3 f2 g2 h2", "a7 b7 c6 d5 f7 g7 h7", ("carlsbad", chess.WHITE)),
            ("a2 b2 c3 d4 e5 f2 g2 h2", "a7 b7 c5 d5 e6 f7 g7 h7", ("chaine_francaise", chess.WHITE)),
            ("a2 b2 c4 d5 e4 f2 g2 h2", "a7 b7 c7 d6 e5 f7 g7 h7", ("chaine_est_indienne", chess.WHITE)),
            ("a2 b2 c4 e4 f2 g2 h2", "a7 b7 d6 e7 f7 g7 h7", ("maroczy", chess.WHITE)),
            ("a2 b2 c2 e4 f2 g2 h2", "a7 b7 d6 e6 f7 g7 h7", ("sicilienne", chess.WHITE)),
            ("a2 b2 c3 d4 e3 f4 g2 h2", "a7 b7 c6 d5 e6 f7 g7 h7", ("stonewall", chess.WHITE)),
            ("a2 b2 c3 d4 e3 f2 g2 h2", "a7 b7 c6 d5 e6 f7 g7 h7", ("londres", chess.WHITE)),
            ("a2 b2 c3 d3 e4 f2 g2 h2", "a7 b7 c7 d6 e5 f7 g7 h7", ("italienne", None)),
            ("a2 b2 c2 e4 f2 g2 h2", "a7 b7 c7 e5 f7 g7 h7", ("colonne_d", None)),
            ("a2 b2 c2 d4 f2 g2 h2", "a7 b7 c7 d5 f7 g7 h7", ("colonne_e", None)),
            ("a2 b2 c2 f2 g2 h2", "a7 b7 c7 f7 g7 h7", ("centre_ouvert", None)),
        ]
        for white, black, expected in cases:
            with self.subTest(expected[0]):
                self.assertEqual(cs.classify(pawns_only(white, black)), expected)

    def test_mirror_gives_black_owner(self):
        board = pawns_only("a2 b2 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7").mirror()
        self.assertEqual(cs.classify(board), ("pion_isole", chess.BLACK))

    def test_scope(self):
        self.assertIsNone(cs.structure_at(pawns_only("a2 b2 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7", fullmove=5)))
        self.assertIsNone(cs.structure_at(chess.Board()))   # position de départ : ouverture

    def test_roles_and_normalised_moves(self):
        self.assertEqual(cs.role_of(chess.BLACK, chess.BLACK), "a")
        self.assertEqual(cs.role_of(chess.BLACK, chess.WHITE), "c")
        self.assertEqual(cs.role_of(None, chess.WHITE), "s")
        board = chess.Board("4k3/pp3ppp/8/3p4/8/8/PP3PPP/4K3 b - - 0 20")
        # propriétaire noir : le repère est retourné, a6 des Noirs devient a3
        self.assertEqual(cs.pawn_move_name(board, chess.Move.from_uci("a7a6"), cs.flip_of(chess.BLACK, chess.BLACK)), "a3")


class MasterStats(unittest.TestCase):
    def test_tarrasch(self):
        board, moves = chess.Board(), []
        for san in TARRASCH:
            moves.append(board.push_san(san).uci())
        stats, picks = cs.master_stats([{"m": " ".join(moves), "r": "0-1"}])
        iqp = stats["pion_isole"]
        self.assertEqual(iqp["n"], 1)
        self.assertEqual(iqp["score"], 100)   # le propriétaire (les Noirs) a gagné
        self.assertIn(["a3", 100, False], iqp["roles"]["a"]["pions"])   # 13...a6 des Noirs, vu dans le repère normalisé
        self.assertIn(["a6", 100, False], iqp["roles"]["c"]["pions"])   # 13.a3 des Blancs, l'adversaire joue en haut
        self.assertIn(["d5", 100], iqp["roles"]["c"]["cases"]["N"])     # 10.Nxd4 : le cavalier blanc vient bloquer (repère normalisé)
        self.assertEqual(cs.classify(chess.Board(iqp["ex"])), ("pion_isole", chess.WHITE))   # exemple normalisé
        self.assertEqual(picks["pion_isole"][0]["first"], 18)


if __name__ == "__main__":
    unittest.main()
