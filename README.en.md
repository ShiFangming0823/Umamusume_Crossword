# Tracen Crossword Club

[简体中文](README.md) · **English** · [日本語](README.ja.md)

A randomized browser crossword using Umamusume character names. The frontend uses native HTML, CSS and JavaScript ES modules. JSON stores runners and localized clues; optional anonymous statistics use a Cloudflare Worker and D1 behind a same-origin API.

## Features

- Four collections: Starter, Advanced, Epithets and Cinderella Gray, selected with four separate buttons. Each game samples runners, generates a connected grid, then draws a clue per runner. There is no fixed-level selector.
- Chinese, English and Japanese interface and clues; independently selectable English-letter or katakana answers.
- Large grids have 10 across and 10 down; small grids have 6 each. Desktop and mobile default to large and small respectively, with manual override. Cells can be resized and grids scrolled horizontally. The scrolling viewport stays within the content width, so a wide grid does not expand the page or shrink its text.
- Assisted mode marks correct words and shows trilingual names, with unlimited lookup and answer viewing. Challenge mode hides correctness for unrevealed words, allows three searches and three distinct answer reveals; revealed words are filled, marked green and locked.
- Either mode can end early and reveal the solution. Settings and single-answer help do not pause time. Changing interface language or mode preserves state; applying a different collection, script or size, or generating a new game, resets it.
- Local PNG export supports blank grids, current entries and post-game solutions. Current-language clues, game URL and an offline QR code are included; playing time and status are optional.
- GitHub Issue and email contribution links appear in the game and result dialog.
- Eight collection/size statistics buckets show starts, successful games and mean successful time. Answer scripts are combined; counts represent games, not unique visitors.

## Development

Use Node.js 24. No npm dependency installation is required; the QR encoder is vendored with its MIT license. Run over HTTP in a browser supporting modules, Fetch, Web Workers, Canvas and native dialog.

| Command | Purpose |
| --- | --- |
| npm run dev | Source preview at http://localhost:5173/ |
| npm run check:data | Offline validation of names, official-roster coverage, clues and legacy fixtures |
| npm run audit:roster | Read-only online comparison of official additions, names, categories and voice credits |
| npm test | Rules, generated grids, localization, API and real SQLite regressions |
| npm run benchmark | Measure all 16 collection/script/size combinations |
| npm run build:worker | Generate server candidate pools and legacy compatibility data; commit outputs |
| npm run build | Validate and recreate dist/; tests run separately |
| npm run preview | Serve an existing dist/ build |

PowerShell can use npm.cmd. Both preview commands default to port 5173; use PORT to run them together.

## Architecture

main.js coordinates DOM, input methods, focus, settings and GameSession. game.js contains DOM-free rules, normalization, search, timing, allowances and board validation. catalog.js and clue-bank.js load and validate the JSON bank. clue-policy.js owns clue weights and quotas. generator.js performs bounded randomized restart search; generator-worker.js runs it off the main thread. i18n.js and random-i18n.js provide interface translations. export.js draws printable PNGs with the vendored offline QR encoder.

The generator samples without replacement and checks matching crossings, word boundaries, side adjacency, connectivity and direction quotas. Scoring favors compact grids. Maximum edges are 30 cells for small grids and 40 for large ones. A busy button appears immediately, with delayed loading feedback after 400ms. The checked-in development-machine benchmark completed 800 generations with no failures and group means around 3–20ms; this excludes Worker startup and does not describe mobile performance.

GameSession accepts an injected clock. completed means the session ended; success requires finishReason === 'solved', whereas 'revealed' means early termination. Reloading does not restore the grid. Local storage holds language preference, recent clue IDs and temporary statistics reports.

src/cell-interaction.js handles cell gestures and focus. A click focuses the input synchronously within the user gesture; pointer-down only remembers the earlier selection, so a first crossing tap does not toggle direction. Cancelled drags do not request focus. Touch-first devices avoid asynchronous initial focus, and rendering only writes changed values/read-only states. Desktop focus checks do not replace software-keyboard testing on real phones/tablets.

## Data maintenance

