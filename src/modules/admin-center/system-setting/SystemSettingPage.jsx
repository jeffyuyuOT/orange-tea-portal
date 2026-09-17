import { useState } from 'react'
import Button from '../../../components/ui/Button'
import { exportBackup, restoreBackup } from '../../../lib/backup'
import { downloadFormulaTemplate, importFormulaFile, downloadStaffTemplate, importStaffFile } from '../../../lib/importTemplates'

export default function SystemSettingPage() {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  async function run(fn) {
    setBusy(true)
    setLog('')
    try {
      const result = await fn()
      if (result) setLog(JSON.stringify(result, null, 2))
    } catch (err) {
      setLog(`Error: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">System Setting</h1>

      <section className="rounded-xl border border-brand-100 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-brand-700">Backup</h2>
        <p className="mb-3 text-sm text-gray-500">
          Exports/restores formula, quiz, shop-training and staffing-rule reference data as a JSON file. Does not
          touch staff accounts, rosters or leave records.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => run(exportBackup)} disabled={busy}>
            Export backup
          </Button>
          <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
            Restore backup
            <input
              type="file"
              accept="application/json"
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files[0] && run(() => restoreBackup(e.target.files[0]))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-brand-100 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-brand-700">Formula Import</h2>
        <p className="mb-3 text-sm text-gray-500">
          Bulk-create formula items (name + group + category). Ingredients and steps are then filled in per item in
          Admin Center &gt; Formula Database.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={downloadFormulaTemplate}>
            Download template
          </Button>
          <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
            Upload & import
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files[0] && run(() => importFormulaFile(e.target.files[0]))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-brand-100 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-brand-700">Staff Import</h2>
        <p className="mb-3 text-sm text-gray-500">
          Bulk-update existing staff profiles (name, phone, DOB, store, role) matched by email. New logins must
          first be invited via Supabase Auth (Dashboard &gt; Authentication &gt; Users &gt; Invite) — see README.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={downloadStaffTemplate}>
            Download template
          </Button>
          <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
            Upload & import
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files[0] && run(() => importStaffFile(e.target.files[0]))}
            />
          </label>
        </div>
      </section>

      {log && <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{log}</pre>}
    </div>
  )
}
