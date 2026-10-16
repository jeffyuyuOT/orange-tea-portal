import { createClient } from '@supabase/supabase-js'

// These come from Vite env vars so the SAME codebase can be deployed to a
// "test" build and a "production" build simply by supplying different
// environment variables at build/deploy time (e.g. two Cloudflare Pages
// environments, or two `.env` files) — no source file needs to differ
// between environments, unlike the old single-file inventory app pattern.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env.local (for local dev) and fill in your Supabase project credentials.'
  )
}

// Jeff, 2026-10-16: the sign-in "Failed to fetch" issue (see AuthContext.jsx's
// signIn comment for how it was diagnosed — two different people, different
// mobile networks, same day, neither request ever reached Supabase at all)
// isn't really a sign-in-specific problem: EVERY read/write this app makes —
// every table query, every Storage upload/download — goes through this one
// client, so a flaky mobile connection can hit any of them, not just
// signing in. Rather than adding retry logic at every individual call site,
// one custom `fetch` here covers all of them at once.
//
// Only auto-retries a plain `TypeError` — that's specifically what the
// browser's own fetch() throws when the request never got anywhere near the
// network (DNS/connection failure), as opposed to a response Supabase
// actually sent back (a 4xx/5xx, which rejects with a normal Response, not a
// thrown error). Because nothing was ever sent, resending is always safe —
// even for a POST/PATCH, there's no risk of a write landing twice.
//
// Jeff, 2026-10-16 (follow-up): originally left requests with no timeout at
// all, worried an artificial cutoff would cut off this app's own bulk Excel
// imports (BK module, roster) partway through. Jeff corrected that
// assumption — day to day, managers schedule in-app now (Excel upload is
// only ever a one-off, first-time thing) and BK is entered in-app too, so
// a large import is a rare, developer-only event, not something ordinary
// staff logins/page loads need to stay unbounded for. So every request now
// gets a generous 30s timeout instead of none: a hung connection (no error,
// just nothing ever comes back — arguably worse than "Failed to fetch",
// since the UI just spins forever with no error to react to) now fails
// visibly instead of silently stalling. A GET that times out is retried
// (safe — nothing mutated), matching a TypeError retry above; a timed-out
// POST/PATCH is NOT auto-retried, since by then the request may already
// have reached the server and resending blind could double up a write.
const FETCH_TIMEOUT_MS = 30000
const FETCH_MAX_RETRIES = 3
const FETCH_RETRY_BASE_DELAY_MS = 800

async function resilientFetch(input, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), FETCH_TIMEOUT_MS)
    // Honor a caller-supplied signal too, if one's ever passed in, rather
    // than silently overriding it.
    if (init.signal) {
      if (init.signal.aborted) controller.abort(init.signal.reason)
      else init.signal.addEventListener('abort', () => controller.abort(init.signal.reason), { once: true })
    }
    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } catch (err) {
      const method = (init.method ?? 'GET').toUpperCase()
      const isPureNetworkFailure = err instanceof TypeError
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      const safeToRetry = isPureNetworkFailure || (isTimeout && method === 'GET')
      if (!safeToRetry || attempt >= FETCH_MAX_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt))
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  global: { fetch: resilientFetch },
})
