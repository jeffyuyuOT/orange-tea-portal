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

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
