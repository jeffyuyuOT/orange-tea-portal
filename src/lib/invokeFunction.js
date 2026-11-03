import { supabase } from './supabaseClient'

// Jeff, 2026-11-03: calls a Supabase Edge Function and hands back the
// function's OWN error text. supabase-js's own error for a non-2xx reply is
// just "Edge Function returned a non-2xx status code" — the useful message
// (e.g. "That email already has an account") sits in the response body.
// Returns { data, error } where `error` is a plain string or null.
export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error && !data?.error) return { data, error: null }
  let message = data?.error
  if (!message && error) {
    try {
      message = (await error.context.json())?.error
    } catch {
      message = error.message
    }
  }
  return { data: null, error: message || 'Request failed.' }
}
