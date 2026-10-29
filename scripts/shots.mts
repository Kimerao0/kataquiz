// The client tests run in jsdom, which computes no layout, so nothing in the
// pipeline can see what a page looks like. This script is the missing pair of
// eyes: it drives the installed Chrome over the DevTools Protocol and files
// full-page screenshots at three widths in both colour schemes.
//
// It is deliberately not part of `pnpm check`, CI or any hook. A headless
// browser must never stand between a correct change and a commit.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// localhost, not 127.0.0.1: Next only hydrates on the origin it was started
// for, so photographing 127.0.0.1 gives a rendered page where React never
// attached. Every interactive state would silently be a picture of a dead
// page — and it looks identical to a live one.
const BASE_URL = 'http://localhost:3000'
const CHROME_BINARY = '/usr/bin/google-chrome'
const SHOTS_DIR = 'shots'
const CHROME_START_TIMEOUT_MS = 15_000
const PAGE_LOAD_TIMEOUT_MS = 30_000
const SETTLE_MS = 400

// The copy a scenario presses is read from the catalogue rather than written
// out here: that file is the only place the words exist, and a reworded button
// should fail loudly instead of quietly turning a scenario into a timeout.
const MESSAGES_FILE = 'messages/en.json'
// Longer than `ADVANCE_LOCK_MS` in src/components/run/run-player.tsx, which is
// 300ms: a click sooner than the lock is swallowed on purpose, so the driver
// has to be slower than it, never faster. Copied and not imported — the real
// one lives in a 'use client' component.
const ADVANCE_LOCK_WAIT_MS = 500
const SCENARIO_STEP_TIMEOUT_MS = 15_000
const SCENARIO_POLL_MS = 100
// A run is a few dozen questions at most. The cap is only here so a scenario
// that stops making progress ends as an error instead of spinning.
const MAX_QUESTIONS = 100

// Phone, tablet, laptop. The height is only the window the page lays out in —
// every capture is full-page regardless, so vh units still read as they would
// on the device.
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  // The owner's own display is ~2000px wide. Stopping at 1440 is how a page
  // ends up as a narrow column floating in a void that nobody photographed.
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]
const SCHEMES = ['light', 'dark'] as const

// Measures the three numbers the next step needs: how much of the viewport the
// content actually fills, how tall the page is, and how many text nodes sit
// inside it as a crude density signal.
const MEASURE_EXPRESSION = `(() => {
  const mains = Array.from(document.querySelectorAll('main'))
  const first = document.body.firstElementChild
  const roots = mains.length > 0 ? mains : first ? [first] : []

  let contentWidth = 0
  let textNodes = 0
  for (const root of roots) {
    contentWidth = Math.max(contentWidth, root.getBoundingClientRect().width)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue
      if (text && text.trim() !== '') textNodes += 1
    }
  }

  return {
    contentWidth,
    viewportWidth: window.innerWidth,
    pageHeight: document.documentElement.scrollHeight,
    textNodes,
  }
})()`

// What tells Next's not-found page apart from the page that was asked for. The
// obvious check is the response status and it does not work: a dead /q/<slug>
// answers HTTP 200, because `notFound()` is thrown inside a Suspense boundary
// after streaming has already started (docs/roadmap.md, "Accepted"). The
// pathname assertion misses it too — not-found renders at the requested path.
// What is left is the robots meta: Next marks a not-found page noindex, and
// nothing in this app does so on purpose. Do not simplify this back.
const NOINDEX_EXPRESSION = `Array.from(document.querySelectorAll('meta[name="robots"]')).some(
  (meta) => (meta.getAttribute('content') ?? '').toLowerCase().includes('noindex'),
)`

// The handles a scenario takes on the page, installed once per load. Every
// lookup is by the copy a player reads rather than by a CSS path, so a restyle
// cannot quietly break the driver.
const DRIVER_HELPERS = `
  window.__shots = {
    button: (text) =>
      Array.from(document.querySelectorAll('button')).find(
        (element) => element.textContent.trim() === text,
      ) ?? null,
    // Scoped to .drill-main, and the scope is the whole point: the start
    // panel's nickname field owns a label[for] of its own that is still on
    // screen while the run mounts, so an unscoped "first label" click lands
    // there, answers nothing, and the driver waits for a feedback panel that
    // is never coming.
    options: () => Array.from(document.querySelectorAll('.drill-main label[for]')),
    picked: () => document.querySelector('.drill-main [data-checked]') !== null,
  }
  true
`

type CdpMessage = {
  id?: number
  method?: string
  result?: unknown
  error?: { message: string }
}

/** The run copy a scenario presses, exactly as the player reads it. */
type RunCopy = {
  begin: string
  confirm: string
  next: string
  seeResult: string
  summaryTitle: string
}

