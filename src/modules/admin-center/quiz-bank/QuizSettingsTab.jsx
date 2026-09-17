import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'

export default function QuizSettingsTab() {
  const { currentStoreId } = useAuth()
  const [questionCount, setQuestionCount] = useState(10)
  const [ratio, setRatio] = useState({ 1: 50, 2: 30, 3: 20 })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentStoreId) return
    supabase
      .from('quiz_settings')
      .select('*')
      .eq('store_id', currentStoreId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setQuestionCount(data.question_count)
          setRatio(data.importance_ratio)
        }
      })
  }, [currentStoreId])

  async function save() {
    setSaving(true)
    await supabase
      .from('quiz_settings')
      .upsert({ store_id: currentStoreId, question_count: questionCount, importance_ratio: ratio }, { onConflict: 'store_id' })
    setSaving(false)
  }

  const total = Number(ratio[1]) + Number(ratio[2]) + Number(ratio[3])

  return (
    <div className="max-w-sm space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Quick Quiz</span>
        <input type="number" className="input" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} />
      </label>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-500">Importance mix (% of questions)</span>
        {[1, 2, 3].map((level) => (
          <div key={level} className="mb-1 flex items-center gap-2">
            <span className="w-32 text-sm text-gray-600">Importance {level}</span>
            <input
              type="number"
              className="input"
              value={ratio[level]}
              onChange={(e) => setRatio((prev) => ({ ...prev, [level]: Number(e.target.value) }))}
            />
            <span className="text-sm text-gray-400">%</span>
          </div>
        ))}
        {total !== 100 && <p className="text-xs text-amber-600">Percentages currently total {total}%, not 100%.</p>}
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}
