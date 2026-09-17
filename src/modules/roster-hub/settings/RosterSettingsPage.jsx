import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function parseMin(raw) {
  const nums = raw.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
  return nums.length ? Math.min(...nums) : 0
}

export default function RosterSettingsPage() {
  const { currentStoreId } = useAuth()
  const [rules, setRules] = useState([])
  const [form, setForm] = useState({ weekday: 1, label: '', start: '', end: '', counts: '' })

  async function load() {
    const { data } = await supabase
      .from('roster_staffing_rules')
      .select('*')
      .eq('store_id', currentStoreId)
      .order('weekday')
    setRules(data ?? [])
  }

  useEffect(() => {
    if (currentStoreId) load()
  }, [currentStoreId])

  async function addRule() {
    if (!form.label || !form.start || !form.end || !form.counts) return
    await supabase.from('roster_staffing_rules').insert({
      store_id: currentStoreId,
      weekday: Number(form.weekday),
      time_slot_label: form.label,
      time_slot_start: form.start,
      time_slot_end: form.end,
      required_counts_raw: form.counts,
      required_min: parseMin(form.counts),
    })
    setForm({ weekday: 1, label: '', start: '', end: '', counts: '' })
    load()
  }

  async function removeRule(id) {
    await supabase.from('roster_staffing_rules').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Setting</h1>
      <p className="mb-4 text-sm text-gray-500">
        Minimum staffing per weekday + time slot — used for the understaffed warning in Manage Roster. For
        multiple acceptable levels, separate numbers with commas (e.g. "2,3").
      </p>

      <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-brand-100 bg-white p-4 sm:grid-cols-5">
        <select className="input" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
          {WEEKDAYS.map((d, i) => (
            <option key={i} value={i}>
              {d}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Label e.g. Morning" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input type="time" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <input type="time" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <div className="flex gap-1">
          <input className="input" placeholder="2,3" value={form.counts} onChange={(e) => setForm({ ...form, counts: e.target.value })} />
          <Button onClick={addRule}>Add</Button>
        </div>
      </div>

      {!rules.length ? (
        <EmptyState label="No staffing rules set yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-gray-700">
                {WEEKDAYS[r.weekday]} · {r.time_slot_label} ({r.time_slot_start}–{r.time_slot_end}): {r.required_counts_raw}
              </span>
              <button onClick={() => removeRule(r.id)} className="text-gray-400 hover:text-red-500">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
