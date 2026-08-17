/**
 * Package-owned invariant companion for `@justlearner010/dsh-tool-plugin-search`.
 * @module @justlearner010/dsh-tool-plugin-search/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@justlearner010/dsh-tool-plugin-search'

/** Cordis companion plugin name. */
export const name = 'tool-plugin-search-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter has no independent
 * lifecycle stream; execution relations are owned by the plugin-market
 * directory it calls.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
