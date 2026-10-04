/**
 * Runs the browser test page in headless Chrome and fails on any failed test.
 *
 * The repository has no test framework and adding one is out of scope, so this
 * uses only what is already installed: Vite to serve the TypeScript, and Chrome
 * to run it.
 *
 * Results come back over a small callback endpoint rather than through Chrome's
 * `--dump-dom`. That flag fires when the virtual time budget is spent, and
 * virtual time races ahead of real asynchronous work, so the page gets dumped
 * while the tests are still running. Chrome is also not killed by that flag, so
 * the process is terminated here once the results arrive.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
]

const TIMEOUT_MS = 180_000

function existsExecutable(path) {
  return new Promise((resolve) => {
    const check = spawn('/bin/sh', ['-c', `test -x "${path}"`])
    check.on('error', () => resolve(false))
    check.on('close', (code) => resolve(code === 0))
  })
}

async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH

  for (const candidate of CHROME_CANDIDATES) {
    if (await existsExecutable(candidate)) return candidate
  }

  return null
}

/** Collects the single POSTed test report. */
function createResultsServer() {
  let resolveReport
  let failReport

  const report = new Promise((resolve, reject) => {
    resolveReport = resolve
    failReport = reject
  })

  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')

    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end()
      return
    }

    let body = ''

    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      try {
        resolveReport(JSON.parse(body))
        response.writeHead(204)
        response.end()
      } catch (error) {
        failReport(error)
        response.writeHead(400)
        response.end()
      }
    })
  })

  return { server, report }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

async function main() {
  const chrome = await findChrome()

  if (chrome === null) {
    console.error('No Chrome executable found. Set CHROME_PATH to run browser tests.')
    process.exit(1)
  }

  const results = createResultsServer()
  const resultsPort = await listen(results.server)

  // The project's own Vite config is used deliberately: the app imports the PWA
  // plugin's virtual module, which only resolves when that plugin is loaded.
  const vite = await createViteServer({
    root: process.cwd(),
    logLevel: 'warn',
    // Bound explicitly: Vite can otherwise listen on ::1 only, and Chrome
    // resolving 127.0.0.1 would then be refused.
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })

  await vite.listen()
  const address = vite.httpServer.address()
  const pagePort = typeof address === 'object' && address !== null ? address.port : 0
  const url =
    `http://127.0.0.1:${pagePort}/test/browser/index.html` +
    `?results=${encodeURIComponent(`http://127.0.0.1:${resultsPort}/results`)}`

  const profile = mkdtempSync(join(tmpdir(), 'cardvault-test-'))

  console.log(`browser tests: ${url.split('?')[0]}`)

  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    `--user-data-dir=${profile}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  browser.stderr.on('data', (chunk) => { stderr += chunk })

  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`browser tests timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    )
  })

  let outcome

  try {
    outcome = await Promise.race([results.report, timeout])
  } catch (error) {
    console.error(error.message)
    console.error(stderr.split('\n').slice(0, 20).join('\n'))
    process.exitCode = 1
    outcome = null
  } finally {
    // Chrome keeps writing to its profile until it has actually exited, so the
    // kill is followed by a wait for the process before the directory is removed.
    // Cleanup is best effort: a leftover temp profile must never fail the run.
    const exited = new Promise((resolve) => browser.once('close', resolve))

    browser.kill('SIGKILL')
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])

    await close(results.server)
    await vite.close()

    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // Ignore: it is in the system temp directory.
    }
  }

  if (outcome === null || outcome === undefined) {
    process.exit(1)
  }

  for (const result of outcome.results) {
    const suffix =
      !result.passed && result.detail !== '' ? `\n          ${result.detail}` : ''
    console.log(`${result.passed ? '  pass' : '  FAIL'}  ${result.name}${suffix}`)
  }

  const passed = outcome.total - outcome.failed

  console.log(`\n${passed}/${outcome.total} browser checks passed`)

  if (outcome.failed > 0) {
    console.error(`\n${outcome.failed} browser check(s) failed.`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})