type Scenario = {
  /** Whether to play the run out, or stop on the first feedback panel. */
  playToTheEnd: boolean
  /**
   * The page expression that proves the promised state actually arrived. A
   * scenario that failed still photographs perfectly, which is the whole
   * danger: every viewport and scheme pair starts a run of its own, so they
   * land in quick succession and the rate limiter is a realistic way for one
   * of them to end on an error alert that photographs like a screen.
   */
  arrived: (copy: RunCopy) => string
}

type Measurement = {
  contentWidth: number
  viewportWidth: number
  pageHeight: number
  textNodes: number
}

type Row = {
  file: string
  contentPercent: number
  pageHeight: number
  textNodes: number
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

// Copy enters a page expression as a literal, never spliced in raw: an
// apostrophe in a translation would otherwise be a syntax error in the page.
const js = (value: string) => JSON.stringify(value)

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  try {
    return await Promise.race([promise, expiry])
  } finally {
    clearTimeout(timer)
  }
}

function slugify(path: string) {
  const slug = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
  return slug === '' ? 'home' : slug
}

// Chrome writes the port it actually bound to into the profile directory, which
// is the only way to learn it when we asked for an ephemeral one.
async function readDevToolsPort(userDataDir: string, hasExited: () => boolean) {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + CHROME_START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (hasExited()) throw new Error('Chrome exited before it reported a DevTools port.')
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').split('\n')
      if (/^\d+$/.test(port)) return Number(port)
    }
    await delay(50)
  }

  throw new Error(`Chrome did not report a DevTools port within ${CHROME_START_TIMEOUT_MS}ms.`)
}

async function openPageSocket(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = (await response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome exposed no page target to drive.')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('DevTools socket failed to open.')), {
      once: true,
    })
  })

  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (e: Error) => void }
  >()
  const waiters = new Map<string, Array<() => void>>()

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    const message = JSON.parse(event.data) as CdpMessage

    if (typeof message.id === 'number') {
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.error) call.reject(new Error(message.error.message))
      else call.resolve(message.result)
      return
    }

    if (message.method) {
      const queue = waiters.get(message.method)
      if (!queue) return
      waiters.delete(message.method)
      for (const resolve of queue) resolve()
    }
  })

  // Without this a dying Chrome leaves every in-flight call hanging forever.
  socket.addEventListener('close', () => {
    for (const call of pending.values()) call.reject(new Error('DevTools socket closed.'))
    pending.clear()
  })

  function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    nextId += 1
    const id = nextId
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (result) => resolve(result as T), reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  function once(method: string) {
    return new Promise<void>((resolve) => {
      const queue = waiters.get(method) ?? []
      queue.push(resolve)
      waiters.set(method, queue)
    })
  }

  async function evaluate<T>(expression: string): Promise<T> {
    const response = await send<{ result: { value?: T }; exceptionDetails?: { text: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    if (response.exceptionDetails) {
      throw new Error(`Page script failed: ${response.exceptionDetails.text}`)
    }
    return response.result.value as T
  }

  return { socket, send, once, evaluate }
}

type Page = Awaited<ReturnType<typeof openPageSocket>>

// Every graded question is on screen with one of these two buttons under it:
// the last question offers the summary where the others offer the next one.
const feedbackShown = (copy: RunCopy) =>
  `__shots.button(${js(copy.next)}) !== null || __shots.button(${js(copy.seeResult)}) !== null`

// The interactive states worth a photograph, and deliberately not a step DSL:
// this app has exactly these two, and a generic driver would be a second,
// vaguer description of a run that already has one shape.
const SCENARIOS: Record<'answer' | 'summary', Scenario> = {
  // Stops with the feedback panel open on question one. The verdict, the
  // struck-through wrong option and the explanation exist nowhere else.
  answer: { playToTheEnd: false, arrived: feedbackShown },
  // The summary exists only once every question has been graded, which is why
  // a script that loads a URL and stops could never reach it.
  summary: {
    playToTheEnd: true,
    arrived: (copy) => `document.body.innerText.includes(${js(copy.summaryTitle)})`,
  },
}

type ScenarioName = keyof typeof SCENARIOS

function isScenarioName(value: string | undefined): value is ScenarioName {
  return value !== undefined && value in SCENARIOS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function runString(run: Record<string, unknown>, key: string) {
  const value = run[key]
  if (typeof value !== 'string') {
    throw new Error(`${MESSAGES_FILE} has no run.${key} string for the driver to press.`)
  }
  return value
}

function readRunCopy(): RunCopy {
  const parsed: unknown = JSON.parse(readFileSync(MESSAGES_FILE, 'utf8'))
  const run = isRecord(parsed) ? parsed.run : undefined
  if (!isRecord(run)) throw new Error(`${MESSAGES_FILE} has no "run" section to read copy from.`)

  return {
    begin: runString(run, 'begin'),
    confirm: runString(run, 'confirm'),
    next: runString(run, 'next'),
    seeResult: runString(run, 'seeResult'),
    summaryTitle: runString(run, 'summaryTitle'),
  }
}

// The first screenful of what the page actually says. Every failure below is
// one a photograph would hide, so the operator is handed the words instead —
// the rate-limit alert, or the start error, rather than a picture of it.
async function pageText(page: Page) {
  const text = await page.evaluate<string>('document.body.innerText.slice(0, 400)')
  return `The page says: ${text}`
}

// Polling, because every state a scenario waits for is a React render and
// there is no protocol event that fires for one.
async function reachedWithin(page: Page, expression: string) {
  const deadline = Date.now() + SCENARIO_STEP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await page.evaluate<boolean>(expression)) return true
    await delay(SCENARIO_POLL_MS)
  }
  return false
}

