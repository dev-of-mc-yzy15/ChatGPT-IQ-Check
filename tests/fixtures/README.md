# Fixtures

These are trimmed excerpts of live CodexRadar responses, fetched 2026-10-23. Trimmed on demand after the fetch; every trim point is annotated:

- `binding.sample.json` — `https://codexradar.com/data/radar-bench-binding.json` (trimmed to 3 candidates / 1 member; the task counts below follow the trimmed member list)
- `summary.sample.json` — `https://codexradar.com/api/radar-bench-score?model=gpt-6-astra&effort=high&view=summary&selection=user-selected-v1` (trimmed to 3 history points)
- `round.sample.json` — `https://codexradar.com/degradation-codex-latest.json` (trimmed to 2 candidates / 7 tasks)
  - `candidates` only mirrors the two `round.results` keys; the transform reads `results`, not this array
  - the animation digest is a made-up 64-hex value (`asset.sha256`, mirrored to `asset_sha256`) — a trimmed excerpt cannot keep the real one

Do not invent values other than the animation digests called out above; refresh with the URLs above when the upstream schema changes.
