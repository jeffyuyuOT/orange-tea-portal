import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

const CHOICE_KEYS = ['A', 'B', 'C', 'D']

export default function QuestionEditModal({ question, groupKey, categoryId, onClose, onSaved }) {
  const { profile, accessibleStores } = useAuth()
  const isNew = !question.id
  const [items, setItems] = useState([]) // formula_items or shop_training_items to link to
  const [linkedId, setLinkedId] = useState(question.formula_item_id ?? question.shop_training_item_id ?? '')
  const [text, setText] = useState(question.question ?? '')
  const [choices, setChoices] = useState(
    question.choices?.length ? question.choices : CHOICE_KEYS.map((k) => ({ key: k, text: '' }))
  )
  const [correct, setCorrect] = useState(question.correct_choice ?? 'A')
  const [importance, setImportance] = useState(question.importance ?? 2)
  const [storeIds, setStoreIds] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (groupKey === 'shop_training') {
      supabase
        .from('shop_training_items')
        .select('id, title')
        .order('title')
        .then(({ data }) => setItems((data ?? []).map((d) => ({ id: d.id, label: d.title }))))
    } else {
      let q = supabase.from('formula_items').select('id, name_en').eq('group_key', groupKey)
      q = categoryId ? q.eq('category_id', categoryId) : q.is('category_id', null)
      q.order('name_en').then(({ data }) => setItems((data ?? []).map((d) => ({ id: d.id, label: d.name_en }))))
    }
  }, [groupKey, categoryId])

  useEffect(() => {
    if (!question.id) return
    supabase
      .from('quiz_question_stores')
      .select('store_id')
      .eq('question_id', question.id)
      .then(({ data }) => setStoreIds(data?.length ? data.map((r) => r.store_id) : null))
  }, [question.id])

  async function save() {
    setSaving(true)
    try {
      const payload = {
        group_key: groupKey,
        category_id: groupKey === 'drink' ? categoryId : null,
        formula_item_id: groupKey === 'shop_training' ? null : linkedId || null,
        shop_training_item_id: groupKey === 'shop_training' ? linkedId || null : null,
        question: text,
        choices,
        correct_choice: correct,
        importance,
      }
      let id = question.id
      if (isNew) {
        const { data, error } = await supabase.from('quiz_questions').insert({ ...payload, created_by: profile.id }).select().single()
        if (error) throw error
        id = data.id
      } else {
        const { error } = await supabase.from('quiz_questions').update(payload).eq('id', id)
        if (error) throw error
        await supabase.from('quiz_question_stores').delete().eq('question_id', id)
      }
      if (storeIds && storeIds.length) {
        await supabase.from('quiz_question_stores').insert(storeIds.map((s) => ({ question_id: id, store_id: s })))
      }
      onSaved()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Quiz Question' : 'Edit Quiz Question'}
      footer={
        <Button onClick={save} disabled={saving || !text}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">
            Linked {groupKey === 'shop_training' ? 'Shop Training item' : 'formula item'}
          </span>
          <select className="input" value={linkedId} onChange={(e) => setLinkedId(e.target.value)}>
            <option value="">—</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Question</span>
          <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">Choices (mark the correct one)</span>
          <div className="space-y-1.5">
            {choices.map((c, idx) => (
              <div key={c.key} className="flex items-center gap-2">
                <input type="radio" checked={correct === c.key} onChange={() => setCorrect(c.key)} />
                <span className="w-5 text-sm font-medium text-gray-500">{c.key}</span>
                <input
                  className="input"
                  value={c.text}
                  onChange={(e) => setChoices((prev) => prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Importance (1 = most important)</span>
            <select className="input" value={importance} onChange={(e) => setImportance(Number(e.target.value))}>
              <option value={1}>1 — Most important</option>
              <option value={2}>2 — Important</option>
              <option value={3}>3 — Nice to know</option>
            </select>
          </label>
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">Stores (default: all)</span>
            <div className="flex flex-wrap gap-2">
              {accessibleStores.map((s) => (
                <label key={s.id} className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={storeIds === null || storeIds.includes(s.id)}
                    onChange={(e) => {
                      setStoreIds((prev) => {
                        const current = prev === null ? accessibleStores.map((x) => x.id) : prev
                        return e.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id)
                      })
                    }}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
