import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { PluginRecommendation } from '@your-scope/dsh-plugin-market'
import {
  apply,
  formatSearchPluginsOutput,
  parseSearchPluginsArgs,
  presentSearchPluginsCall,
  presentSearchPluginsResult,
} from '@your-scope/dsh-tool-plugin-search'

function recommendation(overrides: Partial<PluginRecommendation> = {}): PluginRecommendation {
  return {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness',
    repo: 'deepseek-ai/deepseek-harness',
    description: 'Plugin-based agent harness on Cordis.',
    tags: ['agent', 'harness'],
    installCommand: 'git clone https://github.com/deepseek-ai/deepseek-harness.git',
    stars: 120,
    stale: false,
    matchedTags: ['agent'],
    score: 5,
    ...overrides,
  }
}

function boot(recs: PluginRecommendation[]): ToolDefinition {
  const registered: ToolDefinition[] = []
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        registered.push(definition)
        return () => {}
      },
    },
    systemPrompt: {
      section() {},
    },
    pluginMarket: {
      async search() {
        return recs
      },
      list() {
        return recs
      },
    },
  } as unknown as Context
  apply(ctx, {})
  const tool = registered[0]
  if (tool === undefined) throw new Error('search_plugins tool was not registered')
  return tool
}

describe('parseSearchPluginsArgs', () => {
  it('rejects a blank query', () => {
    expect(() => parseSearchPluginsArgs({ query: '   ' })).toThrow(/non-empty/)
  })

  it('passes a valid query through', () => {
    expect(parseSearchPluginsArgs({ query: 'agent' })).toEqual({ query: 'agent' })
  })
})

describe('formatSearchPluginsOutput', () => {
  it('renders recommendations with the install command and short-catalog note', () => {
    const text = formatSearchPluginsOutput({
      query: 'agent',
      recommendations: [{
        name: 'DeepSeek Harness',
        repo: 'deepseek-ai/deepseek-harness',
        description: 'Plugin-based agent harness.',
        tags: ['agent'],
        installCommand: 'git clone https://github.com/deepseek-ai/deepseek-harness.git',
        stars: 120,
        stale: false,
        matchedTags: ['agent'],
      }],
      totalCatalogSize: 1,
    })
    expect(text).toContain('DeepSeek Harness')
    expect(text).toContain('git clone https://github.com/deepseek-ai/deepseek-harness.git')
    expect(text).toContain('early days')
  })

  it('omits the top-N note when every catalog entry is shown', () => {
    const text = formatSearchPluginsOutput({
      query: 'agent',
      recommendations: [
        { name: 'A', repo: 'x/y', description: 'd', tags: ['t'], installCommand: 'c', stars: 1, stale: false, matchedTags: [] },
        { name: 'B', repo: 'x/z', description: 'd', tags: ['t'], installCommand: 'c', stars: 1, stale: false, matchedTags: [] },
      ],
      totalCatalogSize: 2,
    })
    expect(text).not.toContain('Showing the top')
  })

  it('notes stale star counts', () => {
    const text = formatSearchPluginsOutput({
      query: 'agent',
      recommendations: [{
        name: 'DeepSeek Harness',
        repo: 'deepseek-ai/deepseek-harness',
        description: 'Plugin-based agent harness.',
        tags: ['agent'],
        installCommand: 'git clone https://github.com/deepseek-ai/deepseek-harness.git',
        stars: 120,
        stale: true,
        matchedTags: [],
      }],
      totalCatalogSize: 3,
    })
    expect(text).toContain('stale')
  })
})

describe('search_plugins tool', () => {
  it('registers and executes against the directory', async () => {
    const tool = boot([recommendation()])
    const output = await tool.execute(
      { query: 'agent' },
      { signal: new AbortController().signal } as unknown as ToolRunContext,
    ) as { query: string; recommendations: { name: string }[]; totalCatalogSize: number }
    expect(output.query).toBe('agent')
    expect(output.totalCatalogSize).toBe(1)
    expect(output.recommendations).toHaveLength(1)
    expect(output.recommendations[0]?.name).toBe('DeepSeek Harness')
  })
})

