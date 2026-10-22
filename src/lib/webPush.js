import { supabase } from './supabaseClient'

// Jeff, 2026-10-21: full Web Push. Public VAPID key — not secret, this is
// the same value sent to every browser as the applicationServerKey, and the
// matching private key lives only in the send-push Edge Function's secrets.
const VAPID_PUBLIC_KEY = 'BI0iRe4qobR2_hADrmSanB3iNIpKOLEzFR7ZbHrkxxNrEwfE2GQNk_9SqjTH_yg2q7r3gqLe0pmTbNAtqxCg60Y'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// iOS Safari only exposes the Push API once the PWA has been added to the
// home screen (confirmed via research this session: iOS 16.4+, and only
// from the standalone-launched app — a plain Safari tab is unsupported no
// matter what). This drives the "please add to home screen first" notice.
export function isIosNonStandalone() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  return isIos && !standalone
}

// 'on' = this browser is subscribed AND the subscription is linked to
// `profileId`; 'other' = this browser is subscribed but the link is not to this
// account (RLS only lets an account see its own rows, so a missing row means
// another account — or a stale leftover — owns it). Without a profileId it
// only reports whether the browser itself is subscribed.
export async function getPushPermissionState(profileId) {
  if (!isPushSupported()) return 'unsupported'
  if (isIosNonStandalone()) return 'ios-needs-install'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return 'off'
  if (!profileId) return 'on'
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', sub.endpoint)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) return 'on' // can't tell — behave as before
  return data ? 'on' : 'other'
}

// Link this device to the signed-in account when another account (or a stale
// row) holds the current subscription: the old subscription can't be taken over
// (the row belongs to someone else), so drop the browser's subscription and
// create a fresh one for this account. Must be called from a click.
export async function relinkPush(profileId) {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  await subscribeToPush(profileId)
}

// Must be called from a user-gesture handler (a button's onClick) — both
// Notification.requestPermission() and, on iOS specifically, subscribe()
// itself are rejected outside a direct user gesture.
export async function subscribeToPush(profileId) {
  if (!isPushSupported()) throw new Error('這個瀏覽器不支援推播通知')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('沒有允許通知權限')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: profileId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' }
  )
  if (error) throw error
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}
