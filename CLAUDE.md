# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Python CLI that downloads players' public Chess.com or Lichess games, analyses them with Stockfish, and writes a self-contained HTML dashboard (stats, Stockfish analysis, puzzle trainer, opening repertoire, "+200 Elo" objective, opponent preparation) plus a CSV export. It is meant for any player, not one person: every feature must be computed from each player's own data, never tuned to a specific account. User-facing text, comments, CLI help, README and data field names are in **French** — keep it that way.

## Commands

```
python -m pip install -r requirements.txt        # requests, chess (python-chess), cryptography; Python 3.9+
python chess_dashboard_generator.py --user <id>                  # Chess.com, rapid games analysed, last 6 months
python chess_dashboard_generator.py --site lichess --user <id>
python chess_dashboard_generator.py --user <id> --no-analysis    # fast: no Stockfish, no objective resampling, reuses caches
python chess_dashboard_generator.py --user <id> --cadences rapid,blitz --since 2026-01 --depth 16 --workers 4 --refresh
python chess_dashboard_generator.py --amis amis.txt --no-analysis   # every player in amis.txt + rapports/index.html
python chess_dashboard_generator.py --amis amis.txt --publier       # encrypted site in site/ (what CI deploys)
python chess_dashboard_generator.py --nouveau-mot-de-passe          # random strong password

python -m unittest discover -s tests                                # all tests (stdlib unittest, no extra dependency)
python -m unittest tests.test_analysis.GameMetrics                  # one test class
```

The engine test (`EngineAlternatives`) is skipped when Stockfish isn't found. CI runs the tests before generating; a failure blocks publication. For dashboard changes, regenerate with `--no-analysis` and open `rapports/<user>/chess_dashboard.html`. There is no JS test suite: dashboard JS has been checked by driving headless Edge (`--dump-dom` with an injected test script, or the DevTools protocol when real time is needed, e.g. for Stockfish or WebCrypto). Lichess refuses headless user agents, so pass a normal `--user-agent` when testing Lichess calls.

Stockfish is auto-located (`STOCKFISH_PATH` env var → `stockfish/` dir → `PATH`) and auto-downloaded into `stockfish/` from the official GitHub release if absent.

## Architecture

