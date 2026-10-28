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

type CdpMessage = {
  id?: number
  method?: string
  result?: unknown
  error?: { message: string }
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

const [pathArg, labelArg] = process.argv.slice(2)
if (!pathArg?.startsWith('/')) {
  console.error('usage: pnpm shots <path> [label]')
  console.error('   eg: pnpm shots /q/patente-b-segnali-di-pericolo quiz-detail')
  process.exit(1)
}

const url = new URL(pathArg, BASE_URL)
const expectedPathname = url.pathname
const label = labelArg ?? slugify(expectedPathname)

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