async function waitInPage(page: Page, expression: string, what: string) {
  if (await reachedWithin(page, expression)) return
  throw new Error(`Waited ${SCENARIO_STEP_TIMEOUT_MS}ms for ${what}. ${await pageText(page)}`)
}

async function answerQuestion(page: Page, copy: RunCopy, answered: number) {
  const position = answered + 1
  await waitInPage(page, '__shots.options().length > 0', `the options of question ${position}`)

  // Rotating the pick rather than always taking the first: a summary where
  // every answer is right, or every one wrong, is not the screen worth looking
  // at.
  await page.evaluate(`(() => {
    const options = __shots.options()
    options[${answered} % options.length].click()
  })()`)

  // A multi-answer question commits only when its Confirm button is pressed; a
  // single or boolean one has already committed on the click above. The button
  // is on screen from the moment the question is, so its presence is what
  // tells the two kinds apart.
  const confirm = `__shots.button(${js(copy.confirm)})`
  if (await page.evaluate<boolean>(`${confirm} !== null`)) {
    // Confirm submits the set React has recorded, so pressing it before the
    // click has landed in state would submit an empty answer.
    await waitInPage(page, '__shots.picked()', `the pick on question ${position}`)
    await page.evaluate(`${confirm}.click()`)
  }

  await waitInPage(page, feedbackShown(copy), `the feedback on question ${position}`)
}

async function playScenario(page: Page, name: ScenarioName, copy: RunCopy) {
  const scenario = SCENARIOS[name]

  await page.evaluate(DRIVER_HELPERS)
  await waitInPage(page, `__shots.button(${js(copy.begin)}) !== null`, 'the Begin button')
  await page.evaluate(`__shots.button(${js(copy.begin)}).click()`)

  for (let answered = 0; answered < MAX_QUESTIONS; answered += 1) {
    await answerQuestion(page, copy, answered)
    if (!scenario.playToTheEnd) break

    const last = await page.evaluate<boolean>(`__shots.button(${js(copy.seeResult)}) !== null`)
    await page.evaluate(`__shots.button(${js(last ? copy.seeResult : copy.next)}).click()`)
    if (last) break
    await delay(ADVANCE_LOCK_WAIT_MS)
  }

  // Polled rather than read once: the screen the last click asked for is still
  // a React render away from the click itself.
  if (await reachedWithin(page, scenario.arrived(copy))) return
  throw new Error(
    `The ${name} scenario never reached its state — refusing to photograph it. ${await pageText(page)}`,
  )
}

const args = process.argv.slice(2)
const positional: string[] = []
let scenarioArg: string | undefined
let allowNoindex = false

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--allow-noindex') {
    allowNoindex = true
    continue
  }
  if (arg === '--play') {
    index += 1
    scenarioArg = args[index]
    continue
  }
  positional.push(arg)
}

const [pathArg, labelArg] = positional
if (!pathArg?.startsWith('/') || (scenarioArg !== undefined && !isScenarioName(scenarioArg))) {
  console.error(
    `usage: pnpm shots <path> [label] [--play ${Object.keys(SCENARIOS).join('|')}] [--allow-noindex]`,
  )
  console.error('   eg: pnpm shots /q/patente-b-segnali-di-pericolo quiz-detail')
  console.error('   eg: pnpm shots /q/patente-b-segnali-di-pericolo/run feedback --play answer')
  console.error('   eg: pnpm shots /q/patente-b-segnali-di-pericolo/run summary --play summary')
  console.error('   eg: pnpm shots /q/patente-b-segnali-di-pericolo detail --allow-noindex')
  process.exit(1)
}

const url = new URL(pathArg, BASE_URL)
const expectedPathname = url.pathname
const label = labelArg ?? slugify(expectedPathname)
// Read once, before Chrome starts: a key missing from the catalogue is a
// complaint about the catalogue, not something to meet halfway through the
// ninth screenshot.
const play = scenarioArg === undefined ? null : { name: scenarioArg, copy: readRunCopy() }

