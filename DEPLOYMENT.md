# Deploying CardVault

CardVault is a static, offline-first PWA. There is no server, no database and no
build-time secret: `npm run build` produces a `dist/` directory that can be
served by any static host, and every contact lives in the browser's IndexedDB on
the device that scanned it.

This document covers choosing a host, publishing the app, and the things that
are easy to get wrong when deploying an app whose data never leaves the device.

---

## 1. Host recommendation

**Primary: Cloudflare Pages.** **Fallback: Netlify.**

| | Cloudflare Pages | Netlify | GitHub Pages |
| --- | --- | --- | --- |
| Reads `dist/_headers` | Yes | Yes | **No** |
| Security headers | Yes | Yes | Not configurable |
| SPA fallback needed | No (automatic) | Optional, see `netlify.toml` | Needs a `404.html` trick |
| Custom `Cache-Control` | Yes | Yes | Not configurable |
| HTTPS | Automatic | Automatic | Automatic |
| Cost for this app | Free tier | Free tier | Free |

Cloudflare is first because it needs no configuration at all beyond a build
command and an output directory, and because its own documentation advises
*against* adding custom caching: its CDN already revalidates with ETags, and
adding aggressive rules can pin a stale asset after a deploy.

The deciding factor is `public/_headers`. Cloudflare Pages and Netlify both read
a file with that name from the publish directory using the same syntax, so the
response headers are configured once and work on either host. GitHub Pages cannot
set response headers at all, which would leave `sw.js` and `index.html` on
whatever caching GitHub chooses — the one thing this app cannot afford, because
a cached service worker is a version that never updates.

All three are viable. GitHub Pages is the fallback of the fallback: CardVault
already builds for a subdirectory with `CARDVAULT_BASE`, so it works, but you
give up header control.

Provider documentation was checked in September 2026. Re-check it before a
migration; the relevant pages are Cloudflare's `_headers` and "Serving Pages"
documents, and Netlify's "Custom headers" and "Redirects and rewrites" pages.

## 2. Prerequisites

- Node.js 22 or newer (`netlify.toml` pins `NODE_VERSION = "22"`).
- A Cloudflare or Netlify account. No card is required for either free tier at
  this app's size.

Nothing else. There are no environment variables, no API keys and no `.env`
file — the app has no backend to configure.

## 3. Build

```bash
npm ci
npm run build          # produces dist/
```

`build` runs `tsc -b && vite build`, so a type error fails the build before
anything is published. ESLint is a separate step:

```bash
npm run lint
```

To deploy under a subdirectory such as `https://example.com/cardvault/`:

```bash
CARDVAULT_BASE=/cardvault/ npm run build
```

This rewrites the manifest `id`, `start_url` and `scope`, the service worker
scope, every OCR and asset URL, and the icon paths. **Deploy the contents of
`dist/`, not `dist/` itself**, when you use a subdirectory: either set the
publish directory to `dist` and upload `dist`'s contents, or copy `dist` into a
folder named after the subdirectory and publish that folder.

## 4. Deploy to Cloudflare Pages

1. Create a project and connect it to the repository, or upload a directory.
2. Build command: `npm run build`.
3. Output directory: `dist`.
4. Environment: leave empty. Set `NODE_VERSION` to `22` if the build image
   defaults to something older.
5. Deploy.

To deploy from the command line instead:

```bash
npx wrangler pages deploy dist
```

`public/_headers` is copied into `dist/` by the build, so nothing else is
needed.

## 5. Deploy to Netlify

`netlify.toml` already sets the build command, publish directory and Node
version. Connect the repository and deploy; there is nothing to fill in.

To deploy from the command line:

```bash
npx netlify deploy --prod --dir=dist
```

## 6. GitHub Pages

Only if the header limitation is acceptable.

```bash
CARDVAULT_BASE=/repo-name/ npm run build
```

Copy the contents of `dist/` into `docs/` (or publish `dist/` from a `gh-pages`
branch) and enable Pages for that branch. Because response headers cannot be
set, verify after the first deploy that `sw.js` and `index.html` are not being
served from a long-lived cache — see the troubleshooting section.

## 7. Custom domain and HTTPS

Point a CNAME at the host and let the provider issue a certificate. HTTPS is
required, not optional:

- Service workers only register on a secure context, so over plain HTTP the app
  silently loses offline support and installability.
- Camera capture, persistent storage and the share sheet all require it.

`localhost` counts as secure, which is why local testing works without TLS.

## 8. Response headers

`public/_headers` is the single source of truth and is copied to `dist/_headers`.
It sets `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`, plus
cache rules for the four paths that behave differently:

| Path | Cache-Control | Why |
| --- | --- | --- |
| `/sw.js` | `no-cache` | The worker decides when a version applies. A cached worker is a version that never updates. |
| `/index.html` | `no-cache` | The shell must not disagree with the worker about which assets exist. |
| `/assets/*` | `max-age=31536000, immutable` | Vite fingerprints these names, so their contents never change. |
| `/ocr/*` | `max-age=86400, must-revalidate` | Large, but the filenames are stable across OCR versions. |

