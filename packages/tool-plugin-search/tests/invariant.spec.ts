/**
 * Package invariant companion coverage.
 * @module tool-plugin-search-invariant-spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolPluginSearchInvariant from '@your-scope/dsh-tool-plugin-search/invariant'

describe('tool-plugin-search invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ToolPluginSearchInvariant).await()).resolves.toBeDefined()
  })
})
