import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import QuestionEditModal from './QuestionEditModal'

const GROUPS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
  { key: 'shop_training', label: 'Shop Training' },
]

export default function QuizQuestionsTab() {
  const [group, setGroup] = useState('drink')
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [questions, setQuestions] = useState([])
  const [editing, setEditing] = useState(null)
  // Which question's ✕ button is mid-delete — locks just that button.
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
    let q = supabase.from('quiz_questions').select('*').eq('group_key', group)
    if (group === 'drink') {
      if (!categoryId) return setQuestions([])
      q = q.eq('category_id', categoryId)
    }
    const { data } = await q.order('created_at', { ascending: false })
    setQuestions(data ?? [])
  }
  useEffect(() => {
    load()
  }, [group, categoryId])

  async function remove(id) {
    if (!confirm('Delete this question?')) return
    setRemovingId(id)
    await supabase.from('quiz_questions').delete().eq('id', id)
    await load()
    setRemovingId(null)
  }

  return (
    <div>
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
            <div key={q.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => setEditing(q)} className="flex-1 text-left">
                <span className="text-sm text-gray-800">{q.question}</span>
                <Badge color="gray" className="ml-2">
                  Importance {q.importance}
                </Badge>
              </button>
              <button
                onClick={() => remove(q.id)}
                disabled={removingId === q.id}
                className="text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
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