describe('search_plugins presentation', () => {
  it('presents the pending call as a search card', () => {
    expect(presentSearchPluginsCall({ query: 'agent' })).toEqual({
      card: 'generic',
      title: 'Search plugins: agent',
      kind: 'search',
      rawInput: 'agent',
    })
  })

  it('presents the completed result with the rendered content', () => {
    const view = presentSearchPluginsResult(
      { query: 'agent' },
      { isError: false, content: [{ type: 'text', text: 'DeepSeek Harness' }] } as never,
    )
    expect(view).toEqual({ card: 'generic', title: 'Recommended plugins: agent', content: [{ type: 'text', text: 'DeepSeek Harness' }] })
  })

  it('falls back on a failed result', () => {
    expect(presentSearchPluginsResult({ query: 'agent' }, { isError: true } as never)).toBeUndefined()
  })

  it('notes when only the top results are shown', () => {
    const text = formatSearchPluginsOutput({
      query: 'agent',
      recommendations: [{ name: 'DeepSeek Harness', repo: 'deepseek-ai/deepseek-harness', description: 'd', tags: ['agent'], installCommand: 'git clone x', stars: 120, stale: false, matchedTags: ['agent'] }],
      totalCatalogSize: 20,
    })
    expect(text).toContain('Showing the top 1 of 20')
  })
})

describe('tool-plugin-search coverage', () => {
  it('renders the no-match message', () => {
    const text = formatSearchPluginsOutput({ query: 'x', recommendations: [], totalCatalogSize: 1 })
    expect(text).toContain('No recommended plugins matched the query.')
  })

  it('renders trends with signed deltas', () => {
    const text = formatSearchPluginsOutput({
      query: 'agent',
      recommendations: [{
        name: 'DeepSeek Harness',
        repo: 'deepseek-ai/deepseek-harness',
        description: 'Plugin-based agent harness.',
        tags: ['agent'],
        installCommand: 'git clone https://github.com/deepseek-ai/deepseek-harness.git',
        stars: 120,
        starDelta7d: 5,
        starDelta30d: -3,
        stale: false,
        matchedTags: ['agent'],
      }],
      totalCatalogSize: 3,
    })
    expect(text).toContain('7d +5')
    expect(text).toContain('30d -3')
  })

  it('projects optional fields through execute', async () => {
    const tool = boot([recommendation({
      homepage: 'https://example.com',
      starDelta7d: 5,
      starDelta30d: -3,
    })])
    const output = await tool.execute(
      { query: 'agent' },
      { signal: new AbortController().signal } as unknown as ToolRunContext,
    ) as { recommendations: { homepage?: string; starDelta7d?: number; starDelta30d?: number }[] }
    expect(output.recommendations[0]).toMatchObject({
      homepage: 'https://example.com',
      starDelta7d: 5,
      starDelta30d: -3,
    })
  })

  it('renders the canonical output and reports concurrency safety', async () => {
    const tool = boot([recommendation()])
    const output = await tool.execute(
      { query: 'agent' },
      { signal: new AbortController().signal } as unknown as ToolRunContext,
    )
    const rendered = tool.output.render({ query: 'agent' }, output as JsonValue)
    expect(rendered[0]?.type).toBe('text')
    expect(tool.isConcurrencySafe?.({ query: 'agent' })).toBe(true)
  })

  it('honors an explicit maxResults config', () => {
    const registered: ToolDefinition[] = []
    const ctx = {
      tools: { register(definition: ToolDefinition) { registered.push(definition); return () => {} } },
      systemPrompt: { section() {} },
      pluginMarket: {
        async search() { return [] },
        list() { return [] },
      },
    } as unknown as Context
    apply(ctx, { maxResults: 3 })
    expect(registered).toHaveLength(1)
  })

  it('rejects a non-positive maxResults config', () => {
    const ctx = {
      tools: { register() { return () => {} } },
      systemPrompt: { section() {} },
      pluginMarket: {},
    } as unknown as Context
    expect(() => { apply(ctx, { maxResults: 0 }) }).toThrow(/positive integer/)
  })
})
