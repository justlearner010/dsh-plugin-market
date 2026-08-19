/**
 * Recommended-plugin directory (`ctx.pluginMarket`): a seeded catalog of
 * DeepSeek Harness plugins enriched with GitHub star metrics, star trends
 * computed from locally persisted snapshots, and relevance ranking against a
 * task-intent query. The directory owns the catalog and its single star data
 * source; the model-facing discovery tool lives in
 * `@justlearner010/dsh-tool-plugin-search`.
 * @module @justlearner010/dsh-plugin-market
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  PluginCategory,
  PluginEntry,
  PluginRecommendation,
  PluginSearchOptions,
  PluginStarMetrics,
} from './types.ts'

export type * from './types.ts'

/** Default per-repository metric cache TTL: one hour. */
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000

/** Default result cap applied when a caller omits `maxResults`. */
export const DEFAULT_MAX_RESULTS = 8

/** Default background refresh interval: six hours. */
export const DEFAULT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Snapshot history retained per repository, enough for the 30-day trend window plus headroom. */
const SNAPSHOT_HISTORY_LIMIT = 40

/** GitHub REST API base for repository metadata. */
const GITHUB_API = 'https://api.github.com/repos/'

/** Trailing trend windows in days. */
const TREND_WINDOW_DAYS = [7, 30] as const

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Catalog id grammar: kebab-case. */
const ENTRY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** GitHub repository grammar: `owner/name`. */
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** Closed set of valid categories, kept here so `validateEntry` and `search` share one source. */
const CATEGORY_SET: ReadonlySet<PluginCategory> = new Set([
  'ui', 'bridge', 'mcp', 'tool', 'infra', 'memory', 'experiment',
])

/**
 * Stable ordering of categories, exported so callers can iterate deterministically
 * (e.g. the tool-plugin-search renderer groups output by category in this order).
 * The string values match `PluginCategory`; the array is asserted as a tuple at the
 * boundary so the type system catches any drift between the two declarations.
 */
export const PLUGIN_CATEGORIES: readonly PluginCategory[] = [
  'ui', 'bridge', 'mcp', 'tool', 'infra', 'memory', 'experiment',
] as const

function isPluginCategory(value: unknown): value is PluginCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value as PluginCategory)
}

/**
 * Normalize the `category` search option into a `Set` (for fast `has()` checks)
 * or `undefined` (meaning "no filter"). Accepts a single category or
 * `undefined`. Throws on an unknown category so a typo fails fast at the call
 * site instead of silently returning the whole catalog.
 */
function normalizeCategoryFilter(
  raw: PluginCategory | undefined,
): Set<PluginCategory> | undefined {
  if (raw === undefined) return undefined
  if (!isPluginCategory(raw)) {
    throw new Error(`plugin-market: unknown category "${raw as string}"`)
  }
  return new Set([raw])
}

