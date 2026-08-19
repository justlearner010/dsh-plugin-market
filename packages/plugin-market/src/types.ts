/**
 * Pure catalog, star-metric, and recommendation types for the plugin-market
 * capability. Runtime code lives in index.ts.
 * @module @justlearner010/dsh-plugin-market/types
 */

/** Install-command trust level for a catalog entry. */
export type PluginInstallTrust = 'verified' | 'reference' | 'unverified'

/** One recommended-plugin catalog entry registered with `ctx.pluginMarket`. */
export interface PluginEntry {
  /** Stable catalog id, unique within the directory (kebab-case). */
  readonly id: string
  /** Human-facing plugin name. */
  readonly name: string
  /** GitHub repository as `owner/name`. */
  readonly repo: string
  /** One-sentence description used for task-intent matching. */
  readonly description: string
  /** Lowercase task-intent tags used for relevance matching. */
  readonly tags: readonly string[]
  /** Install command shown to the user (e.g. `dsh plugin add <spec>` or a clone URL). */
  readonly installCommand: string
  /**
   * Trust level of the install command: `verified` declares `dsh.bundle` (a
   * profile-layer bundle `dsh plugin add` installs), `reference` is a clone or
   * docs URL (not an installable bundle), `unverified` claims installability
   * without confirmed bundle support.
   */
  readonly installTrust: PluginInstallTrust
  /** Optional homepage or documentation URL. */
  readonly homepage?: string
}

/** Star metrics resolved for one repository. */
export interface PluginStarMetrics {
  /** Current stargazers count (0 when no live or cached data exists). */
  readonly stars: number
  /** Star change over the trailing 7 days, when history reaches that window. */
  readonly starDelta7d?: number
  /** Star change over the trailing 30 days, when history reaches that window. */
  readonly starDelta30d?: number
  /** Epoch milliseconds when the metrics were captured. */
  readonly fetchedAt: number
  /** True when the numbers came from a cached snapshot or a failed live fetch. */
  readonly stale: boolean
}

/** Per-request options accepted by `ctx.pluginMarket.search()`. */
export interface PluginSearchOptions {
  /** Result cap; the caller (usually the consumer tool) owns this bound. */
  readonly maxResults?: number
  /** Aborts the GitHub fetch and matching work. */
  readonly signal?: AbortSignal
}

/** One ranked recommendation returned by `ctx.pluginMarket.search()`. */
export interface PluginRecommendation extends PluginEntry {
  /** Current stargazers count (0 when no live or cached data exists). */
  readonly stars: number
  /** 7-day star delta, when history reaches that window. */
  readonly starDelta7d?: number
  /** 30-day star delta, when history reaches that window. */
  readonly starDelta30d?: number
  /** True when the star numbers are stale or unavailable. */
  readonly stale: boolean
  /** Tags that matched the query, in declaration order. */
  readonly matchedTags: readonly string[]
  /** Descending-sort ranking score (higher ranks first). */
  readonly score: number
}
