/**
 * A very small assertion harness.
 *
 * The repository has no test framework and adding one is out of scope, so this
 * collects results and posts them back to the runner as JSON.
 *
 * Assertions are gathered per test rather than pushed straight to the top
 * level, so one line of output is one behaviour under test. Recording
 * assertions directly would lose the name of every test that passed, leaving a
 * report nobody can read.
 */

export interface TestResult {
  name: string
  passed: boolean
  detail: string
}

const results: TestResult[] = []

/** Failures recorded by the test currently running. */
let failures: string[] = []

function assert(condition: boolean, name: string, detail: string): void {
  if (condition) return

  failures.push(detail === '' ? name : `${name} (${detail})`)
}

export function assertEqual(
  actual: unknown,
  expected: unknown,
  name: string,
): void {
  assert(
    Object.is(actual, expected),
    name,
    `expected ${String(expected)}, got ${String(actual)}`,
  )
}

export function assertTrue(condition: boolean, name: string, detail = ''): void {
  assert(condition, name, detail)
}

export async function run(
  name: string,
  body: () => Promise<void> | void,
): Promise<void> {
  failures = []

  try {
    await body()
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  results.push({
    name,
    passed: failures.length === 0,
    detail: failures.join('; '),
  })
}

export function report() {
  const failed = results.filter((result) => !result.passed).length

  return { total: results.length, failed, results }
}

export function publish(): void {
  const summary = report()
  const output = document.getElementById('out')

  if (output !== null) {
    output.textContent = JSON.stringify(summary, null, 2)
  }

  document.title = summary.failed === 0 ? 'PASS' : `FAIL:${summary.failed}`

  /*
   * The runner passes a callback URL in the query string and waits for the
   * results rather than scraping the DOM.
   *
   * Chrome's --dump-dom cannot be used here: it fires when the virtual time
   * budget is spent, and virtual time races ahead of real asynchronous work
   * such as encoding a canvas or fetching a module, so the page is dumped before
   * the tests have finished.
   *
   * `text/plain` keeps this a simple cross-origin request, so no preflight is
   * needed and the results server stays a few lines long.
   */
  const callback = new URLSearchParams(location.search).get('results')

  if (callback === null) return

  void fetch(callback, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(summary),
  }).catch(() => undefined)
}