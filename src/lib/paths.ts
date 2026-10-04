/**
 * Where the app is served from.
 *
 * The same build has to work at a domain apex and inside a sub-directory, such
 * as a GitHub Pages project site. Vite substitutes `import.meta.env.BASE_URL`
 * at build time from the `base` option, which is configured once in
 * `vite.config.ts` through the `CARDVAULT_BASE` environment variable.
 *
 * Nothing else in the app should hard-code a leading slash for a bundled asset:
 * a root-absolute URL silently points at the origin root and 404s the moment the
 * app is served from a sub-path.
 */

/**
 * Deployment base path, always with a leading and a trailing slash.
 *
 * `'/'` for an apex or custom domain, `'/cardvault/'` for a sub-directory.
 */
export const BASE_PATH = import.meta.env.BASE_URL

/**
 * Joins a path onto the deployment base.
 *
 * The leading slash on `path` is optional, so both `withBase('ocr')` and
 * `withBase('/ocr')` resolve to `<base>/ocr`.
 *
 * `import.meta.env` is absent when this module is loaded outside a Vite build
 * (a plain Node unit test), so the base falls back to `'/'` rather than
 * producing `undefined/ocr`.
 */
export function withBase(path: string): string {
  const base =
    typeof import.meta.env === 'object' && import.meta.env !== null &&
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/'

  return `${base}${path.replace(/^\/+/, '')}`
}