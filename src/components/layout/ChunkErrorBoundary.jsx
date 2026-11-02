import { Component } from 'react'

const RELOAD_GUARD_KEY = 'ot-portal:chunk-error-reload'

function isChunkLoadError(error) {
  const message = String(error?.message || error || '')
  return (
    error?.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  )
}

// Jeff, 2026-11-02 (same night): opening the BK page in the installed
// desktop app showed this screen, and pressing Reload just landed back on it.
// A plain window.location.reload() can't fix that case: the new build's
// service worker is sitting in `registration.waiting` (vite.config.js uses
// registerType 'prompt'), and a reload does NOT hand control to a waiting
// worker — the OLD worker keeps controlling the page and serves its
// precached index.html, i.e. the OLD entry script, which asks for the same
// old BK chunk (assets/dev-*.js — deliberately left out of the precache, and
// gone from the server once the new build deployed) and fails the same way.
// So Reload now first makes sure the newest worker is downloaded and tells
// it to take over (the same SKIP_WAITING message swUpdate.js sends); main.jsx's
// controllerchange listener then reloads the page onto the new build.
const WAIT_FOR_UPDATE_MS = 5000
const HANDOVER_BACKSTOP_MS = 5000

function waitForWaitingWorker(reg, ms) {
  return new Promise((resolve) => {
    if (reg.waiting) {
      resolve(true)
      return
    }
    const timer = setTimeout(() => resolve(false), ms)
    const watch = (worker) => {
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (reg.waiting) {
          clearTimeout(timer)
          resolve(true)
        }
      })
    }
    watch(reg.installing)
    reg.addEventListener('updatefound', () => watch(reg.installing))
  })
}

// `allowReset` is only for the Reload button (i.e. the page has already
// failed once): if no newer worker can be found at all, drop this site's
// service worker + caches so the reload below is a genuinely fresh load
// from the network. That also discards the device's push subscription, so
// it's a last resort — the automatic first attempt never does it.
async function refreshToLatestBuild({ allowReset }) {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
    if (reg) {
      try {
        await reg.update()
      } catch {
        /* offline / flaky network — fall through to whatever is waiting */
      }
      if (await waitForWaitingWorker(reg, WAIT_FOR_UPDATE_MS)) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        // main.jsx reloads the page itself on controllerchange; this wait is
        // just so we don't reload underneath the handover. If controllerchange
        // never fires, the reload below is the backstop.
        await new Promise((resolve) => setTimeout(resolve, HANDOVER_BACKSTOP_MS))
      } else if (allowReset) {
        await reg.unregister()
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((key) => caches.delete(key)))
        }
      }
    }
  } catch {
    /* never let recovery itself throw — the reload below still runs */
  }
  window.location.reload()
}

// Jeff, 2026-11-02: "最近有發生兩次登入都會卡白屏，都用把app整個關掉再開才好，
// 新因為有更新的關係嗎" — almost certainly yes. This app's JS is split into
// many small per-page chunks (every lazy() in routes.jsx), and the service
// worker (vite.config.js/swUpdate.js) deliberately WAITS to switch a tab over
// to a newly-downloaded build instead of doing it the instant it's found —
// specifically so it never tears down a login in progress (see main.jsx's
// controllerchange listener holding the reload back while
// criticalSection.isCriticalSectionActive()). That's exactly the narrow
// window that bites: if a chunk request goes out (a route navigating, right
// after a login succeeds, is one of the most common moments) after the new
// service worker has ALREADY taken over but this page is still running the
// OLD build's JS, that chunk's old filename no longer exists on the server —
// Cloudflare Pages only serves the latest deploy's files — so the import()
// 404s. With no ErrorBoundary anywhere, React had nothing to catch that
// crash with, so the whole tree just unmounted to nothing: a blank white
// page with no button, no error, nothing left to click — only a full
// close/reopen forces the genuinely fresh load that resolves it.
//
// This sits one level below the whole app (see App.jsx) and catches exactly
// that crash, plus any other render-time error as a general safety net. A
// recognized chunk-load failure gets ONE automatic, silent reload attempt —
// a real fresh navigation always fetches the current build and current
// service worker state, so it fixes this specific failure every time —
// guarded by sessionStorage so a genuine repeat failure shows the fallback
// screen below instead of reload-looping forever. Any other render error
// always shows the fallback screen directly rather than reloading blind: a
// real bug wouldn't be fixed by a reload, and silently hiding it behind one
// would just make it harder to notice and report.
export default class ChunkErrorBoundary extends Component {
  state = { error: null, busy: false }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    if (!isChunkLoadError(error)) return
    let alreadyTried = false
    try {
      alreadyTried = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'
    } catch {
      // sessionStorage can throw in some embedded/private contexts — treat
      // that the same as "haven't tried yet" rather than crash the error
      // handler itself.
    }
    if (alreadyTried) return
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
    } catch {
      /* best effort — a failed guard write just means a possible extra
         reload later, never a crash here */
    }
    this.setState({ busy: true })
    refreshToLatestBuild({ allowReset: false })
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunkError = isChunkLoadError(this.state.error)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-50/60 px-4 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
          OT
        </div>
        <h1 className="text-lg font-semibold text-brand-900">
          {chunkError ? 'A new version just went live' : 'Something went wrong'}
        </h1>
        <p className="max-w-sm text-sm text-gray-600">
          {chunkError
            ? 'This page was still running an older version when it tried to load something new. Reloading should fix it.'
            : 'The app hit an unexpected error. Reloading usually fixes this — if it keeps happening, let Jeff know.'}
        </p>
        <button
          disabled={this.state.busy}
          onClick={() => {
            try {
              sessionStorage.removeItem(RELOAD_GUARD_KEY)
            } catch {
              /* best effort */
            }
            this.setState({ busy: true })
            refreshToLatestBuild({ allowReset: true })
          }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {this.state.busy ? 'Updating…' : 'Reload'}
        </button>
      </div>
    )
  }
}
