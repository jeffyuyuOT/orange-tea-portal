import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'

// Vote box shown inside a vote-type announcement. One announcement can hold
// several questions, each with its own options and per-person max. Results
// are fetched once when the notice is opened (and again after submitting) —
// no background polling. Deadline + max are enforced server-side by
// cast_vote() (migration 0167).
export default function VotePanel({ announcementId, deadline }) {
  const [questions, setQuestions] = useState([])
  const [picked, setPicked] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const closed = !!deadline && Date.now() > new Date(deadline).getTime()

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('get_vote_results', { p_announcement_id: announcementId })
    setLoading(false)
    if (err) {
      setError(err.message)
      return
    }
    const map = new Map()
    for (const r of data ?? []) {
      if (!map.has(r.question_id)) {
        map.set(r.question_id, { id: r.question_id, title: r.question_title, max: r.question_max, options: [] })
      }
      map.get(r.question_id).options.push({ id: r.option_id, label: r.label, count: Number(r.vote_count), voted: r.voted })
    }
    const list = [...map.values()]
    setQuestions(list)
    setPicked(list.flatMap((q) => q.options.filter((o) => o.voted).map((o) => o.id)))
  }, [announcementId])

  useEffect(() => {
    load()
  }, [load])

  function toggle(q, optionId) {
    if (closed) return
    setError('')
    setDirty(true)
    setPicked((prev) => {
      if (prev.includes(optionId)) return prev.filter((x) => x !== optionId)
      const ids = q.options.map((o) => o.id)
      if (q.max === 1) return [...prev.filter((x) => !ids.includes(x)), optionId]
      if (prev.filter((x) => ids.includes(x)).length >= q.max) {
        setError(`You can choose at most ${q.max} option(s) for "${q.title || 'this question'}".`)
        return prev
      }
      return [...prev, optionId]
    })
  }

  async function submit() {
    setSaving(true)
    setError('')
    const { error: err } = await supabase.rpc('cast_vote', { p_announcement_id: announcementId, p_option_ids: picked })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setDirty(false)
    await load()
  }

  if (loading) return <p className="text-xs text-gray-400">Loading vote…</p>

  return (
    <div className="space-y-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="font-semibold uppercase text-gray-400">Vote</span>
        {deadline && (
          <span className={closed ? 'font-medium text-red-600' : ''}>
            {closed ? 'Closed' : 'Closes'} {new Date(deadline).toLocaleString()}
          </span>
        )}
      </div>

      {questions.map((q) => {
        const total = q.options.reduce((sum, o) => sum + o.count, 0)
        const maxCount = Math.max(1, ...q.options.map((o) => o.count))
        return (
          <div key={q.id}>
            <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-gray-800">
              {q.title && <span>{q.title}</span>}
              <span className="text-xs font-normal text-gray-500">
                Choose up to {q.max} · {total} vote{total === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="space-y-2">
              {q.options.map((o) => (
                <li key={o.id}>
                  <label className={`flex items-center gap-2 text-sm text-gray-700 ${closed ? '' : 'cursor-pointer'}`}>
                    <input type="checkbox" checked={picked.includes(o.id)} disabled={closed} onChange={() => toggle(q, o.id)} />
                    <span className="flex-1">{o.label}</span>
                    <span className="text-xs font-semibold text-gray-600">{o.count}</span>
                  </label>
                  <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded bg-gray-200">
                    <div className="h-full rounded bg-brand-500" style={{ width: `${(o.count / maxCount) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {!questions.length && <p className="text-xs text-gray-400">No options yet.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!closed && questions.length > 0 && (
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={saving || !dirty} className="!px-3 !py-1 !text-xs">
            {saving ? 'Saving…' : picked.length ? 'Submit vote' : 'Clear my vote'}
          </Button>
          {!dirty && picked.length > 0 && <span className="text-xs text-gray-400">Your vote is recorded.</span>}
        </div>
      )}
    </div>
  )
}
