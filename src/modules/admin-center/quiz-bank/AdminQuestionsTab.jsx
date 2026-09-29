import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import QuestionEditModal from '../../shop-management/training-centre/quiz-bank/QuestionEditModal'

const TYPE_LABEL = { single: 'Single choice', multi: 'Multi choice', fill_blank: 'Fill in the blank' }

// Jeff, 2026-09: "admin centre下還是要有admin quiz bank" — the shared,
// centrally-managed tier of the Quiz Bank: questions with store_id IS NULL
// (migration 0073_admin_quiz_bank_and_shop_training_progress.sql), authored
// here by admin/developer only (RLS already restricts writing a
// null-store_id row to is_admin() — see that migration's comment). Every
// store's Training Centre > Quiz Bank ("Branch Quiz Bank",
// shop_management/training-centre/quiz-bank/QuizBankPage.jsx) shows these
// same rows read-only alongside its own store-owned questions, and Quick
// Quiz/Formal Quiz draw from both pools together.
//
// No "shop_training" group here (unlike the Branch Quiz Bank) — Shop
// Training content is store-owned outright (migration 0052), so there's no
// shared/admin-level shop_training_items to link a shared question to; that
// linking only makes sense at the branch level. No "Copy to store…" here
// either — an admin bank question is already visible everywhere by being
// in this bank; copying it into a specific store's own bank as an
// independent row isn't a thing Jeff asked for.
const GROUPS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
]

export default function AdminQuestionsTab() {
  const [group, setGroup] = useState('drink')
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [questions, setQuestions] = useState([])
  const [editing, setEditing] = useState(null)
  const [removingId, setRemovingId] = useState(null)

  useEffect(() => {
    if (group === 'drink') {
      supabase
        .from('formula_categories')
        .select('*')
        .eq('group_key', 'drink')
        .order('sort_order')
        .then(({ data }) => {
          setCategories(data ?? [])
          setCategoryId(data?.[0]?.id ?? '')
        })
    } else {
      setCategories([])
      setCategoryId('')
    }
  }, [group])

  async function load() {
    // store_id IS NULL is what makes a question "admin bank" rather than a
    // branch bank row — see the migration comment above.
    let q = supabase.from('quiz_questions').select('*').eq('group_key', group).is('store_id', null)
    if (group === 'drink') {
      if (!categoryId) return setQuestions([])
      q = q.eq('category_id', categoryId)
    }
    const { data } = await q.order('created_at', { ascending: false })
    setQuestions(data ?? [])
  }
  useEffect(() => {
    load()
  }, [group, categoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id) {
    if (!confirm('Delete this question? It disappears from every store\'s Quiz Bank.')) return
    setRemovingId(id)
    await supabase.from('quiz_questions').delete().eq('id', id)
    await load()
    setRemovingId(null)
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        These questions are shared with every store — each one's Training Centre &gt; Quiz Bank shows them read-only,
        alongside that store's own Branch Quiz Bank. Quick Quiz and Formal Quiz draw from both together.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-40" value={group} onChange={(e) => setGroup(e.target.value)}>
          {GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
        {group === 'drink' && (
          <select className="input w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Button className="ml-auto" onClick={() => setEditing({})}>
          + New Question
        </Button>
      </div>

      {!questions.length ? (
        <EmptyState label="No questions in this category yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {questions.map((q) => (
            <div key={q.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <button onClick={() => setEditing(q)} className="flex flex-1 items-center gap-2 text-left">
                {q.image_path && (
                  <img
                    src={supabase.storage.from('documents').getPublicUrl(q.image_path).data.publicUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded border border-gray-200 object-contain"
                  />
                )}
                <span className="text-sm text-gray-800">{q.question}</span>
                <Badge color={q.question_type === 'fill_blank' ? 'brand' : q.question_type === 'multi' ? 'green' : 'gray'} className="ml-2">
                  {TYPE_LABEL[q.question_type] ?? 'Single choice'}
                </Badge>
                <Badge color="gray" className="ml-1">
                  Importance {q.importance}
                </Badge>
              </button>
              <button
                onClick={() => remove(q.id)}
                disabled={removingId === q.id}
                className="shrink-0 text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <QuestionEditModal
          question={editing}
          groupKey={group}
          categoryId={categoryId}
          currentStoreId={null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
