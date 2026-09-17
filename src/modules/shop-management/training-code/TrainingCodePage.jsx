import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { currentWeekStart } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'

function randomCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

export default function TrainingCodePage() {
  const { currentStoreId } = useAuth()
  const [code, setCode] = useState(null)
  const [loading, setLoading] = useState(true)
  const weekStart = currentWeekStart()

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const { data } = await supabase
      .from('training_codes')
      .select('*')
      .eq('store_id', currentStoreId)
      .eq('week_start', weekStart)
      .maybeSingle()
    setCode(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [currentStoreId])

  async function generate() {
    const newCode = randomCode()
    await supabase
      .from('training_codes')
      .upsert({ store_id: currentStoreId, week_start: weekStart, code: newCode }, { onConflict: 'store_id,week_start' })
    load()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Training Code</h1>
      <p className="mb-4 text-sm text-gray-500">
        This week's login code for Training accounts at this store (resets weekly).
      </p>

      {loading ? null : (
        <div className="max-w-sm rounded-xl border border-brand-100 bg-white p-6 text-center">
          <p className="text-xs uppercase tracking-wide text-brand-400">Week of {weekStart}</p>
          <p className="my-3 text-5xl font-bold tracking-[0.3em] text-brand-600">{code?.code ?? '----'}</p>
          <Button onClick={generate}>{code ? 'Regenerate code' : 'Generate this week’s code'}</Button>
        </div>
      )}
    </div>
  )
}
