import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import PluginMarket, { type PluginEntry } from '@your-scope/dsh-plugin-market'

const DAY_MS = 24 * 60 * 60 * 1000

function entry(overrides: Partial<PluginEntry> = {}): PluginEntry {
  return {
    id: 'sample-plugin',
    name: 'Sample Plugin',
    repo: 'acme/sample-plugin',
    description: 'Sample plugin for testing.',
    tags: ['sample', 'test'],
    installCommand: 'dsh plugin add @acme/dsh-sample',
    ...overrides,
  }
}

function githubResponse(stars: number): Response {
  return new Response(JSON.stringify({ stargazers_count: stars }), { status: 200 })
}

/** Built-in seed ids, in registration order (see SEED_ENTRIES in src/index.ts). */
const SEED_IDS = [
  'deepseek-harness',
  'awesome-deepseek-harness',
  'deepseek-harness-plugins-list',
  'dsh-plugin-hub',
  'dsh-plugin-security-review',
  'dsh-workbench-plugin',
  'dsh-web-ui',
  'dsh-tianshu-tui',
  'dsh-webui-market-plugin',
  'dsh-lark-bot',
  'dsh-win32',
  'dsh-movein',
  'dsh-auth-gate',
  'dsh-neotui',
  'dsh-config-manager',
  'dsh-mcp-apps',
  'dsh-agfs',
  'dsh-plugin-om',
  'dsh-plugin-focus',
  'orgx-dsh-plugin',
]

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plugin-market-'))
  vi.unstubAllGlobals()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

describe('PluginMarket catalog', () => {
  it('seeds the deepseek-harness entry', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    expect(ctx.pluginMarket.list().map(item => item.id)).toEqual(SEED_IDS)
  })

  it('registers and disposes a runtime entry', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const dispose = ctx.pluginMarket.register(entry())
    expect(ctx.pluginMarket.list().map(item => item.id)).toEqual([...SEED_IDS, 'sample-plugin'])
    dispose()
    expect(ctx.pluginMarket.list().map(item => item.id)).toEqual(SEED_IDS)
  })

  it('ignores duplicate ids as first-wins', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const first = ctx.pluginMarket.register(entry())
    const second = ctx.pluginMarket.register(entry({ name: 'Other Name' }))
    const registered = ctx.pluginMarket.list().filter(item => item.id === 'sample-plugin')
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe('Sample Plugin')
    second()
    first()
    expect(ctx.pluginMarket.list().map(item => item.id)).toEqual(SEED_IDS)
  })

  it('rejects an invalid entry', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    expect(() => ctx.pluginMarket.register(entry({ id: 'Bad Id!' }))).toThrow(/invalid id/)
  })
})

describe('PluginMarket search', () => {
  it('fetches stars live and matches task tags', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse(123)))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('agent harness', { maxResults: SEED_IDS.length })
    expect(results).toHaveLength(SEED_IDS.length)
    expect(results[0]).toMatchObject({ id: 'deepseek-harness', stars: 123, stale: false })
    expect(results[0]?.matchedTags).toEqual(expect.arrayContaining(['agent', 'harness']))
  })

  it('ranks a matching registered entry above the seed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse(10)))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    ctx.pluginMarket.register(entry({
      id: 'todo-plugin',
      name: 'Todo Plugin',
      repo: 'acme/todo-plugin',
      description: 'Manage todo lists.',
      tags: ['todo', 'task'],
    }))
    const results = await ctx.pluginMarket.search('todo')
    expect(results[0]?.id).toBe('todo-plugin')
    expect(results[0]?.matchedTags).toContain('todo')
  })

  it('falls back to stale zero stars when fetch fails and no snapshot exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('anything')
    expect(results[0]?.stale).toBe(true)
    expect(results[0]?.stars).toBe(0)
  })

  it('serves a fresh persisted snapshot without a live fetch', async () => {
    const repo = 'deepseek-ai/deepseek-harness'
    await writeFile(join(dir, 'star-snapshots.json'), JSON.stringify({
      repos: { [repo]: [{ time: Date.now() - 1000, stars: 250 }] },
    }))
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => githubResponse(999))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('agent harness')
    const seeded = results.find(item => item.id === 'deepseek-harness')
    expect(seeded?.stars).toBe(250)
    expect(seeded?.stale).toBe(false)
    const urls = fetchMock.mock.calls.map(call => call[0])
    expect(urls).not.toContain('https://api.github.com/repos/deepseek-ai/deepseek-harness')
  })

  it('falls back to an expired persisted snapshot when fetch fails', async () => {
    const repo = 'deepseek-ai/deepseek-harness'
    await writeFile(join(dir, 'star-snapshots.json'), JSON.stringify({
      repos: { [repo]: [{ time: Date.now() - 2 * 60 * 60 * 1000, stars: 200 }] },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('agent harness')
    const seeded = results.find(item => item.id === 'deepseek-harness')
    expect(seeded?.stars).toBe(200)
    expect(seeded?.stale).toBe(true)
  })

  it('computes 7d/30d star deltas from persisted history', async () => {
    const now = Date.now()
    const repo = 'deepseek-ai/deepseek-harness'
    await writeFile(
      join(dir, 'star-snapshots.json'),
      JSON.stringify({
        repos: {
          [repo]: [
            { time: now - 30 * DAY_MS + 1000, stars: 50 },
            { time: now - 7 * DAY_MS + 1000, stars: 100 },
          ],
        },
      }),
    )
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse(120)))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('seed')
    const seeded = results.find(item => item.id === 'deepseek-harness')
    expect(seeded?.stars).toBe(120)
    expect(seeded?.starDelta7d).toBe(20)
    expect(seeded?.starDelta30d).toBe(70)
  })

  it('caps results at maxResults', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse(10)))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    ctx.pluginMarket.register(entry({ id: 'plugin-b', repo: 'acme/plugin-b', tags: ['x'] }))
    ctx.pluginMarket.register(entry({ id: 'plugin-c', repo: 'acme/plugin-c', tags: ['y'] }))
    const results = await ctx.pluginMarket.search('seed', { maxResults: 2 })
    expect(results).toHaveLength(2)
  })
})

