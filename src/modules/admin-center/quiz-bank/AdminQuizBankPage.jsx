import { useState } from 'react'
import AdminQuestionsTab from './AdminQuestionsTab'
import QuizSettingsTab from './QuizSettingsTab'

// Jeff, 2026-09: reinstated as one page with two tabs — "quiz bank setting
//就改回原本名字setting，也一樣放在這個分頁下 (跟一開始一樣)" — replacing the
// brief detour where the shared bank lived under shop_management.quiz_bank
// (now the per-store "Branch Quiz Bank" instead) and its Setting screen was
// pulled out into its own standalone admin_center.quiz_settings page. See
// permissions.js's admin_center.quiz_bank comment for the fuller history.
const TABS = [
  { key: 'questions', label: 'Questions' },
  { key: 'setting', label: 'Setting' },
]

export default function AdminQuizBankPage() {
  const [tab, setTab] = useState('questions')

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Admin Quiz Bank</h1>
      <p className="mb-4 text-sm text-gray-500">
        The centrally-managed question bank every store's Training Centre &gt; Quiz Bank sees read-only, on top of
        its own Branch Quiz Bank.
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

      {tab === 'questions' ? <AdminQuestionsTab /> : <QuizSettingsTab />}
    </div>
  )
}
