import { useState } from 'react'
import PhaseItemTab from './PhaseItemTab'
import PhaseSettingTab from './PhaseSettingTab'

// Jeff, 2026-10-02 (Training Journey spec, point 5): "Phase Item" (assign
// Must-Know formula items to Phase 1-5) + "Phase Setting" (colors, hours,
// Level-Up Exam question counts) — same two-tabs-in-one-page shape as
// AdminQuizBankPage.jsx's Questions/Setting. The shop-level equivalent for
// Must-Know shop training items lives in Shop Management > Training Centre >
// Training Journey Setting instead (TrainingJourneySettingPage.jsx) —
// different page because that assignment is per-store, not global.
const TABS = [
  { key: 'phase_item', label: 'Phase Item' },
  { key: 'phase_setting', label: 'Phase Setting' },
]

export default function AdminTrainingJourneySettingPage() {
  const [tab, setTab] = useState('phase_item')

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Training Journey Setting</h1>
      <p className="mb-4 text-sm text-gray-500">
        Controls the 4-phase Training Journey staff progress through in My Dashboard &gt; Study Log &gt; Training
        Journey (and the matching tab in Shop Management &gt; Learning Tracker).
      </p>

      <div className="mb-5 flex gap-1 border-b border-brand-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'phase_item' ? <PhaseItemTab /> : <PhaseSettingTab />}
    </div>
  )
}
