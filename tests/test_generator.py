import base64
import gzip
import re
import shlex
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import chess_dashboard_generator as gen


class Openings(unittest.TestCase):
    def test_variant_drops_move_numbers(self):
        self.assertEqual(gen.opening_variant("Caro Kann Defense Exchange Variation 3...cxd5 4.Nf3"),
                         "Caro-Kann Defense Exchange Variation")

    def test_family(self):
        self.assertEqual(gen.opening_family("Caro-Kann Defense Exchange Variation"), "Caro-Kann Defense")
        self.assertEqual(gen.opening_family("Kings Gambit Declined Classical Variation"), "Kings Gambit Declined")


class FirstMoves(unittest.TestCase):
    def test_strips_headers_clocks_and_numbers(self):
        pgn = '[Event "Live"]\n[ECOUrl "x"]\n\n1. e4 {[%clk 0:09:58]} 1... c6 {[%clk 0:09:59]} 2. d4 $1 d5 3. e5 Bf5 1-0'
        self.assertEqual(gen.first_moves(pgn), "e4 c6 d4 d5 e5 Bf5")

    def test_variations_and_limit(self):
        self.assertEqual(gen.first_moves("1.e4 e5 2.Nf3 (2.f4 exf4) Nc6 3.Bb5 a6 *", n=4), "e4 e5 Nf3 Nc6")


class Repertoire(unittest.TestCase):
    def test_aggregates_positions_over_games(self):
        from test_analysis import SCHOLAR_ANALYSIS, SCHOLAR_PGN
        rows = [{"lien": f"g{i}", "couleur": "Noirs", "sf": {"coups": 4}} for i in range(2)] + [{"lien": "x", "couleur": "Noirs", "sf": None}]
        pgns = {r["lien"]: SCHOLAR_PGN for r in rows}
        cache = {"g0": SCHOLAR_ANALYSIS, "g1": SCHOLAR_ANALYSIS}
        rep = gen.opening_repertoire(rows, pgns, cache)
        self.assertEqual(set(rep), {"e4", "e4 e5 Qh5", "e4 e5 Qh5 Nc6 Bc4"})
        last = rep["e4 e5 Qh5 Nc6 Bc4"]
        self.assertEqual(last["b"], "g6")
        self.assertEqual(list(last["m"]), ["Nf6"])
        self.assertLess(last["m"]["Nf6"], last["w"])


class ObjectiveSample(unittest.TestCase):
    """Échantillon de l'objectif +200 : adversaires du joueur au bon niveau, complétés par leurs propres adversaires."""

    def setUp(self):
        self.saved = (gen.USERNAME, gen.recent_games_chesscom, gen.time.sleep)
        gen.USERNAME = "me"
        gen.time.sleep = lambda s: None

    def tearDown(self):
        gen.USERNAME, gen.recent_games_chesscom, gen.time.sleep = self.saved

    @staticmethod
    def game(opp, elo, opp_elo):
        return ({"couleur": "Blancs", "rules": "chess", "elo_joueur": elo, "adversaire": opp, "elo_adversaire": opp_elo,
                 "lien": f"{gen.USERNAME}-{opp}", "resultat": "Victoire", "fin": "resigned", "time_control": "600"}, "1. e4 e5")

    def test_snowball(self):
        calls = []
        def fake(name, cadence):
            calls.append((name, gen.USERNAME))
            # chaque joueur a joué contre « ami_de_<nom> », lui aussi au bon niveau
            return [self.game(f"ami_de_{name}", 2040, 2060)]
        gen.recent_games_chesscom = fake
        rows = [{"cadence": "rapid", "adversaire": "fort", "elo_adversaire": 2030},
                {"cadence": "rapid", "adversaire": "faible", "elo_adversaire": 1500},
                {"cadence": "blitz", "adversaire": "autre_cadence", "elo_adversaire": 2050},
                {"cadence": "rapid", "adversaire": "Anonyme", "elo_adversaire": 2050}]
        entry = gen.sample_objective(rows, False, "rapid", 2050)
        names = [n for n, _ in calls]
        self.assertEqual(names[:3], ["fort", "ami_de_fort", "ami_de_ami_de_fort"])
        self.assertNotIn("faible", names)
        self.assertNotIn("autre_cadence", names)
        self.assertTrue(all(user == name.lower() for name, user in calls))   # chaque partie vue du joueur échantillonné
        self.assertEqual(gen.USERNAME, "me")                                  # et le joueur du rapport est restauré
        self.assertEqual(entry["players"], gen.OBJECTIVE_PLAYERS)
        self.assertEqual(entry["elo"], 2040)

    def test_nobody_at_that_level(self):
        gen.recent_games_chesscom = lambda name, cadence: self.fail("aucun joueur ne devrait être interrogé")
        self.assertIsNone(gen.sample_objective([{"cadence": "rapid", "adversaire": "x", "elo_adversaire": 1200}], False, "rapid", 2050))


