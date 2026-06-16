/**
 * @repo/auth — central re-exports.
 *
 * Prefer importing from a specific subpath (`@repo/auth/server`,
 * `@repo/auth/client`, `@repo/auth/admin`, `@repo/auth/proxy`,
 * `@repo/auth/slug`) so bundles stay clean. This index is for convenience.
 */
export * from './types'
export { generateSlug, nextCandidate, isReservedSlug } from './slug'