**No Content-Security-Policy is shipped, deliberately.** Tesseract.js runs a
WebAssembly core, which needs `script-src 'wasm-unsafe-eval'`; a CSP written
without testing against the real OCR path would break scanning in a way that is
hard to diagnose from a deploy log. Adding one is reasonable, but test a full
scan offline afterwards. The app makes no third-party requests (see the privacy
section), so there is no exfiltration target for a CSP to block today.

## 9. Service worker scope

The worker is registered from `sw.js` at the root of the publish directory, so
its scope is the directory it is served from. Deploying `dist`'s contents at a
domain root gives scope `/`; deploying them under `/cardvault/` gives scope
`/cardvault/`. A worker cannot control paths above its own directory, which is
why a root install and a subdirectory install cannot share one host path.

If the app does not offer to install, check the scope first: it is the most
common cause.

## 10. How updates are applied

The app opts out of automatic activation on purpose. The generated worker uses
`skipWaiting: false` and `clientsClaim: false`, so a new build is downloaded in
the background but is only activated when the user chooses it, and existing
tabs are not taken over mid-scan.

In practice:

1. A deploy replaces `sw.js` and the hashed assets.
2. The browser fetches the new worker on its next visit or on its periodic
   update check, and the app shows "A new version of CardVault is ready".
3. The user selects update when they are at a stopping point.
4. Contacts are unaffected: they live in IndexedDB, not in the worker.

This is the reason `sw.js` must never be cached. If it is, step 1 never happens
and the app is stuck on the old version indefinitely.

## 11. Rollback

CardVault has no server state, so a rollback is a previous deploy.

- **Cloudflare Pages / Netlify:** both keep previous deployments. Promote the
  earlier one; no rebuild is needed.
- **GitHub Pages:** redeploy an earlier commit, or revert the `docs/` content.

Two things to know:

- Rollback does not roll back user data. If a version changed the contact shape,
  contacts written by the newer version stay as they are. The database has been
  at version `1` with a single `contacts` object store throughout; a rollback to
  a build predating that is not supported.
- Users who already activated a newer worker will keep it until they are offered
  the older build again, because activation is user-driven. Expect the rollback
  to reach everyone only after each client re-checks and applies it.

## 12. CDN caching after a deploy

Both primary hosts purge their CDN on deploy. If a stale asset is ever served
after a deploy, purge the cache for the host rather than rebuilding — the build
is not the problem.

## 13. Where the data lives

Every contact is stored in IndexedDB, database `cardvault`, version `1`, object
store `contacts`, in the browser profile of the device that scanned it.

- There is no server copy. Nothing is uploaded.
- Clearing site data, uninstalling the PWA, or using a different browser or
  profile means the contacts are gone.
- Private/incognito windows lose everything when closed.
- Browsers may evict storage under storage pressure. The app requests
  persistent storage via `navigator.storage.persist()`, but this is a request:
  it can be refused, and Safari on iOS decides on its own schedule.

Treat device storage as the only copy unless the user has exported a backup.

## 14. Backing up

The only supported backup is an export from the app:

- **vCard** — one contact per card, imports into iOS Contacts, Google Contacts
  and Outlook. Best for moving between phones.
- **Excel workbook** — one row per contact, grouped into a sheet per company,
  plus a catch-all sheet. Best for checking or editing in a spreadsheet.

Both are generated entirely on the device. On desktop the file is downloaded; on
iOS it goes through the system share sheet, which is the only reliable way to
save a file there — see the iOS section.

## 15. Restoring

There is no in-app import. Restore by handing the file to the platform:

- vCard: open it on the device and confirm "Add Contacts", or import it through
  the Contacts app's own import function.
- Excel: open in a spreadsheet. CardVault cannot read it back.

Contacts restored this way are **not** merged with existing CardVault entries.
They arrive as new contacts, so restoring into a device that already has the
same contacts will create duplicates. Export first, then clear, then restore.

## 16. Offline behaviour

After one successful load the app is fully usable offline: scanning, OCR,
editing, search, delete and export all work with no network. The service worker
precaches the app shell, and the OCR language data is cached on first use.

Limits worth stating plainly:

- The **first** scan needs a connection so the OCR data can be downloaded. The
  Settings screen has a "Prepare for offline use" action that does this ahead of
  time.
- Only the shell is precached: 11 files, about 1.24 MiB. The OCR engine and the
  English model are a further ~15 MB and are cached on first use, which is why
  the first scan is much slower than later ones.
- Installing requires a connection.
- Export works offline; it never needed the network.

## 17. iOS

Untested on physical hardware. Everything below is from vendor documentation
and code paths, not from an iPhone.