characters.json owns standard trilingual names and aliases. clues.json associates stable character IDs with categorized, sourced, trilingual clue records. As checked on 2026-10-16, The dictionary contains 193 runners. Starter and Advanced each cover 162 official runners: 145 main characters and 17 confirmed supporting Umamusume. The 31 Cinderella originals remain in their dedicated collection and name lookup. The bank has 999 trilingual records, including 819 eligible clues in each ordinary collection. Cinderella Gray now has 46 candidates and 150 story clues, covering Kasamatsu through the manga finale. Ordinary and story clues offer alternatives; epithet clues retain authentic titles, including both game and towel titles when available. Both ordinary collections use the same official roster, with category-scoped clues and different dimension weights. Starter prioritizes profiles, relationships and story; horse-record and music clues have a combined maximum of three per game, for both sizes and scripts. Each Starter runner needs a profile/story fallback. The quota takes precedence over avoiding the previous clue; Advanced has no such cap.

Maintain the reviewed roster.json snapshot alongside the names and clues. Add all zh-CN, en and ja text, a stable clue ID, categories, dimension and sources. New facts include factKey and verifiedAt; current-life clues also require asOf and a visible reference date. Generic traits such as working hard or running well cannot stand alone. Use identifying race years, relationships, titles or specific scenes. Song clues identify the album and solo credit; multiplayer-program clues need an additional distinguishing fact. Review factual accuracy and uniqueness manually: a duplicate-text check cannot establish semantic uniqueness. English answers remove punctuation/spaces and become uppercase; katakana preserves small kana and long-vowel marks. Cinderella Gray originals use their fictional character names rather than real-horse counterparts.

The eight old fixed grids remain historical fixtures and are not loaded during play. After changing bank content, run check:data, build:worker, test and build. Commit worker/pool.generated.js and any changed worker/levels.generated.js; do not hand-edit generated files or commit dist/, credentials or local databases.

For name corrections, edit names and aliases while keeping the stable id; update names mentioned in clue text separately. Removing a runner also requires removing its clues.json record and roster.json references. For Cinderella Gray, update cinderella-roster.json and scene evidence, recording the removal reason. Missing-name errors list affected IDs. Back up the bank as data/clues.json.TIMESTAMP.bak before editing; .bak files under data/ are excluded from Git and release builds.

The reviewed Cinderella identities and deferred entries live in `data/cinderella-roster.json`; per-clue chapter/episode references live in `docs/evidence/cinderella-scenes.json`. Offline checks enforce consistency with the playable bank. The original 22-entry fixed grids remain unchanged. Original characters remain available in Cinderella Gray and trilingual lookup.

## Statistics and upgrades

analytics.js handles reporting, retries and caching. /api/v2/ forwards through the Pages Function STATS binding to a Worker with a DB binding. Starts validate submitted grids and retain only a solution hash; successful finishes verify letters. D1 stores no IP addresses, search text or answer details. Random run IDs deduplicate reports; temporary local outbox data may include the pending board. Statistics failures never prevent play; local previews do not write production statistics by default.

The v0.7.2 bank expansion needs no new D1 migration, but deploy the Worker with its expanded validation pool before the frontend.

For v0.7, apply 0002_random_stats.sql, deploy the Worker, then deploy the frontend. Legacy tables and APIs remain available, and old fixed-grid totals are not mixed with random-puzzle totals. Publishing frontend changes alone is insufficient for this upgrade.

## Further documentation

- [Contributor/agent guide](AGENTS.md)
- [v0.7.2 Cinderella coverage and scene review](docs/灰姑娘题库扩充与核对.md)
- [v0.7.1 coverage and source-review notes](docs/题库扩充与来源核对.md)
- [Random bank, algorithm, export and benchmarking](docs/随机题库与生成算法.md)
- [Benchmark report](docs/generator-benchmark.json)
- [Statistics deployment and maintenance](docs/统计服务部署与维护.md)
- [Legacy format](docs/关卡数据格式.md)
- [Epithet sources](docs/二つ名来源与映射.md) and [Cinderella Gray sources](docs/芦毛灰姑娘题库与来源.md)

Unofficial fan project. Some names and translated epithets are project conventions, not official translations. Source documents contain solutions and story spoilers.
