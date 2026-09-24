import { useState } from 'react'
import QuizQuestionsTab from './QuizQuestionsTab'
import QuizSettingsTab from './QuizSettingsTab'
import FormalQuizSettingsTab from './FormalQuizSettingsTab'

export default function QuizBankPage() {
  const [tab, setTab] = useState('bank')
  // Which quiz type's settings the "Setting" tab is showing — nested
  // inside it rather than as a third top-level tab, since both are still
  // "the Setting tab", just for two different quiz types.
  const [settingsQuizType, setSettingsQuizType] = useState('quick')

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Quiz Bank</h1>
      <p className="mb-4 text-sm text-gray-500">
        Questions feed both Quick Quiz and Formal Quiz in My Dashboard &gt; Study Log.
      </p>

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

      {tab === 'bank' ? (
        <QuizQuestionsTab />
      ) : (
        <div>
          <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {[
              { key: 'quick', label: 'Quick Quiz' },
              { key: 'formal', label: 'Formal Quiz' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setSettingsQuizType(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${settingsQuizType === t.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {settingsQuizType === 'quick' ? <QuizSettingsTab /> : <FormalQuizSettingsTab />}
        </div>
      )}
    </div>
  )
}
