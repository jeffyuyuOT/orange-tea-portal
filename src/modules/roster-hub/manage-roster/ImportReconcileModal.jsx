import { useState } from 'react'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Shown whenever the grid — from an Excel upload, or from Save/Submit
// itself — contains a name that doesn't match anyone already known for
// this store (an active staff member's roster display name, or an
// existing Pending staff entry) even after fuzzy/typo matching (see
// buildReconcilePlan). For each such name the manager either points it at
// an existing person — in case it's a bigger typo than the automatic
// matching catches — or confirms it's someone new, who gets added to
// Pending staff so this stops asking about them next time.
export default function ImportReconcileModal({ items, known, onCancel, onConfirm }) {
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(items.map((it) => [it.rawName, { mode: 'pending', name: it.rawName, matchKey: known[0] ? `${known[0].type}:${known[0].id}` : '' }]))
  )
  const [saving, setSaving] = useState(false)

  function patch(rawName, next) {
    setChoices((prev) => ({ ...prev, [rawName]: { ...prev[rawName], ...next } }))
  }

  async function confirm() {
    setSaving(true)
    try {
      await onConfirm(choices)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      wide
      title="Confirm names before continuing"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm & continue'}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-gray-500">
        These names on the roster don't match anyone already set up for this store. Confirm each one — either it's
        someone new (added to Pending staff, so this won't ask again) or it's actually one of the names below.
      </p>
      <div className="space-y-4">
        {items.map((it) => {
          const choice = choices[it.rawName]
          return (
            <div key={it.rawName} className="rounded-lg border border-brand-100 p-3 text-sm">
              <div className="mb-2 font-semibold text-gray-800">"{it.rawName}"</div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`mode-${it.rawName}`}
                    checked={choice.mode === 'pending'}
                    onChange={() => patch(it.rawName, { mode: 'pending' })}
                  />
                  New person — add to Pending staff as
                  <input
                    className="input !w-40 !py-1"
                    value={choice.name}
                    disabled={choice.mode !== 'pending'}
                    onChange={(e) => patch(it.rawName, { name: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`mode-${it.rawName}`}
                    checked={choice.mode === 'match'}
                    onChange={() => patch(it.rawName, { mode: 'match' })}
                    disabled={!known.length}
                  />
                  Same person as
                  <select
                    className="input !w-48 !py-1"
                    value={choice.matchKey}
                    disabled={choice.mode !== 'match' || !known.length}
                    onChange={(e) => patch(it.rawName, { matchKey: e.target.value })}
                  >
                    {known.map((k) => (
                      <option key={`${k.type}:${k.id}`} value={`${k.type}:${k.id}`}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
