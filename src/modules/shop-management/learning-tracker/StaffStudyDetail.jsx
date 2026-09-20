import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import StudyTabs from '../../dashboard/study-log/StudyTabs'

export default function StaffStudyDetail({ staff, onBack }) {
  const [isSenior, setIsSenior] = useState(!!staff.is_senior)
  const [savingSenior, setSavingSenior] = useState(false)

  async function toggleSenior(value) {
    setSavingSenior(true)
    setIsSenior(value)
    const { error } = await supabase.from('profiles').update({ is_senior: value }).eq('id', staff.id)
    setSavingSenior(false)
    if (error) {
      alert(error.message)
      setIsSenior(!value)
    }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
        ← All staff
      </button>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">
          {staff.first_name} {staff.last_name}
        </h1>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={isSenior}
            disabled={savingSenior}
            onChange={(e) => toggleSenior(e.target.checked)}
          />
          Senior (all items count as memorized automatically)
        </label>
      </div>

      <StudyTabs profileId={staff.id} allowBulkSelect senior={isSenior} />
    </div>
  )
}
