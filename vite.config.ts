import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * PWA and service-worker configuration.
 *
 * Two decisions matter here:
 *
 * 1. OCR assets are NOT precached. The three WASM variants are ~11 MB together
 *    and the language model is ~2.9 MB, so putting them in the install manifest
 *    would make the first visit enormous for people who never scan a card.
 *    They are served from `<base>/ocr/` and picked up by a cache-first runtime
 *    rule on first use instead, which is what makes OCR work offline after one
 *    run.
 *
 * 2. The worker never calls `skipWaiting` on its own. An update that swaps the
 *    app underneath a half-finished scan is exactly the kind of silent
 *    corruption to avoid, so an update waits for the user to accept it and for
 *    open tabs to be closed.
 *
 * Every URL the worker matches on is derived from BASE rather than written as a
 * root-absolute literal, because the same build has to work both at a domain
 * apex and inside a sub-directory.
 */

// Beige background and green accent, matching --bg / --accent in src/index.css.
const THEME_COLOR = '#2f6f4e'
const BACKGROUND_COLOR = '#f6efe3'

/**
 * Where the app is served from.
 *
 * Defaults to '/', correct for a domain apex or a custom domain. Set
 * CARDVAULT_BASE=/cardvault/ for a host that serves the app from a
 * sub-directory, such as a GitHub Pages project site.
 *
 * Read from the environment rather than hard-coded so one repository can produce
 * both builds: `npm run build` for the apex, `CARDVAULT_BASE=/cardvault/ npm run
 * build` for the sub-path. Nothing else needs to change -- the manifest, the
 * worker's runtime rules and the OCR URLs all derive from this value.
 */
const BASE = normaliseBase(process.env.CARDVAULT_BASE ?? '/')

/** BASE without its trailing slash, for matching path prefixes. Empty at the root. */
const BASE_PREFIX = BASE.slice(0, -1)

/** Forces every match to start at a segment boundary: '' or '/cardvault'. */
const OCR_PATH_PREFIX = `${BASE_PREFIX}/ocr/`
const ASSETS_PATH_PREFIX = `${BASE_PREFIX}/assets/`

/** Escapes a literal path so it can be embedded in a RegExp. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Matches a path prefix for a navigation request.
 *
 * NavigationRoute tests these against `pathname + search`, so the pattern is
 * anchored at the start of the path.
 */
function navigationPathPattern(prefix: string): RegExp {
  return new RegExp(`^${escapeForRegExp(prefix)}`)
}

/**
 * Matches a path prefix for a runtime cache route.
 *
 * Workbox copies a `urlPattern` *function's source text* into the generated
 * worker, so a function matcher cannot refer to anything defined in this file:
 * the name is carried across as an undefined variable and the worker throws
 * while registering its routes, which fails the whole install. That is a
 * silent-at-build-time, fatal-at-runtime failure, so the patterns are RegExps,
 * which serialise as literals.
 *
 * `RegExpRoute` tests against the full `url.href`, so the pattern allows any
 * host and anchors on the path. Matching from the start of the URL also
 * satisfies Workbox's rule that cross-origin requests must match at index 0.
 */
function routePathPattern(prefix: string): RegExp {
  return new RegExp(`^https?://[^/]+${escapeForRegExp(prefix)}`)
}

/**
 * Normalises a configured base to exactly one leading and one trailing slash.
 *
 * Vite accepts '/' , '/cardvault' and './', but the worker rules and the
 * manifest need one predictable spelling, and './' in particular resolves
 * differently inside a service worker than it does in a document.
 */
function normaliseBase(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed === '' || trimmed === '/' || trimmed === './') return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`

  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export default defineConfig({
  // Applies to the dev server, the production build and every asset URL.
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      // The app registers the worker itself, in src/hooks/usePwaUpdate.ts, so the
      // update flow can be surfaced in the UI. The plugin must not inject its own
      // registration script.
      injectRegister: null,
      registerType: 'prompt',
      filename: 'sw.js',
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        // `id` is resolved against the origin, so it must carry the base.
        // Leaving these three at '/' is what previously pinned the app to the
        // origin root: on a sub-path host the manifest declared a start URL and
        // scope the app was never served from.
        id: BASE,
        name: 'CardVault',
        short_name: 'CardVault',
        description:
          'Scan business cards and keep your contacts on your own device.',
        lang: 'en',
        dir: 'ltr',
        start_url: BASE,
        // Serving the base directory means deep links into the single-page app
        // stay in scope.
        scope: BASE,
        display: 'standalone',
        // Not locked to portrait. Locking it made the entire >=48rem layout
        // unreachable on a phone, because standalone is then always portrait.
        orientation: 'any',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        categories: ['productivity', 'utilities', 'business'],
        icons: [
          {
            // Relative on purpose: the manifest is served from `<base>/`, and a
            // relative src resolves against the manifest URL, so it is correct
            // at any base. A leading slash here would pin it to the origin root.
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          // Maskable icons are cropped to a circle or squircle by Android, so
          // the same artwork is supplied with the artwork inside the safe zone.
          {
            src: 'icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Only the shell is precached. Everything else is either hashed
        // (so it can be fetched fresh) or handled by a runtime rule below.
        // PNG icons are deliberately absent: vite-plugin-pwa already adds every
        // entry in `manifest.icons`, and listing them here too would precache
        // each one twice.
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'],
        // OCR payloads are large and versioned by hand, so they are excluded
        // from the precache and cached on demand instead.
        globIgnores: ['**/ocr/**'],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        // Resolved by Workbox relative to the worker script, which is emitted to
        // `<base>/sw.js`, so the bare filename already lands inside the base.
        navigateFallback: 'index.html',
        // Keep navigation requests for the OCR payloads away from the SPA shell.
        // Without this a deep link to an OCR file would be answered with
        // index.html instead of the asset.
        navigateFallbackDenylist: [navigationPathPattern(OCR_PATH_PREFIX)],
        runtimeCaching: [
          {
            // OCR engine, WASM core and language model. Immutable and large, so
            // cache-first is correct: once fetched, never re-download unless the
            // URL changes.
            urlPattern: routePathPattern(OCR_PATH_PREFIX),
            handler: 'CacheFirst',
            options: {
              cacheName: 'cardvault-ocr',
              // Cap the cache so a stale build cannot grow without bound.
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
              // Range requests are how the WASM loader fetches, and they must
              // be allowed to complete rather than fall through to the network.
              rangeRequests: true,
            },
          },
          {
            // Hashed build output. Safe to serve from cache and refresh in the
            // background, because a changed name means a changed file.
            //
            // Matched by path rather than by `request.destination`. The app
            // hosts everything itself -- no CDN, no web fonts -- so every hashed
            // chunk lives under `<base>/assets/`, and the path is both narrower
            // and more reliable: a destination check would also pull in
            // third-party scripts, and it cannot see a plain `fetch()` whose
            // destination is empty.
            urlPattern: routePathPattern(ASSETS_PATH_PREFIX),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cardvault-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Static images and fonts.
            urlPattern: ({ request }) =>
              request.destination === 'image' || request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'cardvault-static',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Exports are produced in memory and handed to the browser through an
        // object URL, so they never reach the network and are never cached.
        // Nothing here should ever store contact data.
        navigateFallbackAllowlist: [
          new RegExp(`^(?!${escapeForRegExp(OCR_PATH_PREFIX)}).*`),
        ],
      },
      devOptions: {
        // Keeps the worker testable from `npm run dev` without pretending a dev
        // server is production-ready.
        enabled: false,
        type: 'module',
      },
    }),
  ],
})