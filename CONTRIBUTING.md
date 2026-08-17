# Contributing

This repository is developed through the **issue → PR** workflow:

1. **Open an issue** first for any feature, bug, or catalog suggestion
   (`.github/ISSUE_TEMPLATE/` has templates for feature requests, bug reports,
   and catalog additions).
2. **Reference the issue** in your PR title/body (e.g. `fixes #12`).
3. **CI must pass**: `pnpm install && pnpm build && pnpm test`
   (`.github/workflows/ci.yml` runs this on every push/PR).
4. Keep each PR focused on one issue; include tests for behavior changes.

## Development setup

```sh
pnpm install
pnpm build      # type-checks + emits lib/types for both packages
pnpm test       # vitest across both packages
```

## Adding a catalog entry

Append to `SEED_ENTRIES` in `packages/plugin-market/src/index.ts`:
`{ id, name, repo: 'owner/name', description, tags, installCommand, homepage }`.
Trends need a few days of snapshots before 7d/30d deltas appear.