class StrongerStudies(unittest.TestCase):
    """Positions d'étude de joueurs plus forts : tous les échantillons en cache du même site, au-dessus du joueur."""

    def setUp(self):
        import json, tempfile
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from test_analysis import StudyPositions
        self.saved = gen.OBJECTIVES_CACHE
        game = lambda lien, cadence: {"lien": lien, "cadence": cadence, "couleur": "Blancs", "elo_joueur": 2100,
                                      "famille": "Queen's Gambit", "pgn": StudyPositions.PGN}
        store = {"chesscom:rapid:2100": {"games": [game("r1", "rapid")]},
                 "chesscom:blitz:2600": {"games": [game("b1", "blitz"), game("r1", "rapid")]},   # r1 en double
                 "chesscom:rapid:1500": {"games": [game("faible", "rapid")]},                    # sous le joueur
                 "lichess:rapid:2100": {"games": [game("li", "rapid")]}}                         # autre site
        self.tmp = tempfile.TemporaryDirectory()
        gen.OBJECTIVES_CACHE = Path(self.tmp.name) / "objectifs.json"
        gen.OBJECTIVES_CACHE.write_text(json.dumps(store), encoding="utf-8")
        analysis = {"e": [30] * 9, "b": StudyPositions.BEST}
        self.cache = {lien: analysis for lien in ("r1", "b1", "faible", "li")}

    def tearDown(self):
        gen.OBJECTIVES_CACHE = self.saved
        self.tmp.cleanup()

    def test_samples_above_the_player_on_the_same_site(self):
        rows = [{"cadence": "rapid", "elo_joueur": 1900, "sf": {"coups": 30}}]
        studies = gen.stronger_studies(rows, False, self.cache)
        self.assertEqual([s["cad"] for s in studies], ["rapid", "blitz"])   # l'échantillon le plus proche de l'objectif d'abord
        self.assertTrue(all("lien" not in s and "g" not in s for s in studies))
        self.assertEqual(studies[0]["elo"], 2100)

    def test_nothing_without_analysed_games(self):
        self.assertEqual(gen.stronger_studies([{"cadence": "rapid", "elo_joueur": 1900, "sf": None}], False, self.cache), [])


class ClassicalSample(unittest.TestCase):
    def setUp(self):
        self.saved = (gen.USERNAME, gen.get_json, gen.recent_games_lichess, gen.time.sleep)
        gen.USERNAME = "me"
        gen.time.sleep = lambda s: None

    def tearDown(self):
        gen.USERNAME, gen.get_json, gen.recent_games_lichess, gen.time.sleep = self.saved

    def test_top_players_games_seen_from_their_side(self):
        gen.get_json = lambda url: {"users": [{"username": f"Top{i}"} for i in range(20)]}
        calls = []
        def fake(name, cadence):
            calls.append((name, gen.USERNAME, cadence))
            if name == "Top0":
                raise RuntimeError("compte fermé")
            game = {"couleur": "Blancs", "rules": "chess", "lien": name, "cadence": cadence}
            return [(dict(game, lien=f"{name}-{i}"), "1. e4 e5") for i in range(gen.CLASSICAL_GAMES + 3)]
        gen.recent_games_lichess = fake
        entry = gen.sample_classical()
        self.assertEqual(entry["players"], gen.CLASSICAL_PLAYERS)              # Top0 ignoré, les suivants complètent
        self.assertEqual(len(entry["games"]), gen.CLASSICAL_PLAYERS * gen.CLASSICAL_GAMES)
        self.assertTrue(all(user == name.lower() and cadence == "classical" for name, user, cadence in calls))
        self.assertEqual(gen.USERNAME, "me")