/** Built-in seed: the DeepSeek Harness repository plus curated third-party ecosystem entries. */
const SEED_ENTRIES: readonly PluginEntry[] = [
  {
    id: 'deepseek-harness',
    installTrust: 'reference',
    name: 'DeepSeek Harness',
    repo: 'deepseek-ai/deepseek-harness',
    description: 'Plugin-based agent harness on Cordis: every capability — tools, LLM adapters, filesystem, the agent loop — is a plugin.',
    tags: ['agent', 'harness', 'plugin', 'llm', 'tools', 'cli', 'cordis'],
    category: 'infra',
    installCommand: 'git clone https://github.com/deepseek-ai/deepseek-harness.git',
    homepage: 'https://github.com/deepseek-ai/deepseek-harness',
  },
  {
    id: 'awesome-deepseek-harness',
    installTrust: 'reference',
    name: 'Awesome DeepSeek Harness',
    repo: '0xsline/awesome-deepseek-harness',
    description: 'Curated DeepSeek Harness ecosystem list: community plugins, tools, and infrastructure.',
    tags: ['ecosystem', 'curated', 'plugins', 'skills', 'mcp', 'list'],
    category: 'experiment',
    installCommand: 'git clone https://github.com/0xsline/awesome-deepseek-harness.git',
    homepage: 'https://github.com/0xsline/awesome-deepseek-harness',
  },
  {
    id: 'dsh-plugin-hub',
    installTrust: 'unverified',
    name: 'DSH Plugin Hub',
    repo: 'Noob-stupid/dsh-plugin-hub',
    description: 'DeepSeek Harness plugin management panel: enable/disable plugins and browse a GitHub plugin marketplace with one-click install.',
    tags: ['plugin-manager', 'marketplace', 'ui', 'install'],
    category: 'ui',
    installCommand: 'dsh plugin add github:Noob-stupid/dsh-plugin-hub',
    homepage: 'https://github.com/Noob-stupid/dsh-plugin-hub',
  },
  {
    id: 'dsh-plugin-security-review',
    installTrust: 'unverified',
    name: 'DSH Plugin Security Review',
    repo: 'ShanHaiFish/dsh-plugin-security-review',
    description: 'Dynamic Cordis plugin install security review gate for DeepSeek Harness.',
    tags: ['security', 'guard', 'review', 'install'],
    category: 'infra',
    installCommand: 'dsh plugin add github:ShanHaiFish/dsh-plugin-security-review',
    homepage: 'https://github.com/ShanHaiFish/dsh-plugin-security-review',
  },
  {
    id: 'dsh-workbench-plugin',
    installTrust: 'unverified',
    name: 'DeepSeek Harness Workbench',
    repo: 'loadingvx/deepseek-harness-workbench-plugin',
    description: 'A workbench plugin for DeepSeek Harness.',
    tags: ['workbench', 'productivity', 'ui'],
    category: 'ui',
    installCommand: 'dsh plugin add github:loadingvx/deepseek-harness-workbench-plugin',
    homepage: 'https://github.com/loadingvx/deepseek-harness-workbench-plugin',
  },
  {
    id: 'dsh-web-ui',
    installTrust: 'verified',
    name: 'DSH Web UI',
    repo: 'zhu1090093659/dsh-web-ui',
    description: 'Plugin and skin collection for the DSH web GUI: task board, git graph, live stats, SSH, and more.',
    tags: ['web', 'ui', 'plugin', 'task-board', 'git', 'collection'],
    category: 'ui',
    installCommand: 'dsh plugin add @linxin666/dsh-web-ui-all',
    homepage: 'https://github.com/zhu1090093659/dsh-web-ui',
  },
  {
    id: 'dsh-tianshu-tui',
    installTrust: 'verified',
    name: 'DSH Tianshu TUI',
    repo: 'huiliyi37/dsh-tianshu-tui',
    description: 'Interactive terminal-style UI plugin for the DSH web client, rendered with a custom ANSI engine.',
    tags: ['tui', 'ui', 'terminal', 'web'],
    category: 'ui',
    installCommand: 'dsh plugin add @huiliyi37/dsh-tianshu-tui',
    homepage: 'https://github.com/huiliyi37/dsh-tianshu-tui',
  },
  {
    id: 'dsh-webui-market-plugin',
    installTrust: 'verified',
    name: 'DSH WebUI Market',
    repo: 'Sanqi-normal/dsh-webui-market-plugin',
    description: 'Community plugin marketplace for the dsh web GUI: browse the awesome-dsh-plugin.com catalog and install to a profile.',
    tags: ['marketplace', 'web', 'ui', 'install'],
    category: 'ui',
    installCommand: 'dsh plugin add @sanqi-normal/dsh-webui-market-plugin',
    homepage: 'https://github.com/Sanqi-normal/dsh-webui-market-plugin',
  },
  {
    id: 'dsh-lark-bot',
    installTrust: 'verified',
    name: 'DSH Lark Bot',
    repo: 'PlutoKeating/dsh-lark-bot',
    description: 'Bridge DeepSeek Harness into Feishu/Lark: streaming cards, project workspaces, parallel tasks, multi-role.',
    tags: ['feishu', 'lark', 'bot', 'chat', 'bridge'],
    category: 'bridge',
    installCommand: 'dsh plugin add dsh-lark-bot',
    homepage: 'https://github.com/PlutoKeating/dsh-lark-bot',
  },
  {
    id: 'dsh-win32',
    installTrust: 'verified',
    name: 'DSH Win32',
    repo: 'sjh9714/dsh-win32',
    description: 'Get DSH working on Windows with a one-line minimal persistent shell, usable inside the sandbox.',
    tags: ['windows', 'shell', 'setup'],
    category: 'infra',
    installCommand: 'dsh plugin add dsh-win32',
    homepage: 'https://github.com/sjh9714/dsh-win32',
  },
  {
    id: 'dsh-movein',
    installTrust: 'verified',
    name: 'DSH MoveIn',
    repo: 'sjh9714/dsh-movein',
    description: 'Move your whole Claude Code setup into DeepSeek Harness with one command.',
    tags: ['migration', 'claude-code', 'setup'],
    category: 'infra',
    installCommand: 'dsh plugin add dsh-movein',
    homepage: 'https://github.com/sjh9714/dsh-movein',
  },
  {
    id: 'dsh-auth-gate',
    installTrust: 'verified',
    name: 'DSH Auth Gate',
    repo: 'TecFancy/dsh-auth-gate',
    description: 'Login gate for the DSH web surface: password or shared-token authentication.',
    tags: ['auth', 'security', 'web'],
    category: 'infra',
    installCommand: 'dsh plugin add dsh-auth-gate',
    homepage: 'https://github.com/TecFancy/dsh-auth-gate',
  },
  {
    id: 'dsh-neotui',
    installTrust: 'unverified',
    name: 'DSH Neo-TUI',
    repo: 'edabchann/dsh-neotui',
    description: 'Mouse-driven terminal UI client for DeepSeek Harness.',
    tags: ['tui', 'terminal', 'client'],
    category: 'ui',
    installCommand: 'dsh plugin add dsh-neotui',
    homepage: 'https://github.com/edabchann/dsh-neotui',
  },
  {
    id: 'dsh-config-manager',
    installTrust: 'verified',
    name: 'DSH Config Manager',
    repo: 'xiajiajun516/dsh-config-manager',
    description: 'Backup, export, import, and migrate DeepSeek Harness configuration.',
    tags: ['config', 'backup', 'migrate'],
    category: 'infra',
    installCommand: 'dsh plugin add dsh-config-manager',
    homepage: 'https://github.com/xiajiajun516/dsh-config-manager',
  },
  {
    id: 'dsh-mcp-apps',
    installTrust: 'unverified',
    name: 'DSH MCP Apps',
    repo: 'sugarforever/dsh-mcp-apps',
    description: 'MCP Apps host plugin for DeepSeek Harness.',
    tags: ['mcp', 'apps', 'tools'],
    category: 'mcp',
    installCommand: 'dsh plugin add @sugarforever/dsh-mcp-apps',
    homepage: 'https://github.com/sugarforever/dsh-mcp-apps',
  },
  {
    id: 'dsh-agfs',
    installTrust: 'verified',
    name: 'DSH AGFS',
    repo: 'openAGFS/dsh-agfs',
    description: 'Host file-browser web app over the dsh webserver.',
    tags: ['files', 'browser', 'web'],
    category: 'ui',
    installCommand: 'dsh plugin add @open-agfs/dsh-agfs',
    homepage: 'https://github.com/openAGFS/dsh-agfs',
  },
  {
    id: 'dsh-plugin-om',
    installTrust: 'verified',
    name: 'DSH Plugin OM',
    repo: 'FanetheDivine/dsh-plugin-om',
    description: 'DSH plugin managing context through Observational Memory.',
    tags: ['memory', 'context', 'observation'],
    category: 'memory',
    installCommand: 'dsh plugin add dsh-plugin-om',
    homepage: 'https://github.com/FanetheDivine/dsh-plugin-om',
  },
  {
    id: 'dsh-plugin-focus',
    installTrust: 'verified',
    name: 'DSH Plugin Focus',
    repo: '863683348/dsh-plugin-focus',
    description: 'Focus board for DeepSeek Harness agents: durable, model-maintained notes.',
    tags: ['focus', 'notes', 'productivity'],
    category: 'memory',
    installCommand: 'dsh plugin add dsh-plugin-focus',
    homepage: 'https://github.com/863683348/dsh-plugin-focus',
  },
  {
    id: 'orgx-dsh-plugin',
    installTrust: 'verified',
    name: 'OrgX DeepSeek Harness Plugin',
    repo: 'useorgx/orgx-deepseek-harness-plugin',
    description: 'OrgX Work Ledger, MCP tools, skills, proof, and governed execution for DeepSeek Harness.',
    tags: ['orgx', 'mcp', 'ledger', 'tools'],
    category: 'mcp',
    installCommand: 'dsh plugin add @useorgx/deepseek-harness-plugin',
    homepage: 'https://github.com/useorgx/orgx-deepseek-harness-plugin',
  },
  {
    id: 'dsh-what-changed',
    installTrust: 'unverified',
    name: 'dsh-what-changed',
    repo: 'sjh9714/dsh-what-changed',
    description: 'Session-header review of every file the agent wrote this session, with per-file hunks, counting writes the permission layer refused apart from edits, plus a workspace-versus-HEAD section that sees files changed through bash or python.',
    tags: ['session', 'diff', 'review', 'ui', 'git'],
    category: 'ui',
    installCommand: 'dsh plugin --profile web add dsh-what-changed',
    homepage: 'https://github.com/sjh9714/dsh-what-changed',
  },
]

