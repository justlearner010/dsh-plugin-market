/**
 * Model-facing `search_plugins` tool over `ctx.pluginMarket`. This package
 * owns the tool schema, query validation, result formatting, and the result
 * cap; discovery data and ranking come from the directory service.
 * @module @justlearner010/dsh-tool-plugin-search
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { PluginRecommendation } from '@justlearner010/dsh-plugin-market'
import { DEFAULT_MAX_RESULTS } from '@justlearner010/dsh-plugin-market'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-plugin-search'

/** Services required by the plugin search tool. */
export const inject = ['tools', 'pluginMarket', 'systemPrompt']

/** Plugin config: the model-facing result cap. */
export interface Config {
  /** Upper bound on recommendations returned by one `search_plugins` call. */
  maxResults?: number
}

/** Validated plugin config schema. */
export const Config: z<Config> = z.object({
  maxResults: z.number().default(DEFAULT_MAX_RESULTS),
})

/** One projected recommendation in the model-facing output value. */
interface RecommendationProjection {
  readonly name: string
  readonly repo: string
  readonly description: string
  readonly tags: string[]
  readonly installCommand: string
  readonly homepage?: string
  readonly stars: number
  readonly starDelta7d?: number
  readonly starDelta30d?: number
  readonly stale: boolean
  readonly matchedTags: string[]
}

/** Complete `search_plugins` output value. */
interface SearchPluginsOutput {
  readonly query: string
  readonly recommendations: readonly RecommendationProjection[]
  readonly totalCatalogSize: number
}

/**
 * Validate constraints the schema DSL cannot express: a non-blank `query`.
 * @param args - the schema-validated `search_plugins` arguments.
 * @returns the accepted arguments, passed through unchanged.
 */
export function parseSearchPluginsArgs(args: { query: string }): { query: string } {
  if (args.query.trim().length === 0) throw new Error('query must be a non-empty string')
  return { query: args.query }
}

/**
 * Format a `search_plugins` output value as one model-facing text block: a
 * ranked markdown recommendation list, a short-catalog note when the directory
 * holds one entry or fewer, and a staleness note when any star count is cached
 * or unavailable.
 * @param output - the canonical output value.
 * @returns the model-facing markdown.
 */
export function formatSearchPluginsOutput(output: SearchPluginsOutput): string {
  const parts: string[] = []
  if (output.recommendations.length === 0) {
    parts.push('No recommended plugins matched the query.')
  } else {
    parts.push(`Recommended plugins for "${output.query}":\n${output.recommendations.map(formatRecommendation).join('\n')}`)
  }
  if (output.totalCatalogSize <= 1) {
    parts.push(`Note: the plugin catalog currently contains ${output.totalCatalogSize} entry — the DSH plugin ecosystem is in its early days, so this list is short by design.`)
  } else {
    if (output.recommendations.length < output.totalCatalogSize) {
      parts.push(`Showing the top ${output.recommendations.length} of ${output.totalCatalogSize} catalog entries.`)
    }
  }
  if (output.recommendations.some(rec => rec.stale)) {
    parts.push('Some star counts are cached or unavailable (no GitHub token); treat the numbers as approximate.')
  }
  return parts.join('\n\n')
}

function projectRecommendation(recommendation: PluginRecommendation): RecommendationProjection {
  return {
    name: recommendation.name,
    repo: recommendation.repo,
    description: recommendation.description,
    tags: [...recommendation.tags],
    installCommand: recommendation.installCommand,
    ...recommendation.homepage !== undefined ? { homepage: recommendation.homepage } : {},
    stars: recommendation.stars,
    ...recommendation.starDelta7d !== undefined ? { starDelta7d: recommendation.starDelta7d } : {},
    ...recommendation.starDelta30d !== undefined ? { starDelta30d: recommendation.starDelta30d } : {},
    stale: recommendation.stale,
    matchedTags: [...recommendation.matchedTags],
  }
}

function formatRecommendation(rec: RecommendationProjection): string {
  const deltas: string[] = []
  if (rec.starDelta7d !== undefined) deltas.push(`7d ${signed(rec.starDelta7d)}`)
  if (rec.starDelta30d !== undefined) deltas.push(`30d ${signed(rec.starDelta30d)}`)
  const trend = deltas.length > 0 ? `, ${deltas.join(', ')}` : ''
  const stale = rec.stale ? ', stale' : ''
  const matched = rec.matchedTags.length > 0 ? ` (matches: ${rec.matchedTags.join(', ')})` : ''
  return `- **${rec.name}** — \`${rec.repo}\` — ${rec.stars}\u2605${trend}${stale}${matched}\n  ${rec.description}\n  install: \`${rec.installCommand}\``
}

function signed(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}`
}

/**
 * Pending-call presentation: a search card titled by the query.
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentSearchPluginsCall(args: { query: string }): GenericCallView {
  return { card: 'generic', title: `Search plugins: ${args.query}`, kind: 'search', rawInput: args.query }
}

/**
 * Completed-call presentation: a generic card carrying the rendered
 * recommendation list under the query title. Returns undefined on failure so
 * the UI falls back to the generic card.
 * @param args - the raw tool arguments; the query becomes the card title.
 * @param result - the final model-facing tool result.
 * @returns the completed generic card view.
 */
export function presentSearchPluginsResult(args: { query: string }, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  return { card: 'generic', title: `Recommended plugins: ${args.query}`, content: result.content }
}

/**
 * Register the `search_plugins` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the registrations.
 * @param config - result-cap config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxResults = config.maxResults ?? DEFAULT_MAX_RESULTS
  assertPositiveInteger('maxResults', maxResults)

  ctx.systemPrompt.section({
    name: 'tool:search_plugins',
    order: 120,
    text: 'Use the search_plugins tool when the user asks for recommended DeepSeek Harness plugins or extensions. It returns plugins ranked by GitHub stars, star trend, and task relevance, each with an install command. Present the top matches with their install command and repository URL as a markdown link, and note when the catalog is small or star counts are stale.',
  })

  ctx.tools.register(defineTool({
    name: 'search_plugins',
    description: 'Search recommended DeepSeek Harness plugins. Returns plugins ranked by GitHub stars, star trend, and relevance to a task, each with an install command.',
    parameters: {
      query: { type: 'string', required: true, description: 'A task description or keywords to match plugins against.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          recommendations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                repo: { type: 'string', required: true },
                description: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                installCommand: { type: 'string', required: true },
                homepage: { type: 'string' },
                stars: { type: 'number', required: true },
                starDelta7d: { type: 'number' },
                starDelta30d: { type: 'number' },
                stale: { type: 'boolean', required: true },
                matchedTags: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          totalCatalogSize: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSearchPluginsOutput(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: presentSearchPluginsCall,
    presentResult: presentSearchPluginsResult,
    async execute(args, exec) {
      const input = parseSearchPluginsArgs(args)
      const recommendations = await ctx.pluginMarket.search(input.query, { maxResults, signal: exec.signal })
      return {
        query: input.query,
        recommendations: recommendations.map(projectRecommendation),
        totalCatalogSize: ctx.pluginMarket.list().length,
      }
    },
  }))
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-plugin-search: ${name} must be a positive integer`)
  }
}
