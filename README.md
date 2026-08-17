# dsh-plugin-market

**Recommended-plugin directory for DeepSeek Harness** — a two-package capability
that answers "which DSH plugins should I use?" with live GitHub star data,
snapshot-derived trends, and task-intent ranking, exposed to the model through
the `search_plugins` tool.

- `@your-scope/dsh-plugin-market` — the directory service (`ctx.pluginMarket`):
  curated seed catalog (20+ entries incl. the harness itself and community
  plugins), `register()` for runtime additions, concurrent GitHub star fetch,
  local snapshot persistence, 7/30-day trend computation, and
  `score = 2·(matched tags) + (text match) + log10(stars+1) + 7d-trend` ranking.
  Startup prewarm and a background refresh interval keep the cache warm.
- `@your-scope/dsh-tool-plugin-search` — the model-facing `search_plugins`
  tool: schema, query validation, result formatting, result cap, and UI card
  presentation. No network access of its own.

## Install

```sh
dsh plugin add @your-scope/dsh-plugin-market-bundle
```

Or add the two packages separately:

```sh
dsh plugin add @your-scope/dsh-plugin-market
dsh plugin add @your-scope/dsh-tool-plugin-search
```

Then ask the agent something like "推荐几个 DeepSeek Harness 插件" — it will
call `search_plugins` and return recommendations with install commands.

## Configuration

Mount the service with options (defaults shown):

```yaml
- id: plugin-market
  name: '@your-scope/dsh-plugin-market'
  config:
    githubToken: ''          # raises the anonymous 60/hour GitHub limit
    cacheTtlMs: 3600000      # freshness window for cache + persisted snapshots
    snapshotDir: ~           # defaults to <dsh home>/plugin-market
    prewarm: true            # fetch all repositories once at startup
    refreshIntervalMs: 21600000  # background refresh; 0 disables
```

## How it works

```
search_plugins(query)
  └─ ctx.pluginMarket.search(query, { maxResults })
       ├─ resolveMetrics(repos)      # concurrent GitHub fetch (Promise.all)
       │    ├─ in-memory cache hit (< TTL)      → instant
       │    ├─ persisted snapshot fresh (< TTL) → instant, no fetch
       │    └─ live GET /repos/{owner}/{repo}   → append snapshot, persist once
       ├─ computeDeltas(history)      # 7d / 30d star trend from local snapshots
       └─ rank & cap                  # relevance + stars + trend, top-N
```

Latency: warm cache ≈ 1 ms; cold (no cache, no snapshot) ≈ one concurrent round
trip (~300–600 ms); GitHub down/rate-limited → stale snapshot instantly.

## Curating the catalog

The seed lives in `packages/plugin-market/src/index.ts` (`SEED_ENTRIES`); add a
repo with its id, name, `owner/name`, description, tags, and install command.
Trends need a few days of snapshots before 7d/30d deltas appear.

## Status: dependency publication pending

The `@deepseek-ai/*` packages are on npm as `0.0.1-rc.x` / `4.0.1` (cordis) /
`3.18.1` (schemastery), but the upstream publish is **in progress**: some
transitive packages referenced by the published `rc.1` releases are not yet on
the registry (for example `@deepseek-ai/dsh-type-meta`, `@deepseek-ai/dsh-util`).
Until those appear, `pnpm install` will fail and CI cannot turn green.

Track the upstream rollout (deepseek-ai/deepseek-harness, `feat/npm-public`) —
the moment the missing packages publish, this repository builds and tests as
shipped. Open an issue here or upstream if a referenced package is still missing.

## Publishing

1. Replace every `@your-scope` with your npm scope (and the bundle/repo name).
2. `pnpm install && pnpm build && pnpm test`.
3. `pnpm publish` in each package, then the bundle (bundle last).
4. After publishing, install from the registry as shown above.

## Disclaimer

Third-party entries are curated, not official. Star counts are per-repository,
live from the GitHub REST API (anonymous 60/hour limit without a token; the
background prewarm/refresh consumes quota, so configure `githubToken` for large
catalogs). Dependencies on `@deepseek-ai/*` are pre-release (`0.1.0-rc.x`).

## License

MIT