**`chess_dashboard_generator.py`** — orchestration, data fetching, HTML assembly.
- `run(args)` handles one player: sets the module-global `USERNAME` (lowercased; used by cache paths and by `game_row()`/`lichess_row()` to pick the player's side), then fetch → normalize to row dicts → Stockfish analysis → per-game metrics → repertoire → objective → CSV → HTML, and returns a summary dict. `main()` calls it once, or with `--amis FILE` once per line (each line parsed with the same argparse parser; global `--no-analysis/--refresh/--workers` merged in), then `write_index()` (local) or `write_public_index()` (publish).
- Two sources produce the **same row schema** (French keys: `date`, `cadence`, `couleur` = `Blancs`/`Noirs`, `resultat`, `lien`, `time_control`, `rules`, `coups` = first 20 SAN plies, …): `game_row()` for Chess.com and `lichess_row()` for Lichess. Lichess statuses are mapped to Chess.com termination codes (`LICHESS_STATUS`). Any new field must be added to both. `lien` (game URL) is the unique key everywhere.
- `opening_repertoire()` aggregates `chess_analysis.opening_positions()` over analysed games into `{SAN prefix: {b: best, w: win% before, m: {played: win% after}}}` — keyed by move sequence, so transpositions are separate positions.
- `build_objective()` picks the player's most-analysed cadence, target = last Elo + `OBJECTIVE_GAP` (rounded to 50), and samples recent games of players near the target via `sample_objective()`: the player's own opponents at that level, then (snowball) their opponents at that level, up to `OBJECTIVE_PLAYERS` × `OBJECTIVE_GAMES`. It temporarily swaps the global `USERNAME` so rows are seen from the sampled player's side, and restores it. Samples are cached in `cache/objectifs.json` per `site:cadence:target` and refreshed after `OBJECTIVE_MAX_AGE` days (never with `--no-analysis`); their games are analysed with `alternatives=False`.
- Templates live in `templates/` (`dashboard.html`, `verrou.html` lock page, `accueil.html` index), read at runtime by `template()`. `dashboard_page()` inlines the JS modules of `templates/js/` listed in `DASHBOARD_SCRIPTS` into one `<script>` (order matters, `demarrage.js` last), then `__SITE__`, `__HOME__` and `__DATA__` (JSON payload: `site`, `games`, `moments`, `repertoire`, `objectif`, `thresholds`; `</` escaped) are replaced. The report stays a single file.

**Dashboard JS (`templates/js/`)** — everything is computed client-side from the payload; filters (cadence/period/rated) feed every `render*` function via `baseFilter()`.
- `base.js`: shared helpers, KPIs, charts, openings, Stockfish aggregates (`sfAgg()` — also used for the objective sample), priorities, history. Always create charts through `chart()`: a chart in a hidden tab can't be sized, so creation is deferred (`pendingCharts`) until `showTab()` shows it.
- `entrainement.js`: click-to-move puzzle trainer on `moments` (FEN before the player's move, best move SAN, `alts` = other moves losing < `INACCURACY`, accepted too). `boardHTML()` renders any board. Themed decks filter `moments`; the `repertoire` deck comes from `repertoireCards()`. Spaced repetition (Leitner boxes, `t` = last update for sync) lives in the viewer's `localStorage` under `chess-up:entrainement:<username>`, keyed by `lien#ply` (or `rep:<prefix>`). After a card, "Jouer la suite" plays against Stockfish from the position.
- `moteur.js`: Stockfish 10 (asm.js, cdnjs) in a Web Worker started from a Blob (a Worker must be same-origin), loaded lazily; `Engine.move(fen, ms)` returns the best move and a side-to-move score.
- `repertoire.js` (opening explorer over `g.coups` + `D.repertoire`), `objectif.js` (objective table on the home tab, monthly progression chart), `adversaire.js` (fetches an opponent's recent games directly from the Chess.com/Lichess APIs in the browser — both allow CORS), `synchro.js` (cross-device sync: `srs` gzip+base64url in a `#sync=` link, merged by latest `t`), `demarrage.js` (listeners, default cadence = most analysed, tab routing by URL hash).

**`chess_analysis.py`** — engine work and metrics.
- `analyse_games()` runs one `SimpleEngine` per thread, storing per game `{"v": CACHE_VERSION, "d": depth, "e": evals, "b": best moves, "a": alternatives}`. Evals are centipawns from White's view, mates encoded as `MATE - n`. `"a"` holds the top `ALTERNATIVES` moves (MultiPV) only at positions where the side to move made a mistake (`is_mistake()`), for both colours; games cached before `"a"` existed get only that complement. Cache saved atomically every 25 games and on exit (Ctrl+C is resumable). A game is fully re-analysed only if `CACHE_VERSION` differs or cached depth < requested depth — **bump `CACHE_VERSION` if the stored format or analysis semantics change** (that re-analyses everything).
- `game_metrics()` turns cached evals into player-perspective metrics and critical moments; `opening_positions()` gives the player's opening decisions. Thresholds (`INACCURACY/MISTAKE/BLUNDER/WINNING`, Lichess-equivalent) and phase rules are module constants, passed to the dashboard via `thresholds`. Metrics are recomputed every run, so changing them does not require re-analysis.

## Cache and output layout

- `cache/analyses.json` — Stockfish results, shared across all players and both sites. Committed (seed for CI); the rest of `cache/` is git-ignored.
- `cache/parties/…` — downloaded games (Chess.com monthly archives, finished months reused; Lichess incremental). `cache/objectifs.json` — objective samples.
- `rapports/<dir>/` (local) and `site/<dir>/` (publish), `amis.txt` (player list + passwords) — git-ignored. `ancienne_version/` is reference only; don't edit.

## Publishing and privacy model

Friends must not be able to read each other's reports. `--amis amis.txt --publier` writes `site/`: each report becomes `site/<dir>/index.html`, a lock page holding the gzip-compressed dashboard encrypted with AES-256-GCM (key = PBKDF2-SHA256 of that line's `--mot-de-passe`, 600k iterations, salt derived from the folder name so a key remembered in `localStorage` survives nightly rebuilds). The lock page decrypts with WebCrypto and `document.write`s the dashboard. In publish mode: no CSV, no named index, lines without a password are skipped, and nothing printed includes a password, a sampled player's name or game results — GitHub Actions logs are public. Keep these guarantees when changing the generator.

`.github/workflows/rapports.yml` runs nightly (and on push / manual dispatch): writes `amis.txt` from the `AMIS` repository secret and `::add-mask::`s every password, installs Stockfish via apt, runs the tests, restores `cache/parties`, `cache/analyses.ci.json` and `cache/objectifs.json` from `actions/cache`, merges CI analyses into the committed `cache/analyses.json` (higher depth wins), runs `--publier`, and deploys only `site/` to GitHub Pages.
