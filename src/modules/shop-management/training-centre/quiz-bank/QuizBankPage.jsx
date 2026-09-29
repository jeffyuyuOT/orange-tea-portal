import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabaseClient'
import { useAuth } from '../../../../lib/AuthContext'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import Modal from '../../../../components/ui/Modal'
import { EmptyState } from '../../../../components/ui/LoadingSpinner'
import QuestionEditModal from './QuestionEditModal'

const TYPE_LABEL = { single: 'Single choice', multi: 'Multi choice', fill_blank: 'Fill in the blank' }

const GROUPS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
  { key: 'shop_training', label: 'Shop Training' },
]

// Jeff, 2026-09: merged into Training Centre alongside Shop Training
// Database and given the exact same per-store-ownership + "Copy to store…"
// model that page already has (migration 0052, replicated here by 0071) —
// "quiz bank一樣會有分店的切換區別...quiz bank的內容一樣可以copy to other
// store (developer跟admin可以做)". Quiz generation itself (Quick Quiz/
// Formal Quiz) now also draws only from the current store's own questions —
// see QuickQuizModal.jsx/FormalQuizModal.jsx.
export default function QuizBankPage() {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const [group, setGroup] = useState('drink')
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [questions, setQuestions] = useState([])
  const [editing, setEditing] = useState(null)
  const [copyingQuestion, setCopyingQuestion] = useState(null)
  // Which question's ✕ button is mid-delete — locks just that button.
  const [removingId, setRemovingId] = useState(null)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'developer'

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
    if (!currentStoreId) return
    let q = supabase.from('quiz_questions').select('*').eq('group_key', group).eq('store_id', currentStoreId)
    if (group === 'drink') {
      if (!categoryId) return setQuestions([])
      q = q.eq('category_id', categoryId)
    }
    const { data } = await q.order('created_at', { ascending: false })
    setQuestions(data ?? [])
  }
  useEffect(() => {
    load()
  }, [group, categoryId, currentStoreId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id) {
    if (!confirm('Delete this question?')) return
    setRemovingId(id)
    await supabase.from('quiz_questions').delete().eq('id', id)
    await load()
    setRemovingId(null)
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Questions feed both Quick Quiz and Formal Quiz in My Dashboard &gt; Study Log — for the store selected
        above only. Switch stores to edit another store's question bank.
        {isAdmin && ' As an admin, you can also copy a question from here straight into other stores.'}
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
              <div className="flex shrink-0 items-center gap-1">
                {isAdmin && (
                  <Button variant="secondary" onClick={() => setCopyingQuestion(q)}>
                    Copy to store…
                  </Button>
                )}
                <button
                  onClick={() => remove(q.id)}
                  disabled={removingId === q.id}
                  className="text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <QuestionEditModal
          question={editing}
          groupKey={group}
          categoryId={categoryId}
          currentStoreId={currentStoreId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {copyingQuestion && (
        <CopyToStoreModal
          question={copyingQuestion}
          currentStoreId={currentStoreId}
          accessibleStores={accessibleStores}
          onClose={() => setCopyingQuestion(null)}
        />
      )}
    </div>
  )
}

// Admin/developer-only: duplicates one question — every field, including its
// image, and, for a Shop Training-linked question, the target store's own
// copy of the same-titled training item if one exists (else left
// unlinked) — into one or more other stores as its own brand-new row/id,
// same pattern as Shop Training Database's CopyToStoreModal. The copies are
// independent from that point on; editing this store's question afterwards
// does not touch them.
function CopyToStoreModal({ question, currentStoreId, accessibleStores, onClose }) {
  const targets = accessibleStores.filter((s) => s.id !== currentStoreId)
  const [selected, setSelected] = useState(new Set())
  const [copying, setCopying] = useState(false)

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copy() {
    if (!selected.size) return
    if (
      !confirm(
        `Copy this question to ${selected.size} store(s)? This adds a new, independent copy at each — it won't stay linked to this one.`
      )
    ) {
      return
    }
    setCopying(true)
    let sourceItemTitle = null
    if (question.shop_training_item_id) {
      const { data } = await supabase
        .from('shop_training_items')
        .select('title')
        .eq('id', question.shop_training_item_id)
        .single()
      sourceItemTitle = data?.title ?? null
    }

    let failCount = 0
    for (const storeId of selected) {
      let targetItemId = null
      if (sourceItemTitle) {
        const { data } = await supabase
          .from('shop_training_items')
          .select('id')
          .eq('store_id', storeId)
          .eq('title', sourceItemTitle)
          .maybeSingle()
        targetItemId = data?.id ?? null
      }
      const { error } = await supabase.from('quiz_questions').insert({
        group_key: question.group_key,
        category_id: question.category_id,
        formula_item_id: question.formula_item_id,
        shop_training_item_id: targetItemId,
        question: question.question,
        choices: question.choices,
        correct_choice: question.correct_choice,
        correct_choices: question.correct_choices,
        answer_text: question.answer_text,
        accepted_answers: question.accepted_answers,
        importance: question.importance,
        question_type: question.question_type,
        image_path: question.image_path,
        store_id: storeId,
      })
      if (error) failCount += 1
    }
    setCopying(false)
    onClose()
    alert(failCount ? `Copied, but ${failCount} store(s) failed.` : `Copied to ${selected.size} store(s).`)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Copy question to…"
      footer={
        <Button onClick={copy} disabled={copying || !selected.size}>
          {copying ? 'Copying…' : `Copy to ${selected.size || ''} store(s)`}
        </Button>
      }
    >
      {!targets.length ? (
        <p className="text-sm text-gray-500">No other stores to copy to.</p>
      ) : (
        <div className="space-y-1.5">
          {targets.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