/** Plugin config: star data source and cache/snapshot location. */
export interface Config {
  /** GitHub personal access token; falls back to `GITHUB_TOKEN` when omitted. */
  githubToken?: string
  /** Per-repository metric cache TTL in milliseconds; defaults to one hour. */
  cacheTtlMs?: number
  /** Snapshot directory; defaults to `<dsh home>/plugin-market`. */
  snapshotDir?: string
  /** Fetch every repository's stars once at startup; defaults to true. */
  prewarm?: boolean
  /** Background refresh interval in milliseconds; defaults to six hours, 0 disables. */
  refreshIntervalMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginMarket: PluginMarket
  }
}

/** One persisted star observation for a repository. */
interface StarSnapshot {
  /** Epoch milliseconds of the observation. */
  readonly time: number
  /** Stargazers count at `time`. */
  readonly stars: number
}

/** Whole-file snapshot document shape on disk. */
interface SnapshotFile {
  /** Snapshots per repository, oldest first. */
  readonly repos: Record<string, StarSnapshot[]>
}

/** GitHub repository metadata subset read from the REST API. */
interface GithubRepoBody {
  readonly stargazers_count?: unknown
}

/**
 * Recommended-plugin directory. Seeded with a built-in catalog and extensible
 * through `register()`; `search()` ranks the catalog against a task-intent
 * query using tag/description relevance plus GitHub star popularity and the
 * snapshot-derived 7/30-day trend.
 */