mkdirSync(SHOTS_DIR, { recursive: true })

const userDataDir = mkdtempSync(join(tmpdir(), 'kataquiz-shots-'))
const chrome = spawn(
  CHROME_BINARY,
  [
    '--headless=new',
    '--hide-scrollbars',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let exited = false
chrome.on('exit', () => {
  exited = true
})

let socket: WebSocket | undefined
let cleaned = false
async function cleanUp() {
  if (cleaned) return
  cleaned = true
  socket?.close()
  if (!exited) {
    const stopped = new Promise<void>((resolve) => {
      chrome.once('exit', () => resolve())
    })
    chrome.kill('SIGKILL')
    // Chrome flushes its profile on the way out, so removing the directory
    // before it is gone only lets it write the files straight back.
    await Promise.race([stopped, delay(2000)])
  }
  rmSync(userDataDir, { recursive: true, force: true })
}

// Last resort for a path that never reaches the `finally` below. A leaked
// headless Chrome on a dev machine is a real cost; a leftover temp dir is not.
process.on('exit', () => {
  if (!exited) chrome.kill('SIGKILL')
})
process.on('SIGINT', () => {
  void cleanUp().then(() => process.exit(130))
})
process.on('SIGTERM', () => {
  void cleanUp().then(() => process.exit(143))
})

const rows: Row[] = []

try {
  const port = await readDevToolsPort(userDataDir, () => exited)
  const page = await openPageSocket(port)
  socket = page.socket

  await page.send('Page.enable')

  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      })

      const loaded = page.once('Page.loadEventFired')
      const navigation = await page.send<{ errorText?: string }>('Page.navigate', {
        url: url.href,
      })
      if (navigation.errorText) {
        throw new Error(`Could not load ${url.href}: ${navigation.errorText}`)
      }
      await withTimeout(loaded, PAGE_LOAD_TIMEOUT_MS, `${url.href} did not finish loading.`)
      await page.evaluate('document.fonts.ready.then(() => true)')
      await delay(SETTLE_MS)

      // A screenshot of the wrong page is worse than no screenshot, because it
      // gets believed. A redirect to /signin must stop the run, not be filed as
      // evidence of the page that was asked for.
      const pathname = await page.evaluate<string>('location.pathname')
      if (pathname !== expectedPathname) {
        throw new Error(
          `Asked for ${expectedPathname} but landed on ${pathname} — refusing to photograph it.`,
        )
      }

      // See NOINDEX_EXPRESSION: the pathname above cannot see a not-found page,
      // and neither can a response status.
      if (!allowNoindex && (await page.evaluate<boolean>(NOINDEX_EXPRESSION))) {
        throw new Error(
          `${url.href} is Next's not-found page — refusing to photograph it. A seeded slug carries a generated suffix, so check the one you asked for; pass --allow-noindex if this page is meant to be noindexed.`,
        )
      }

      // Each pair re-navigates, so the scenario is replayed on every load.
      // That is the cost of photographing a state only a live run produces,
      // and it is cheaper than carrying one run across viewport changes.
      if (play !== null) {
        await playScenario(page, play.name, play.copy)
        // The arrival assertion only proves the DOM is there; what has just
        // replaced the options still has to be laid out and painted.
        await delay(SETTLE_MS)
      }

      const measurement = await page.evaluate<Measurement>(MEASURE_EXPRESSION)
      const metrics = await page.send<{ cssContentSize: { width: number; height: number } }>(
        'Page.getLayoutMetrics',
      )

      const shot = await page.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: metrics.cssContentSize.width,
          height: metrics.cssContentSize.height,
          scale: 1,
        },
      })

      const file = join(SHOTS_DIR, `${label}-${viewport.width}-${scheme}.png`)
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
      console.log(`wrote ${file}`)

      rows.push({
        file,
        contentPercent: (measurement.contentWidth / measurement.viewportWidth) * 100,
        pageHeight: measurement.pageHeight,
        textNodes: measurement.textNodes,
      })
    }
  }

  const fileColumn = Math.max(...rows.map((row) => row.file.length))
  console.log('')
  console.log(
    `${'shot'.padEnd(fileColumn)}  ${'content%'.padStart(8)}  ${'height'.padStart(7)}  ${'text'.padStart(5)}`,
  )
  for (const row of rows) {
    console.log(
      `${row.file.padEnd(fileColumn)}  ${`${row.contentPercent.toFixed(1)}%`.padStart(8)}  ${String(
        Math.round(row.pageHeight),
      ).padStart(7)}  ${String(row.textNodes).padStart(5)}`,
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await cleanUp()
}
