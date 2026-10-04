# CardVault

Scan business cards, keep the contacts on your own device, and export them
whenever you want.

Contacts are stored in IndexedDB in the browser. Images are recognised with
Tesseract.js in a Web Worker. Nothing is uploaded, and there is no account,
backend or sync.

## Features

- Capture a card with the camera or pick an image from the device, then let
  on-device OCR fill in the fields.
- Review and correct what was recognised before saving: name, company,
  designation, department, phone, alternate phone, email, website, address,
  city, state, country, LinkedIn and notes.
- Search saved contacts across those fields.
- Open a contact to tap to call or to send email.
- Export every contact, or a selected subset, to vCard (`.vcf`) or Excel
  (`.xlsx`).
- Install to the Home Screen as a PWA, and keep working with no connection once
  it has been opened.
- Updates download in the background and wait, so an in-progress scan is never
  interrupted.
- Settings shows what is stored on the device, how to install, and how to
  prepare the OCR files for offline use.

## Tech stack

- React 19 and TypeScript
- Vite 8, with `vite-plugin-pwa` (Workbox) generating the service worker
- Tesseract.js 7 for OCR, served from `/ocr/` in this repository rather than a
  CDN
- ExcelJS for spreadsheet export
- IndexedDB for storage, behind a small wrapper in `src/lib/db.ts`

There is no server component, no account system and no analytics, and the app
makes no third-party requests at runtime.

## Setup

Requires Node 22 or newer.

```bash
npm install
npm run dev        # dev server (the service worker is off in dev)
```

## Build

```bash
npm run build
```

Type-checks with `tsc -b`, then builds a static site into `dist/`. Because there
is no server component, `dist/` is the whole deployable output.
`npm run preview` serves that build with the service worker enabled.

## Other commands

```bash
npm run lint
npm run icons      # regenerate the app icons from scripts/generate-icons.mjs
npm run sync:ocr   # re-copy the OCR engine and language model into public/ocr
```

## Deploying

CardVault is a static site, so hosting it is a build command and an output
directory. Cloudflare Pages is the recommended host and Netlify is the
documented fallback; `public/_headers` configures the response headers on
either, and `netlify.toml` configures the Netlify build. See
[DEPLOYMENT.md](DEPLOYMENT.md) for host selection, the update and rollback
model, where the data lives, backup and restore, and the post-deploy
verification suite.

## Serving from a sub-directory

By default the build assumes it is served from the root of a domain, which is
the right choice for a custom domain or a host such as Cloudflare Pages that
gives you a root domain. A host that only offers a project sub-directory (a
GitHub Pages project site, for example) needs the base path set at build time:

```bash
CARDVAULT_BASE=/cardvault/ npm run build
```

Every asset URL, the web manifest's `id`/`start_url`/`scope`, the service
worker URL and its scope, and the navigation fallback all follow that value, so
the same source builds both ways with no other change. Contact data is
unaffected: the database name, version and object store are identical either
way, so switching a base path never orphans an existing vault.

Do not hand-edit asset URLs in the source to make a sub-directory build work.
Anything that starts with `/` is silently resolved against the origin root and
will 404. Use `import.meta.env.BASE_URL` through `withBase()` in
`src/lib/paths.ts`.

## Installing as an app

The build is a PWA: it has a web app manifest, a service worker and its own
icons, so it can be added to a Home Screen and will then open like a normal app
with no browser bars.

Settings shows the exact steps for the device it is running on. An install
button only appears when the browser itself offers a `beforeinstallprompt`
event; iOS has no such event, so the Safari Share menu steps are shown there
instead.

## Offline behaviour

Once the app has been opened once, the shell is cached and works with no
connection: browsing, searching, editing, deleting and saving contacts, and
exporting to vCard and Excel.

The OCR engine is deliberately **not** part of the install-time precache,
because the three WASM cores plus the language model are about 15 MB. They are
fetched the first time somebody scans a card and then cached, so scanning works
offline from then on. Settings has a **Prepare for offline use** button that
does this deliberately, and reports honestly whether the files are stored —
it reads the service worker cache rather than guessing.

Contacts live in IndexedDB, not in the cache, so a service worker update can
never disturb them.

### Updating the app

A new deployment is downloaded in the background and then waits. Nothing changes
until the prompt in Settings or the banner at the top of the app is accepted, so
a scan in progress is never interrupted. Dismissing it leaves the current
version running.

## Self-hosted OCR assets

`src/lib/ocr.ts` points Tesseract at `/ocr/` instead of a CDN, and
`public/ocr/` is committed. **After installing or upgrading `tesseract.js`, run
`npm run sync:ocr`.**

That script copies:

| From | To | Why |
| --- | --- | --- |
| `tesseract.js/dist/worker.min.js` | `public/ocr/tesseract-worker.min.js` | the worker |
| `tesseract.js-core/tesseract-core-{relaxedsimd,simd,}-lstm.wasm.js` and `-lstm.wasm.js` | `public/ocr/` | all three cores |
| `eng.traineddata` (repo root) | `public/ocr/eng.traineddata.gz` | English model |

All three cores are shipped because Tesseract feature-detects WASM SIMD support
at runtime and loads exactly one; shipping only the fastest would leave devices
without SIMD unable to recognise anything offline. The `.wasm.js` files embed
their WASM inline, so no separate `.wasm` file is fetched.

If these files are missing or stale, scans fail with a message pointing at
Settings rather than silently falling back to the network.

## Icons

`npm run icons` regenerates `public/icons/*.png` and `public/favicon.svg` from
`scripts/generate-icons.mjs`. The colours are the design tokens: beige
`#f6efe3` and green `#2f6f4e`. Maskable variants keep the artwork inside the
safe zone so Android's circular crop does not clip it.

## Storage

Contacts are stored in IndexedDB (`cardvault`, version 1, store `contacts`).
That survives a refresh, a closed tab and a restart, but **not** clearing site
data, removing the app, or switching device — and private browsing clears
everything when the window closes. Settings says this in the app and recommends
exporting a copy to a file you control.

Exports are generated in memory and handed to the browser through an object URL
that is revoked immediately after the click, so no contact data is ever written
to the cache or to disk by the app.