class LichessRow(unittest.TestCase):
    GAME = {
        "id": "abcd1234", "rated": True, "variant": "standard", "speed": "rapid", "status": "resign",
        "createdAt": 1790000000000, "lastMoveAt": 1790000600000, "winner": "black",
        "clock": {"initial": 600, "increment": 5},
        "opening": {"eco": "B12", "name": "Caro-Kann Defense: Advance Variation, Short Variation"},
        "players": {"white": {"user": {"id": "alice", "name": "Alice"}, "rating": 1500},
                    "black": {"user": {"id": "bob", "name": "Bob"}, "rating": 1600}},
    }

    def setUp(self):
        self.saved = gen.USERNAME

    def tearDown(self):
        gen.USERNAME = self.saved

    def test_row_from_the_players_point_of_view(self):
        gen.USERNAME = "bob"
        r = gen.lichess_row(self.GAME)
        self.assertEqual((r["couleur"], r["resultat"], r["adversaire"]), ("Noirs", "Victoire", "Alice"))
        self.assertEqual((r["elo_joueur"], r["elo_adversaire"]), (1600, 1500))
        self.assertEqual((r["time_control"], r["fin"], r["cadence"]), ("600+5", "resigned", "rapid"))
        self.assertEqual((r["famille"], r["variante"]), ("Caro-Kann Defense", "Caro-Kann Defense: Advance Variation"))
        self.assertEqual(r["lien"], "https://lichess.org/abcd1234")
        self.assertEqual(r["ts"], 1790000600)   # fin de la partie, en secondes

    def test_loss_for_the_other_side(self):
        gen.USERNAME = "alice"
        self.assertEqual(gen.lichess_row(self.GAME)["resultat"], "Défaite")


class AmisFile(unittest.TestCase):
    def test_line_options(self):
        line = "--site lichess --user Bob --since 2026-01 --cadences blitz --mot-de-passe abcde-fghij"
        args = gen.build_parser().parse_args(shlex.split(line))
        self.assertEqual((args.site, args.user, args.since, args.cadences, args.password),
                         ("lichess", "Bob", (2026, 1), "blitz", "abcde-fghij"))


class Publishing(unittest.TestCase):
    def test_new_password_format(self):
        pw = gen.new_password()
        self.assertRegex(pw, r"^[a-z2-9]{5}(-[a-z2-9]{5}){3}$")
        self.assertNotRegex(pw, r"[lo01i]")
        self.assertNotEqual(pw, gen.new_password())

    def test_encryption_round_trip(self):
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        except ImportError:
            self.skipTest("cryptography n'est pas installé")
        page = "<html>rapport secret : 1-0 contre Bob</html>"
        locked = gen.encrypt_page(page, "abcde-fghij-kmnpq-rstuv", "bob")
        self.assertNotIn("secret", locked)
        field = lambda k: base64.b64decode(re.search(k + r"='([^']*)'", locked).group(1))
        iterations = int(re.search(r"ITER=(\d+)", locked).group(1))
        import hashlib
        key = hashlib.pbkdf2_hmac("sha256", b"abcde-fghij-kmnpq-rstuv", field("SALT"), iterations)
        clear = AESGCM(key).decrypt(field("IV"), field("CIPHER"), None)
        self.assertEqual(gzip.decompress(clear).decode(), page)

    def test_lock_page_carries_the_build(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest("cryptography n'est pas installé")
        self.assertRegex(gen.BUILD, r"^\d{14}$")
        self.assertIn(f"BUILD='{gen.BUILD}'", gen.encrypt_page("x", "pw", "bob"))

    def test_public_index_publishes_the_version(self):
        import tempfile
        saved = gen.SITE_DIR
        with tempfile.TemporaryDirectory() as tmp:
            gen.SITE_DIR = Path(tmp)
            try:
                gen.write_public_index()
                self.assertEqual((gen.SITE_DIR / "version.txt").read_text(encoding="utf-8"), gen.BUILD)
                self.assertNotIn("__CARDS__", (gen.SITE_DIR / "index.html").read_text(encoding="utf-8"))
            finally:
                gen.SITE_DIR = saved

    def test_salt_is_stable_per_player(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest("cryptography n'est pas installé")
        salt = lambda name: re.search(r"SALT='([^']*)'", gen.encrypt_page("x", "pw", name)).group(1)
        self.assertEqual(salt("bob"), salt("bob"))
        self.assertNotEqual(salt("bob"), salt("alice"))


if __name__ == "__main__":
    unittest.main()