export class PluginMarket extends Service {
  /** Validated config schema read by the Loader. */
  static Config: Schema<Config> = z.object({
    githubToken: z.string(),
    cacheTtlMs: z.number().default(DEFAULT_CACHE_TTL_MS),
    snapshotDir: z.string(),
    prewarm: z.boolean().default(true),
    refreshIntervalMs: z.number().default(DEFAULT_REFRESH_INTERVAL_MS),
  })

  private readonly cacheTtlMs: number
  private readonly snapshotFile: string
  private readonly githubToken: string | undefined
  private readonly prewarm: boolean
  private readonly refreshIntervalMs: number
  private readonly entries = new Map<string, PluginEntry>()
  private readonly metricsCache = new Map<string, { metrics: PluginStarMetrics; at: number }>()
  private snapshots: SnapshotFile | undefined
  private snapshotsLoad: Promise<SnapshotFile> | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginMarket')
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.githubToken = config.githubToken ?? process.env.GITHUB_TOKEN
    this.snapshotFile = `${config.snapshotDir ?? dshHomePath('plugin-market')}/star-snapshots.json`
    this.prewarm = config.prewarm ?? true
    this.refreshIntervalMs = config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
    assertPositiveInteger('cacheTtlMs', this.cacheTtlMs)
    assertNonNegativeInteger('refreshIntervalMs', this.refreshIntervalMs)
    for (const entry of SEED_ENTRIES) {
      validateEntry(entry, 'seed entry')
      this.entries.set(entry.id, entry)
    }
    // Warm the catalog once at startup and keep it warm on a background
    // interval so a query never waits on a cold GitHub round trip. Both are
    // fire-and-forget and failure-contained; the in-memory cache and the
    // snapshot file make the first query hit warm data in the common case.
    if (this.prewarm) void this.performRefresh()
    if (this.refreshIntervalMs > 0) {
      const timer = setInterval(() => { void this.performRefresh() }, this.refreshIntervalMs)
      this.ctx.effect(() => () => { clearInterval(timer) }, 'pluginMarket.refresh()')
    }
  }

  /**
   * Register a runtime catalog entry (a manually added repository). Duplicate
   * ids are first-wins: the later registration logs a warning and receives a
   * no-op disposer. The returned disposer unregisters the entry and unwinds
   * with the calling plugin's fiber.
   * @param entry - the catalog entry to add.
   * @returns the exact disposer that unregisters the entry.
   */
  register(entry: PluginEntry): () => void {
    validateEntry(entry, 'registered entry')
    if (this.entries.has(entry.id)) {
      this.ctx.logger.warn(`plugin-market: entry "${entry.id}" is already registered; ignoring duplicate`)
      return () => {}
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity
    return this.ctx.effect(() => {
      this.entries.set(entry.id, entry)
      return () => { this.entries.delete(entry.id) }
    }, 'pluginMarket.register()')
  }

  /**
   * List the complete catalog in registration order (seed entries first).
   * @returns every registered entry.
   */
  list(): PluginEntry[] {
    return [...this.entries.values()]
  }

  /**
   * Rank the catalog against a task-intent query. Every repository's star
   * metrics are resolved (live fetch, then snapshot cache, then `stale`),
   * scored by tag/description relevance plus star popularity and 7-day trend,
   * and returned in descending score order capped at `maxResults`.
   *
   * When `options.category` is provided, the catalog is filtered to entries
   * whose `category` is in the allowed set *before* scoring — categories
   * narrow the pool but never affect the score formula.
   * @param query - task-intent text; empty text ranks by popularity and trend alone.
   * @param options - result cap, category filter, and abort signal.
   * @returns ranked recommendations.
   */
  async search(query: string, options: PluginSearchOptions = {}): Promise<PluginRecommendation[]> {
    throwIfAborted(options.signal)
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
    assertPositiveInteger('maxResults', maxResults)
    const categoryFilter = normalizeCategoryFilter(options.category)
    const entries = categoryFilter === undefined
      ? this.list()
      : this.list().filter(entry => categoryFilter.has(entry.category))
    const metricsByRepo = await this.resolveMetrics(entries.map(entry => entry.repo), options.signal)
    const recommendations = entries.map((entry) => {
      const match = matchQuery(entry, query)
      /* v8 ignore next -- resolveMetrics populates every repository; the fallback is defensive against future drift */
      const metrics = metricsByRepo.get(entry.repo) ?? { stars: 0, fetchedAt: 0, stale: true }
      return {
        ...entry,
        stars: metrics.stars,
        ...metrics.starDelta7d !== undefined ? { starDelta7d: metrics.starDelta7d } : {},
        ...metrics.starDelta30d !== undefined ? { starDelta30d: metrics.starDelta30d } : {},
        stale: metrics.stale,
        matchedTags: match.matchedTags,
        score: computeScore(match, metrics),
      }
    })
    return recommendations
      .sort((left, right) => right.score - left.score || compareCodePoints(left.name, right.name))
      .slice(0, maxResults)
  }

  private async resolveMetrics(repos: readonly string[], signal?: AbortSignal): Promise<Map<string, PluginStarMetrics>> {
    const now = Date.now()
    const result = new Map<string, PluginStarMetrics>()
    const pending: { repo: string; fetch: Promise<PluginStarMetrics> }[] = []
    for (const repo of repos) {
      throwIfAborted(signal)
      const cached = this.metricsCache.get(repo)
      if (cached !== undefined && now - cached.at < this.cacheTtlMs) {
        result.set(repo, cached.metrics)
        continue
      }
      // Start every missing repository's fetch concurrently so a cold catalog
      // resolves in one round trip instead of one sequential round trip per repo.
      pending.push({ repo, fetch: this.fetchMetrics(repo, now, signal) })
    }
    const settled = await Promise.all(pending.map(async item => ({ repo: item.repo, metrics: await item.fetch })))
    for (const { repo, metrics } of settled) {
      this.metricsCache.set(repo, { metrics, at: now })
      result.set(repo, metrics)
    }
    // Persist once with the complete document after every fetch settles: the
    // fetches mutated the shared snapshot object, so a single write is both
    // correct (no interleaved partial writes) and cheaper than one per repo.
    if (pending.length > 0) {
      /* v8 ignore next -- pending implies fetchMetrics already loaded the snapshot document */
      await this.persistSnapshots(this.snapshots ?? { repos: {} })
    }
    return result
  }

  /**
   * Fetch every catalog repository's stars in the background, populating the
   * in-memory cache and appending to the snapshot file. Failure-contained so a
   * transient GitHub error cannot break the plugin's foreground work.
   */
  private async performRefresh(): Promise<void> {
    try {
      await this.resolveMetrics(this.list().map(entry => entry.repo), undefined)
      /* v8 ignore start -- resolveMetrics with no signal never rejects; the guard is defensive */
    } catch (error) {
      this.ctx.logger.warn(`plugin-market: background refresh failed: ${errorMessage(error)}`)
    }
    /* v8 ignore stop */
  }

  private async fetchMetrics(repo: string, now: number, signal?: AbortSignal): Promise<PluginStarMetrics> {
    const snapshots = await this.loadSnapshots()
    let history = snapshots.repos[repo] ?? []
    const latest = lastOf(history)
    // Serve a persisted observation still inside the freshness window without a
    // live fetch: the snapshot file exists to survive restarts, so a warm
    // catalog is the common case even on a cold process.
    if (latest !== undefined && now - latest.time < this.cacheTtlMs) {
      const stars = latest.stars
      const deltas = computeDeltas(history, stars, now)
      return {
        stars,
        fetchedAt: latest.time,
        /* v8 ignore start -- a fresh latest observation always satisfies both trend windows, so the empty spread side is unreachable */
        ...deltas.starDelta7d !== undefined ? { starDelta7d: deltas.starDelta7d } : {},
        ...deltas.starDelta30d !== undefined ? { starDelta30d: deltas.starDelta30d } : {},
        /* v8 ignore stop */
        stale: false,
      }
    }
    let stale = false
    let live: number | undefined
    try {
      live = await this.fetchGithubStars(repo, signal)
    } catch {
      if (signal?.aborted === true) throw toError(signal.reason)
      stale = true
    }
    if (live !== undefined) {
      history = [...history, { time: now, stars: live }].slice(-SNAPSHOT_HISTORY_LIMIT)
      snapshots.repos[repo] = history
    } else {
      stale = true
    }
    const observed = lastOf(history)
    const stars = observed?.stars ?? 0
    const deltas = computeDeltas(history, stars, now)
    return {
      stars,
      fetchedAt: observed?.time ?? 0,
      ...deltas.starDelta7d !== undefined ? { starDelta7d: deltas.starDelta7d } : {},
      ...deltas.starDelta30d !== undefined ? { starDelta30d: deltas.starDelta30d } : {},
      stale,
    }
  }

  private async fetchGithubStars(repo: string, signal?: AbortSignal): Promise<number> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-plugin-market',
    }
    if (this.githubToken !== undefined && this.githubToken.length > 0) {
      headers.Authorization = `Bearer ${this.githubToken}`
    }
    const response = await fetch(`${GITHUB_API}${repo}`, {
      headers,
      ...signal !== undefined ? { signal } : {},
    })
    if (response.status === 403 || response.status === 429) {
      throw new Error(`GitHub rate limit reached while fetching "${repo}"`)
    }
    if (!response.ok) {
      throw new Error(`GitHub fetch for "${repo}" failed with HTTP ${response.status}`)
    }
    const body = await response.json() as GithubRepoBody
    if (typeof body.stargazers_count !== 'number') {
      throw new Error(`GitHub fetch for "${repo}" returned no stargazers_count`)
    }
    return body.stargazers_count
  }

  private loadSnapshots(): Promise<SnapshotFile> {
    // Single-flight: concurrent repository fetches share one file read instead
    // of racing each other (and re-reading the document per repo).
    if (this.snapshotsLoad === undefined) this.snapshotsLoad = this.readSnapshots()
    return this.snapshotsLoad
  }

  private async readSnapshots(): Promise<SnapshotFile> {
    let file: SnapshotFile = { repos: {} }
    try {
      const text = await readFile(this.snapshotFile, 'utf8')
      const parsed: unknown = JSON.parse(text)
      if (isSnapshotFile(parsed)) file = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.ctx.logger.warn(`plugin-market: snapshot read failed: ${errorMessage(error)}`)
      }
    }
    this.snapshots = file
    return file
  }

  private async persistSnapshots(file: SnapshotFile): Promise<void> {
    try {
      await mkdir(dirname(this.snapshotFile), { recursive: true })
      await writeFile(this.snapshotFile, JSON.stringify(file), 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`plugin-market: snapshot write failed: ${errorMessage(error)}`)
    }
  }
}

