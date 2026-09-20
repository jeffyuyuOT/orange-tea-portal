import { useState } from 'react'
import Button from '../../../components/ui/Button'
import { IMPORT_TYPES, downloadTemplate, readWorkbookForImport, detectImportType } from '../../../lib/importTemplates'

const TYPE_OPTIONS = Object.values(IMPORT_TYPES)

export default function ImportFilePanel() {
  const [downloadType, setDownloadType] = useState(TYPE_OPTIONS[0].key)
  const [pending, setPending] = useState(null) // { fileName, rows, rowCount, detectedKey, chosenKey }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { summary, errors }

  async function handleFileSelected(file) {
    setResult(null)
    setBusy(true)
    try {
      const { sheetName, headerRow, rows, rowCount } = await readWorkbookForImport(file)
      const detectedKey = detectImportType(sheetName, headerRow)
      setPending({ fileName: file.name, rows, rowCount, detectedKey, chosenKey: detectedKey ?? '' })
    } catch (err) {
      setResult({ summary: null, errors: [`Couldn't read that file: ${err.message}`] })
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    const type = IMPORT_TYPES[pending.chosenKey]
    if (!type) return
    setBusy(true)
    try {
      const outcome = await type.run(pending.rows)
      setResult(outcome)
      setPending(null)
    } catch (err) {
      setResult({ summary: null, errors: [err.message] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-brand-700">Import File</h2>
      <p className="mb-4 text-sm text-gray-500">
        Bulk-load data via a fixed Excel template. Ingredient Master and Formula create new rows; Quiz Bank and Shop
        Training create new questions/items; Staff updates existing accounts only (new logins are invited via
        Supabase Auth — see README).
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Download template</span>
          <select className="input" value={downloadType} onChange={(e) => setDownloadType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={() => downloadTemplate(downloadType)}>
          Download
        </Button>
      </div>

      <label className="inline-block cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
        {busy ? 'Reading…' : 'Choose file to import'}
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files[0] && handleFileSelected(e.target.files[0])}
        />
      </label>
      <p className="mt-1 text-xs text-gray-400">
        The file type is detected automatically from its sheet name/columns — no need to tell it which template you
        used, but you can correct it below if it guesses wrong.
      </p>

      {pending && (
        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="mb-2 text-sm text-gray-700">
            <span className="font-medium">{pending.fileName}</span> — {pending.rowCount} row(s) found.
          </p>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              {pending.detectedKey ? 'Detected type:' : "Couldn't auto-detect — please choose:"}
            </span>
            <select
              className="input w-64"
              value={pending.chosenKey}
              onChange={(e) => setPending((p) => ({ ...p, chosenKey: e.target.value }))}
            >
              {!pending.detectedKey && <option value="">— Select type —</option>}
              {TYPE_OPTIONS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button onClick={confirmImport} disabled={busy || !pending.chosenKey}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          {result.summary && <p className="font-medium text-brand-700">{result.summary}</p>}
          {result.errors?.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-600">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
