import { useState } from 'react'
import QuizQuestionsTab from './QuizQuestionsTab'
import QuizSettingsTab from './QuizSettingsTab'

export default function QuizBankPage() {
  const [tab, setTab] = useState('bank')

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Quiz Bank</h1>
      <p className="mb-4 text-sm text-gray-500">Questions feed the Quick Quiz in My Dashboard &gt; Study Log.</p>

      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {[
          { key: 'bank', label: 'Quiz Bank' },
          { key: 'settings', label: 'Setting' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'bank' ? <QuizQuestionsTab /> : <QuizSettingsTab />}
    </div>
  )
}