export default PluginMarket

function lastOf<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1]
}

function computeDeltas(history: readonly StarSnapshot[], stars: number, now: number): { starDelta7d?: number; starDelta30d?: number } {
  const result: { starDelta7d?: number; starDelta30d?: number } = {}
  for (const days of TREND_WINDOW_DAYS) {
    const baseline = oldestAtOrBefore(history, now - days * DAY_MS)
    if (baseline === undefined) continue
    const delta = stars - baseline.stars
    if (days === 7) result.starDelta7d = delta
    else result.starDelta30d = delta
  }
  return result
}

function oldestAtOrBefore(history: readonly StarSnapshot[], cutoff: number): StarSnapshot | undefined {
  return history.find(snapshot => snapshot.time >= cutoff)
}

function matchQuery(entry: PluginEntry, query: string): { matchedTags: string[]; textMatch: boolean } {
  const tokens = query.toLowerCase().split(/\s+/).filter(token => token.length > 0)
  const matchedTags = entry.tags.filter(tag => tokens.some(token => tag.includes(token) || token.includes(tag)))
  const haystack = `${entry.name} ${entry.description}`.toLowerCase()
  const textMatch = tokens.some(token => haystack.includes(token))
  return { matchedTags, textMatch }
}

function computeScore(match: { matchedTags: readonly string[]; textMatch: boolean }, metrics: PluginStarMetrics): number {
  const tagScore = match.matchedTags.length * 2
  const textScore = match.textMatch ? 1 : 0
  const popularityScore = Math.log10(metrics.stars + 1)
  const trendScore = clamp((metrics.starDelta7d ?? 0) / 100, -10, 10)
  return tagScore + textScore + popularityScore + trendScore
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function validateEntry(entry: PluginEntry, subject: string): void {
  if (!ENTRY_ID.test(entry.id)) throw new Error(`plugin-market: ${subject} has invalid id "${entry.id}"`)
  if (entry.name.length === 0) throw new Error(`plugin-market: ${subject} "${entry.id}" requires a name`)
  if (!REPO.test(entry.repo)) throw new Error(`plugin-market: ${subject} "${entry.id}" has invalid repo "${entry.repo}" (expected owner/name)`)
  if (entry.description.length === 0) throw new Error(`plugin-market: ${subject} "${entry.id}" requires a description`)
  if (entry.tags.length === 0) throw new Error(`plugin-market: ${subject} "${entry.id}" requires at least one tag`)
  if (entry.tags.some(tag => tag.length === 0)) throw new Error(`plugin-market: ${subject} "${entry.id}" has an empty tag`)
  if (!isPluginCategory(entry.category)) {
    throw new Error(`plugin-market: ${subject} "${entry.id}" has unknown category "${entry.category}"`)
  }
  if (entry.installCommand.length === 0) throw new Error(`plugin-market: ${subject} "${entry.id}" requires an installCommand`)
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`plugin-market: ${name} must be a positive integer`)
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`plugin-market: ${name} must be a non-negative integer`)
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw toError(signal.reason)
}

function toError(error: unknown): Error {
  try {
    if (error instanceof Error) return error
  } catch {
    // A hostile proxy may throw during instanceof; fall through to the total renderer.
  }
  return new Error(errorMessage(error))
}

function errorMessage(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

function isSnapshotFile(value: unknown): value is SnapshotFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { repos } = value as { repos?: unknown }
  if (typeof repos !== 'object' || repos === null || Array.isArray(repos)) return false
  for (const [repo, list] of Object.entries(repos)) {
    if (repo.length === 0 || !Array.isArray(list) || !list.every(isSnapshot)) return false
  }
  return true
}

function isSnapshot(value: unknown): value is StarSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { time, stars } = value as { time?: unknown; stars?: unknown }
  return typeof time === 'number' && typeof stars === 'number'
}