describe('PluginMarket edge cases', () => {
  it('defaults the snapshot directory to the harness home and honors cacheTtlMs', async () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const ctx = new Context()
      await ctx.plugin(PluginMarket, { cacheTtlMs: 5000, prewarm: false, refreshIntervalMs: 0 })
      expect(ctx.pluginMarket.list().map(item => item.id)).toEqual(SEED_IDS)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('rejects a non-positive cache TTL', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PluginMarket, { snapshotDir: dir, cacheTtlMs: 0 })).rejects.toThrow(/positive integer/)
  })

  it('rejects a non-positive search result cap', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    await expect(ctx.pluginMarket.search('x', { maxResults: 0 })).rejects.toThrow(/positive integer/)
  })

  it('passes a configured GitHub token to the API', async () => {
    const calls: { headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ headers: (init?.headers as Record<string, string>) ?? {} })
      return githubResponse(10)
    }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, githubToken: 'test-token', prewarm: false, refreshIntervalMs: 0 })
    await ctx.pluginMarket.search('x')
    expect(calls[0]?.headers.Authorization).toBe('Bearer test-token')
  })

  it('degrades to stale on a rate-limited GitHub response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stale).toBe(true)
    expect(results[0]?.stars).toBe(0)
  })

  it('degrades to stale on a non-ok GitHub response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stale).toBe(true)
    expect(results[0]?.stars).toBe(0)
  })

  it('degrades to stale when GitHub omits stargazers_count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stale).toBe(true)
    expect(results[0]?.stars).toBe(0)
  })

  it('rejects a search whose signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('done'))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    await expect(ctx.pluginMarket.search('x', { signal: controller.signal })).rejects.toThrow('done')
  })

  it('rethrows the abort reason when a fetch fails after cancellation', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort(new Error('cancel requested'))
      throw new Error('network down')
    }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    await expect(ctx.pluginMarket.search('x', { signal: controller.signal })).rejects.toThrow('cancel requested')
  })

  it('totalizes a hostile abort reason', async () => {
    const controller = new AbortController()
    const hostile = new Proxy({}, {
      getPrototypeOf() { throw new Error('prototype boom') },
      get(target: object, key: PropertyKey): unknown {
        if (key === Symbol.toPrimitive) throw new Error('primitive boom')
        return Reflect.get(target, key)
      },
    })
    controller.abort(hostile)
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    await expect(ctx.pluginMarket.search('x', { signal: controller.signal })).rejects.toThrow('[unrenderable thrown value]')
  })

  it('ignores an unparseable snapshot file', async () => {
    await writeFile(join(dir, 'star-snapshots.json'), '{not json')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stars).toBe(0)
    expect(results[0]?.stale).toBe(true)
  })

  it('ignores a snapshot file with the wrong shape', async () => {
    await writeFile(join(dir, 'star-snapshots.json'), JSON.stringify({ repos: 'nope' }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stars).toBe(0)
  })

  it('ignores a snapshot entry that is not a star observation', async () => {
    await writeFile(join(dir, 'star-snapshots.json'), JSON.stringify({
      repos: { 'deepseek-ai/deepseek-harness': [{ time: 'x', stars: 5 }] },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stars).toBe(0)
  })

  it('continues with live stars when the snapshot write fails', async () => {
    await writeFile(join(dir, 'blocker'), 'x')
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: join(dir, 'blocker', 'sub'), prewarm: false, refreshIntervalMs: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse(50)))
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stars).toBe(50)
    expect(results[0]?.stale).toBe(false)
  })

  it('breaks score ties by name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse(10)))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    ctx.pluginMarket.register(entry({ id: 'zeta-plugin', name: 'Zeta Plugin', repo: 'acme/zeta-plugin', tags: ['q'] }))
    ctx.pluginMarket.register(entry({ id: 'alpha-plugin', name: 'Alpha Plugin', repo: 'acme/alpha-plugin', tags: ['r'] }))
    const results = await ctx.pluginMarket.search('zzz-no-match', { maxResults: 30 })
    // Equal scores sort by name; the registered Alpha/Zeta entries bound the seed range.
    expect(results[0]?.id).toBe('alpha-plugin')
    expect(results.at(-1)?.id).toBe('zeta-plugin')
  })

  it('defaults the cache TTL when constructed directly without config', () => {
    const market = new PluginMarket(new Context(), { prewarm: false, refreshIntervalMs: 0 })
    expect(market.list().map(item => item.id)).toEqual(SEED_IDS)
  })

  it('serves cached metrics within the TTL', async () => {
    const fetchMock = vi.fn(async () => githubResponse(100))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    await ctx.pluginMarket.search('x')
    await ctx.pluginMarket.search('x')
    expect(fetchMock).toHaveBeenCalledTimes(SEED_IDS.length)
  })

  it('ignores a snapshot file that is not an object', async () => {
    await writeFile(join(dir, 'star-snapshots.json'), '"just a string"')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stars).toBe(0)
  })

  it('ignores non-object snapshot entries', async () => {
    await writeFile(join(dir, 'star-snapshots.json'), JSON.stringify({
      repos: { 'deepseek-ai/deepseek-harness': ['nope'] },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const results = await ctx.pluginMarket.search('x')
    expect(results[0]?.stars).toBe(0)
  })

  it('prewarms the catalog at startup', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => githubResponse(100))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: true, refreshIntervalMs: 0 })
    await vi.waitFor(() => { expect(fetchMock.mock.calls.length).toBe(SEED_IDS.length) })
    // A query now hits the warm cache: no additional live fetches.
    await ctx.pluginMarket.search('agent harness')
    expect(fetchMock.mock.calls.length).toBe(SEED_IDS.length)
  })

  it('refreshes the catalog on a background interval', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => githubResponse(100))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 50 })
    await vi.waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(SEED_IDS.length) })
    await ctx.fiber.dispose()
  })

  it('applies default prewarm and refresh config on direct construction', async () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => githubResponse(100))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      new PluginMarket(ctx)
      // Direct construction skips the schema, so the constructor's own defaults
      // apply: prewarm fires one background fetch per repository.
      await vi.waitFor(() => { expect(fetchMock.mock.calls.length).toBe(SEED_IDS.length) }, { timeout: 5000 })
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('defaults prewarm and the refresh interval when omitted', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => githubResponse(100))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir })
    // Defaults apply: prewarm fires one background fetch per repository.
    await vi.waitFor(() => { expect(fetchMock.mock.calls.length).toBe(SEED_IDS.length) })
    await ctx.fiber.dispose()
  })

  it('rejects a negative refresh interval', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PluginMarket, { snapshotDir: dir, refreshIntervalMs: -1 })).rejects.toThrow(/non-negative/)
  })

  it('rejects entries with invalid fields', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarket, { snapshotDir: dir, prewarm: false, refreshIntervalMs: 0 })
    const invalid: Array<[Partial<PluginEntry>, RegExp]> = [
      [{ id: 'Bad Id!' }, /invalid id/],
      [{ name: '' }, /requires a name/],
      [{ repo: 'norepo' }, /invalid repo/],
      [{ description: '' }, /requires a description/],
      [{ tags: [] }, /at least one tag/],
      [{ tags: [''] }, /empty tag/],
      [{ installCommand: '' }, /requires an installCommand/],
    ]
    for (const [overrides, pattern] of invalid) {
      expect(() => ctx.pluginMarket.register(entry(overrides))).toThrow(pattern)
    }
  })
})
