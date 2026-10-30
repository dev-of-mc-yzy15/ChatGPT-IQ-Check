# Fixtures

Trimmed excerpts of live CodexRadar responses. Original capture 2026-10-23; every fixture re-checked against the live endpoints on 2026-10-31 and re-trimmed to the upstream shape of that day. Trim points are listed below on purpose: a fixture that has drifted from upstream is worse than no fixture, because tests then assert a shape that no longer exists.

Sources, one per file:

- `binding.sample.json` — `https://codexradar.com/data/radar-bench-binding.json`, fetched 2026-10-31. Trimmed to 3 `model_efforts` (`gpt-6-astra` high/low, `gpt-6.1-sol` high) and 1 `members` entry. **`total_tasks` (64), `total_cells` (320) and `source_counts` keep the upstream values** — they describe the whole benchmark, so they are *not* expected to agree with the trimmed `members` array.
- `summary.sample.json` — `https://codexradar.com/api/radar-bench-score?model=gpt-6-astra&effort=high&view=summary&selection=user-selected-v1`, fetched 2026-10-31. Trimmed to 3 of the 10 `history.points` entries; the values, `score`, `coverage`, `graded_runs_count`, `detail_metrics` and every `source_scores` row are upstream values verbatim.
- `round.sample.json` — `https://codexradar.com/degradation-codex-latest.json`, original capture 2026-10-23. Trimmed to 2 `settings` / 2 `round.results` keys / 7 `tasks`; `round.totals` is trimmed to those same two keys.

Fields kept although they look redundant, and why:

- `round.sample.json` `judge.criteria` (4 rows) and `scoring_policy` — the upstream scorer's own rubric and weighting. They are data, not documentation: the criteria `max` bounds (25/25/30/20) have to stay consistent with `judge.scores`, and `scoring_policy.total_max` with `score_max`.
- `round.sample.json` `round.totals` — upstream per-candidate completion counters (`items_expected` / `items_scored` / `complete`). Kept because downstream has to be able to tell a fully scored candidate from a partial one.
- `animation_task.content_sha256` — full 64-hex digest (later trimmed to `d1d1d34e` in an earlier revision, which is the same value truncated).

## `asset.sha256` must stay

`round.sample.json` keeps the upstream `asset.sha256` **at full 64-hex length**. The digest is what downstream compares a downloaded animation against before it is trusted and served, so it cannot be shortened to a readable prefix: `src/lib/asset.ts` resolves the basename of `asset_url` into the local `public/assets/` directory, and those artifacts are only allowed in once their bytes hash to this digest. A fixture without the digest exercises none of that.

The value `941fa56cdad0ab9adf2be43a9cf8bb8731f4044443972d7e0032cac74bb2683a` is a real upstream digest, not invented. Upstream names each animation file `<run>-<model>-<effort>-<first 12 hex of the sha256>.html.txt`, so the digest is verifiable without the original bytes:

- `https://codexradar.com/assets/degradation-codex-205416a78068-6a72489e707c-gpt-6-astra-high-941fa56cda.html.txt` still answers `200`, and the file name prefix `941fa56cda` matches the digest above.
- The rule itself is confirmed against the 34 artifacts committed under `public/assets/`: for every one of them, the file-name suffix equals the first 12 hex of the file's own sha256 (5/5 spot-checked, 0 mismatches).

The file body at that URL has since been overwritten with the fallback page (`b68eb88f…`, 1860754 bytes), which is why the digest can no longer be reproduced from the URL alone while the fixture's `bytes: 19605` belongs to the original artifact. The upstream run has also rolled on to `gpt-6.1-sol`; this fixture deliberately stays on the `gpt-6-astra` round the tests are pinned to (`tests/lib.test.ts` asserts `animation.score === 91` and the digest above).

## Contract coverage of these fixtures

`scripts/contract.mjs` validates the *transformed* documents, so it only bites the parts the transform copies through. Measured on 2026-10-31, with the fixtures in this directory:

- `assertRadarBenchShape` (summary), `assertRoundShape` (round) and `assertStatusShape` (`public/data/status.json`) all pass.
- A wrong type is caught: turning `asset.sha256` into a number fails with `round.candidates[0].animation.asset_sha256: expected non-empty string, got 12345`.
- A **missing** digest is *not* caught: `asset_sha256` is optional in the contract, deleting it only nulls the field and still validates. The digest is therefore held by tests and by this document, not by the contract.

Do not invent values; refresh with the URLs above when the upstream schema changes, and update the trim notes in the same commit.
