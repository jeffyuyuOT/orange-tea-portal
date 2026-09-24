import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'

// Mirrors QuizSettingsTab (Quick Quiz), but reads/writes formal_quiz_settings
// instead of quiz_settings — the two quiz types' settings shapes diverge
// (this one adds fill_in_blank_ratio), so they're kept as separate tables
// rather than one table with a quiz_type column.
export default function FormalQuizSettingsTab() {
  const { currentStoreId } = useAuth()
  const [questionCount, setQuestionCount] = useState(30)
  const [ratio, setRatio] = useState({ 1: 50, 2: 30, 3: 20 })
  const [fillBlankRatio, setFillBlankRatio] = useState(20)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentStoreId) return
    supabase
      .from('formal_quiz_settings')
      .select('*')
      .eq('store_id', currentStoreId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setQuestionCount(data.question_count)
          setRatio(data.importance_ratio)
          setFillBlankRatio(data.fill_in_blank_ratio)
        }
      })
  }, [currentStoreId])

  async function save() {
    setSaving(true)
    await supabase.from('formal_quiz_settings').upsert(
      {
        store_id: currentStoreId,
        question_count: questionCount,
        importance_ratio: ratio,
        fill_in_blank_ratio: fillBlankRatio,
      },
      { onConflict: 'store_id' }
    )
    setSaving(false)
  }

  const total = Number(ratio[1]) + Number(ratio[2]) + Number(ratio[3])

  return (
    <div className="max-w-sm space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Formal Quiz</span>
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

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Formula fill-in-the-blank questions (% of Quick Quiz)</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="input"
            value={fillBlankRatio}
            onChange={(e) => setFillBlankRatio(Number(e.target.value))}
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          This share of the Formal Quiz is auto-generated "fill in the ingredient quantity" questions from Formula
          Database recipes. The rest is ordinary multiple choice pulled from the Quiz Bank, same as Quick Quiz.
        </p>
      </label>

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}
