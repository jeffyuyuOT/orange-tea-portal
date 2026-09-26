import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import QuizImagePicker from './QuizImagePicker'

const CHOICE_KEYS = ['A', 'B', 'C', 'D']

// Fixed id seeded by migration 0045 — so a brand new image uploaded from
// here files straight into File Repository under its own category (kept
// separate from TFN/Super forms etc.) without needing a category picker,
// and can then be reused by any other question via "Choose from File
// Repository" instead of being uploaded again.
const QUIZ_IMAGE_CATEGORY_ID = '00000000-0000-0000-0000-000000000007'

export default function QuestionEditModal({ question, groupKey, categoryId, onClose, onSaved }) {
  const { profile, accessibleStores } = useAuth()
  const isNew = !question.id
  const [items, setItems] = useState([]) // formula_items or shop_training_items to link to
  const [linkedId, setLinkedId] = useState(question.formula_item_id ?? question.shop_training_item_id ?? '')
  const [text, setText] = useState(question.question ?? '')
  // 'single' (one correct choice, the original/only kind before this),
  // 'multi' (more than one correct choice), or 'fill_blank' (typed answer,
  // graded with typo/abbreviation tolerance — see src/lib/answerMatching.js).
  const [questionType, setQuestionType] = useState(question.question_type ?? 'single')
  const [choices, setChoices] = useState(
    question.choices?.length ? question.choices : CHOICE_KEYS.map((k) => ({ key: k, text: '' }))
  )
  const [correct, setCorrect] = useState(question.correct_choice ?? 'A') // 'single'
  const [correctChoices, setCorrectChoices] = useState(question.correct_choices ?? []) // 'multi'
  const [answerText, setAnswerText] = useState(question.answer_text ?? '') // 'fill_blank'
  // Extra accepted answers for the same fill-blank question — an
  // abbreviation or alternate name that means the same thing (e.g. "OT"
  // for "Orange Tea"). Kept as a list of plain text inputs the admin can
  // add/remove, same idea as Leave Limits' custom-period rows.
  const [acceptedAnswers, setAcceptedAnswers] = useState(question.accepted_answers?.length ? question.accepted_answers : [])
  const [importance, setImportance] = useState(question.importance ?? 2)
  const [storeIds, setStoreIds] = useState(null)
  const [imagePath, setImagePath] = useState(question.image_path ?? '')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pickingImage, setPickingImage] = useState(false)
  const [saving, setSaving] = useState(false)

  // Shared with File Repository rather than a quiz-only upload, so the same
  // picture (e.g. a drink photo used by several questions) is only ever
  // stored once — see FileRepositoryPage.jsx's upload() for the pattern
  // this mirrors.
  async function uploadImage(file) {
    setUploadingImage(true)
    const path = `repository/${QUIZ_IMAGE_CATEGORY_ID}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (!error) {
      await supabase.from('file_repository').insert({
        category_id: QUIZ_IMAGE_CATEGORY_ID,
        display_name: file.name,
        file_path: path,
        uploaded_by: profile.id,
        uploaded_by_name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email,
      })
      setImagePath(path)
    } else {
      alert(error.message)
    }
    setUploadingImage(false)
  }

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

  function toggleCorrectChoice(key) {
    setCorrectChoices((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        group_key: groupKey,
        category_id: groupKey === 'drink' ? categoryId : null,
        formula_item_id: groupKey === 'shop_training' ? null : linkedId || null,
        shop_training_item_id: groupKey === 'shop_training' ? linkedId || null : null,
        question: text,
        question_type: questionType,
        // Only the fields the chosen type actually uses are set — the rest
        // stay null, which is what the DB's quiz_questions_type_fields_chk
        // constraint expects (see migration 0043).
        choices: questionType === 'fill_blank' ? [] : choices,
        correct_choice: questionType === 'single' ? correct : null,
        correct_choices: questionType === 'multi' ? correctChoices : null,
        answer_text: questionType === 'fill_blank' ? answerText.trim() : null,
        accepted_answers: questionType === 'fill_blank' ? acceptedAnswers.map((a) => a.trim()).filter(Boolean) : null,
        importance,
        image_path: imagePath || null,
      }
      let id = question.id
      if (isNew) {
        const { data, error } = await supabase
          .from('quiz_questions')
          .insert({
            ...payload,
            created_by: profile.id,
            created_by_name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email,
          })
          .select()
          .single()
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
    <>
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Quiz Question' : 'Edit Quiz Question'}
      footer={
        <Button
          onClick={save}
          disabled={
            saving ||
            !text ||
            (questionType === 'multi' && !correctChoices.length) ||
            (questionType === 'fill_blank' && !answerText.trim())
          }
        >
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
          <span className="mb-1 block text-xs font-medium text-gray-500">Question image (optional)</span>
          <div className="flex items-center gap-3">
            {imagePath && (
              <img
                src={supabase.storage.from('documents').getPublicUrl(imagePath).data.publicUrl}
                alt=""
                className="h-16 w-16 rounded-lg border border-gray-200 object-contain"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPickingImage(true)}>
                Choose from File Repository
              </Button>
              <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
                {uploadingImage ? 'Uploading…' : 'Upload new image'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingImage}
                  onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])}
                />
              </label>
              {imagePath && (
                <button onClick={() => setImagePath('')} className="text-sm text-gray-400 hover:text-red-500">
                  Remove image
                </button>
              )}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Question type</span>
          <select className="input max-w-xs" value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
            <option value="single">Single choice — one correct answer</option>
            <option value="multi">Multiple choice — more than one correct answer</option>
            <option value="fill_blank">Fill in the blank — typed answer</option>
          </select>
        </label>

        {questionType === 'fill_blank' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Correct answer</span>
              <input className="input" value={answerText} onChange={(e) => setAnswerText(e.target.value)} />
            </label>
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Accepted alternate answers (optional) — an abbreviation or alternate name that means the same thing,
                e.g. "OT" for "Orange Tea". Minor typos/spacing differences from any of these are accepted
                automatically; this list is only for answers that are genuinely worded differently.
              </span>
              <div className="space-y-1.5">
                {acceptedAnswers.map((a, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className="input"
                      value={a}
                      onChange={(e) => setAcceptedAnswers((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                    />
                    <button
                      onClick={() => setAcceptedAnswers((prev) => prev.filter((_, i) => i !== idx))}
                      className="shrink-0 text-gray-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setAcceptedAnswers((prev) => [...prev, ''])}
                className="mt-1.5 text-xs font-medium text-brand-600 hover:underline"
              >
                + Add alternate answer
              </button>
            </div>
          </div>
        ) : (
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {questionType === 'multi' ? 'Choices (check every correct answer)' : 'Choices (mark the correct one)'}
            </span>
            <div className="space-y-1.5">
              {choices.map((c, idx) => (
                <div key={c.key} className="flex items-center gap-2">
                  {questionType === 'multi' ? (
                    <input type="checkbox" checked={correctChoices.includes(c.key)} onChange={() => toggleCorrectChoice(c.key)} />
                  ) : (
                    <input type="radio" checked={correct === c.key} onChange={() => setCorrect(c.key)} />
                  )}
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
        )}

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
    {pickingImage && (
      <QuizImagePicker
        onSelect={(path) => {
          setImagePath(path)
          setPickingImage(false)
        }}
        onClose={() => setPickingImage(false)}
      />
    )}
    </>
  )
}
