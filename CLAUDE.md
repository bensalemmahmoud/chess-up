# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-file Python CLI that downloads a player's public Chess.com or Lichess games, analyses them with Stockfish, and writes a self-contained HTML dashboard plus a CSV export. User-facing text, comments, CLI help, README and data field names are in **French** — keep it that way.

## Commands

```
python -m pip install -r requirements.txt        # requests, chess (python-chess); Python 3.9+
python chess_dashboard_generator.py --user <id>                  # Chess.com, rapid games analysed, last 6 months
python chess_dashboard_generator.py --site lichess --user <id>
python chess_dashboard_generator.py --user <id> --no-analysis    # fast: stats only, reuses cached analyses
python chess_dashboard_generator.py --user <id> --cadences rapid,blitz --since 2026-01 --depth 16 --workers 4 --refresh
python chess_dashboard_generator.py --amis amis.txt --no-analysis   # every player in amis.txt + rapports/index.html
python chess_dashboard_generator.py --amis amis.txt --publier       # encrypted site in site/ (what CI deploys)
python chess_dashboard_generator.py --nouveau-mot-de-passe          # random strong password
```

`--publier` needs the `cryptography` package (imported lazily, only in that mode).

There is no test suite, linter config or build step. To check a change, run the generator (use `--no-analysis` to skip Stockfish when the change doesn't touch engine analysis) and open `rapports/<user>/chess_dashboard.html`.

Stockfish is auto-located (`STOCKFISH_PATH` env var → `stockfish/` dir → `PATH`) and auto-downloaded into `stockfish/` from the official GitHub release if absent.

## Architecture

**`chess_dashboard_generator.py`** — orchestration, data fetching, HTML.
- `run(args)` handles one player: sets the module-global `USERNAME` (lowercased; used by cache path helpers), then fetch → normalize to row dicts → Stockfish analysis → per-game metrics → CSV → HTML, and returns a summary dict. `main()` calls it once, or with `--amis FILE` once per line (each line is parsed with the same argparse parser; global `--no-analysis/--refresh/--workers` are merged in), then `write_index()` writes `rapports/index.html` and copies `web/` (root manifest + icons) into `rapports/`. Each report gets its own `manifest.webmanifest` (`write_manifest()`, start_url = that report) and uses `../icon-*.png`. The dashboard template's `__HOME__` placeholder is the "← Tous les joueurs" link, empty in publish mode.
- Two sources produce the **same row schema** (French keys: `date`, `cadence`, `couleur` = `Blancs`/`Noirs`, `resultat` = `Victoire`/`Nulle`/`Défaite`, `lien`, `time_control`, `rules`, …): `game_row()` for Chess.com and `lichess_row()` for Lichess. Lichess statuses are mapped to Chess.com termination codes (`LICHESS_STATUS`) so the dashboard JS handles one vocabulary. Any new field must be added to both.
- `lien` (game URL) is the unique key everywhere: PGN lookup, analysis cache key, CSV.
- `HTML_TEMPLATE` is one large raw string containing all CSS and JS (Chart.js from jsDelivr). Python injects data by string replacement of `__SITE__` and `__DATA__` (JSON payload with `games`, `moments`, `thresholds`; `</` escaped). All charts, filters, training priorities and the in-browser CSV export are computed client-side in that JS from the payload.
- The dashboard is split into tabs (`<div class="tab" data-tab=…>`: accueil, statistiques, analyse, entrainement, historique), driven by `showTab()` and the URL hash, with the last tab remembered in `localStorage`. The nav is a top bar on desktop and a fixed bottom bar under 900px. Chart.js can't size a chart created in a hidden tab, so `chart()` defers creation (`pendingCharts`) until `showTab()` makes its canvas visible — always create charts through `chart()`.
- The "Entraînement" section is a click-to-move puzzle trainer built on `moments` (FEN before the player's move + Stockfish best move in SAN), using chess.js 0.10.3 from cdnjs for legality. Themed decks are filters over `moments`, defaulting to the player's #1 priority cause. Spaced-repetition progress (Leitner boxes) lives only in the viewer's `localStorage` under `chess-up:entrainement:<username>`, keyed by `lien#ply`, so it survives report regeneration.

**`chess_analysis.py`** — engine work and metrics.
- `analyse_games()` runs one `SimpleEngine` per thread (`ThreadPoolExecutor`, Threads=1, Hash=32), storing per game `{"v": CACHE_VERSION, "d": depth, "e": evals, "b": best moves}`. Evals are centipawns from White's view, mates encoded as `MATE - n`. Cache is saved atomically every 25 games and on exit, so Ctrl+C is resumable. A game is re-analysed only if `CACHE_VERSION` differs or cached depth < requested depth — **bump `CACHE_VERSION` if the stored format or analysis semantics change**.
- `game_metrics()` turns cached evals into player-perspective metrics (win% loss per move, inaccuracy/mistake/blunder by phase, zeitnot, missed opportunities, unconverted winning positions) and "critical moments" (with FEN for Lichess analysis links). Thresholds (`INACCURACY/MISTAKE/BLUNDER/WINNING`, Lichess-equivalent) and phase rules (`OPENING_END_PLY`, endgame material ≤ 26) are module constants and are also passed to the dashboard via `thresholds`. Metrics are recomputed every run, so changing them does not require re-analysis.

## Cache and output layout (all git-ignored)

- `cache/analyses.json` — Stockfish results, **shared across all players and both sites** (a game between two tracked friends is analysed once).
- `cache/parties/<user>/YYYY-MM.json` — Chess.com monthly archives; finished months are reused, the current month is always re-downloaded.
- `cache/parties/lichess_<user>.json` — Lichess games; incremental fetch from the newest cached game minus one day.
- `rapports/<user>/` or `rapports/lichess_<user>/` — `chess_dashboard.html`, `chess_games.csv` (UTF-8 BOM for Excel).
- `ancienne_version/` holds old versions for reference only; don't edit.
- `amis.txt` (player list + passwords), `rapports/` and `site/` are git-ignored. `cache/*` is ignored except `cache/analyses.json`, committed as the seed for CI.

## Publishing and privacy model

Friends must not be able to read each other's reports. `--amis amis.txt --publier` writes `site/` instead of `rapports/`: each report becomes `site/<dir>/index.html`, a lock page holding the gzip-compressed dashboard encrypted with AES-256-GCM (key = PBKDF2-SHA256 of that line's `--mot-de-passe`, 600k iterations, salt derived from the folder name so a key remembered in `localStorage` survives nightly rebuilds). The lock page decrypts with WebCrypto and `document.write`s the dashboard. In publish mode: no CSV, no named index (`write_public_index()` writes a neutral page), lines without a password are skipped, and nothing printed includes a password or game results — GitHub Actions logs are public. Keep these guarantees when changing the generator.

`.github/workflows/rapports.yml` runs nightly (and on push / manual dispatch): writes `amis.txt` from the `AMIS` repository secret and `::add-mask::`s every password, installs Stockfish via apt (`STOCKFISH_PATH=/usr/games/stockfish`), restores `cache/parties` + `cache/analyses.ci.json` from `actions/cache`, merges them into the committed `cache/analyses.json` (higher depth wins), runs `--publier`, and deploys only `site/` to GitHub Pages.
