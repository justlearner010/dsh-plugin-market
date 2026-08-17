/**
 * Package-owned invariant companion for `@your-scope/dsh-plugin-market`.
 * @module @your-scope/dsh-plugin-market/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@your-scope/dsh-plugin-market'

/** Cordis companion plugin name. */
export const name = 'plugin-market-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this catalog directory publishes no session event
 * stream, and its only durable state (the star-snapshot file) is an internal
 * cache owned and replayed by the service itself rather than a model-visible
 * relationship an invariant can check.
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
