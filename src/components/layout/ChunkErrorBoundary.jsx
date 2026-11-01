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
  state = { error: null }

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
    window.location.reload()
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
          onClick={() => {
            try {
              sessionStorage.removeItem(RELOAD_GUARD_KEY)
            } catch {
              /* best effort */
            }
            window.location.reload()
          }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Reload
        </button>
      </div>
    )
  }
}