- Install via Safari's Share → "Add to Home Screen". iOS does not offer the
  `beforeinstallprompt` event that Android and desktop do, so the in-app install
  button cannot appear on iOS; the guide in the app says so and explains the
  manual route.
- Installed web apps are storage-isolated from Safari, and iOS may evict data
  after roughly seven days of no use. This is an operating-system policy, not
  something the app can override. Export regularly.
- Exports open the system share sheet, because iOS Safari ignores `download` on
  a blob URL for these file types and would otherwise show raw text instead of
  saving a file. The share sheet resolves, is dismissed, or fails differently on
  each platform; the app reports which actually happened, including "nothing was
  saved" when the sheet is dismissed.
- The camera opens through `<input type="file" capture="environment">`, so iOS
  offers the rear camera directly. This is a file picker, not `getUserMedia`,
  which is why `Permissions-Policy: camera=()` does not break scanning.

## 18. Android and desktop

- Chrome and Edge offer an in-app install prompt, which the app uses when it is
  available and hides when it is not.
- Camera capture behaves as on iOS via the same file input.
- Desktop exports download normally. If the browser exposes a share sheet and
  refuses the share, the app falls back to a download and says so.

## 19. Privacy and security posture

- No account, no backend, no telemetry, no analytics, no third-party requests.
- No network request is made with contact data. Exports are asserted to produce
  zero requests by an automated test.
- `tesseract.js` contains a CDN URL as a default; it is never used, because the
  worker core and language data are bundled and served locally. The subpath and
  privacy audits assert that no request leaves the app's own origin.
- Source maps are not published.
- Content is escaped by React; there is no `dangerouslySetInnerHTML`.
- Links to external sites use `rel="noreferrer noopener"`.

## 20. Post-deploy verification

Run these against the deployed URL, not against localhost. Each is a script in
the working tree; set `APP_URL` and `CDP_PORT`.

| Check | Script | Expected |
| --- | --- | --- |
| PWA install, offline, SW | `pwa.cjs` | 77/77 |
| Update lifecycle | `update.cjs` | 16/16 |
| vCard export from the UI | `vcf.cjs` | 62/62 |
| vCard line folding/escaping | `verify.cjs` | 59/59 |
| Real XLSX round trip | `xlsx-roundtrip.cjs` | 43/43 |
| Export delivery honesty | `share-delivery.cjs` | 18/18 |
| Accessibility and mobile | `a11y.cjs` | 40/40 |
| Subdirectory build | `subpath-audit.cjs` | 37/37 |

Use a **fresh browser profile** for each run. A profile that has already
installed the app is still controlled by its previous service worker and will
serve a stale bundle, which makes changes appear to have no effect.

Then confirm by hand:

1. The app installs and the offline badge appears.
2. Scan a card, export it, and open the file.
3. Turn the network off, reload, and repeat the scan.
4. Deploy a no-op build and confirm "A new version is ready" appears and that
   accepting it keeps your contacts.

## 21. Troubleshooting

**No install prompt.** Check the service worker scope, then that the page is
served over HTTPS.

**An update never appears.** `sw.js` is being cached. Confirm the response has
`Cache-Control: no-cache`, or purge the CDN.

**The old version persists after deploying.** A cached worker or shell. Check
both headers, purge, and hard-reload. If a client previously activated the newer
build, expect to wait for it to re-check.

**Blank page after deploy.** The shell and the worker disagree about asset
names. Confirm `/index.html` is `no-cache`.

**OCR fails on first scan.** The language data has not been downloaded yet and
there is no connection. Use "Prepare for offline use".

**Scan fails on a very large photo.** The app downsamples anything over 12
megapixels and reports what it did.

**Contacts missing after reinstalling.** Expected: there is no server copy.
See sections 13 and 14.

## 22. What is not covered

- No physical iPhone or iPad testing. iOS behaviour is documented from vendor
  documentation, not observed.
- No automated contrast audit; colours were checked by computation.
- No automated screen-reader pass. The accessibility suite checks semantics,
  focus order, keyboard operation and live regions, but a screen-reader user
  still needs to confirm announcements are worded usefully.
- No load or soak testing.
- The precached shell is about 1.24 MiB, but a first scan also pulls roughly
  15 MB of OCR engine and language data. On a slow connection the first scan is
  correspondingly slow even though the app itself opened quickly.

## 23. Deploy checklist

- [ ] `npm ci && npm run lint && npm run build` passes locally
- [ ] Fresh profile: PWA, update, export, delivery and accessibility suites pass
- [ ] Subdirectory build audited if deploying under a path
- [ ] `dist/_headers` is present in the upload
- [ ] `sw.js` and `index.html` confirmed `no-cache` on the live host
- [ ] HTTPS confirmed
- [ ] Custom domain serving the same build
- [ ] Install, offline scan and export tested on the deployed URL
- [ ] Previous deployment identified, so a rollback is one click away