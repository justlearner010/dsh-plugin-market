/**
 * Package invariant companion coverage.
 * @module plugin-market-invariant-spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PluginMarketInvariant from '@justlearner010/dsh-plugin-market/invariant'

describe('plugin-market invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PluginMarketInvariant).await()).resolves.toBeDefined()
  })
})
