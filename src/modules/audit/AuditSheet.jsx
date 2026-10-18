import SignaturePad from './SignaturePad'
import { auditFileUrl, formatAuditDate, formatAuditDateTime } from './auditUtils'

const GRID = 'md:grid md:grid-cols-[1.2fr_2fr_2fr_5rem] md:gap-3'

// The audit sheet itself — one component for every state: the admin filling
// it in (editable), a shop manager reviewing it before signing, and the
// read-only copy in History. `data` is the shape from reportToSheetData();
// `onChange(patch)` merges a partial update upstream (editable only).
export default function AuditSheet({ data, onChange, editable = false, storeName }) {
  const setItem = (i, patch) =>
    onChange({ items: data.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
        <div>
          Store: <span className="font-medium text-gray-800">{storeName}</span>
        </div>
        <div className="flex items-center gap-2">
          Date:
          {editable ? (
            <input
              type="date"
              className="input !w-auto"
              value={data.audit_date}
              onChange={(e) => onChange({ audit_date: e.target.value })}
            />
          ) : (
            <span className="font-medium text-gray-800">{formatAuditDate(data.audit_date)}</span>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-100 bg-white">
        <div
          className={`hidden border-b border-brand-100 bg-brand-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-700 ${GRID}`}
        >
          <div>Item</div>
          <div>Details</div>
          <div>Auditor&apos;s comment</div>
          <div className="text-center">Audited</div>
        </div>

        {data.items.length === 0 && <div className="px-4 py-6 text-sm text-gray-400">No audit items.</div>}

        {data.items.map((it, i) => (
          <div key={i} className={`space-y-2 border-b border-brand-100 px-4 py-3 ${GRID} md:space-y-0`}>
            <div className="flex items-start gap-1.5 text-sm font-medium text-gray-900">
              <span>{it.title}</span>
              {(it.files ?? []).map((f) => (
                <a
                  key={f.path}
                  href={auditFileUrl(f.path)}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open file: ${f.name || f.path}`}
                  aria-label={`Open file: ${f.name || f.path}`}
                  className="shrink-0 text-base leading-5 hover:opacity-70"
                >
                  📎
                </a>
              ))}
            </div>
            <div className="whitespace-pre-wrap text-sm text-gray-600">{it.content}</div>
            <div>
              <div className="mb-1 text-xs font-medium text-gray-400 md:hidden">Auditor&apos;s comment</div>
              {editable ? (
                <textarea
                  rows={2}
                  className="input"
                  value={it.comment}
                  onChange={(e) => setItem(i, { comment: e.target.value })}
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm text-gray-700">{it.comment || <span className="text-gray-300">—</span>}</div>
              )}
            </div>
            <div className="flex items-center gap-2 md:justify-center">
              {editable ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500"
                    checked={it.audited}
                    onChange={(e) => setItem(i, { audited: e.target.checked })}
                  />
                  <span className="md:hidden">Audited</span>
                </label>
              ) : (
                <span className={`text-sm ${it.audited ? 'font-medium text-green-700' : 'text-gray-300'}`}>
                  {it.audited ? '✓' : '—'}
                  <span className="ml-1 md:hidden">{it.audited ? 'Audited' : 'Not audited'}</span>
                </span>
              )}
            </div>
          </div>
        ))}

        <div className="px-4 py-3">
          <div className="mb-1 text-sm font-medium text-gray-900">Meeting summary</div>
          {editable ? (
            <textarea
              rows={4}
              className="input"
              value={data.meeting_summary}
              onChange={(e) => onChange({ meeting_summary: e.target.value })}
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm text-gray-700">
              {data.meeting_summary || <span className="text-gray-300">—</span>}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-1 text-sm font-medium text-gray-900">Auditor</div>
          {editable ? (
            <input
              className="input mb-2 max-w-md"
              placeholder="Auditor's name"
              value={data.auditor_name}
              onChange={(e) => onChange({ auditor_name: e.target.value })}
            />
          ) : (
            <div className="mb-2 text-sm text-gray-700">{data.auditor_name || '—'}</div>
          )}
          {editable ? (
            <SignaturePad value={data.auditor_signature} onChange={(v) => onChange({ auditor_signature: v })} />
          ) : data.auditor_signature ? (
            <img src={data.auditor_signature} alt="Auditor signature" className="h-24 rounded-lg border border-brand-100 bg-white" />
          ) : null}
        </div>

        {data.manager_signature && (
          <div>
            <div className="mb-1 text-sm font-medium text-gray-900">Confirmed by shop manager</div>
            <div className="mb-2 text-sm text-gray-700">
              {data.confirmed_by_name}
              {data.confirmed_at && <span className="text-gray-400"> · {formatAuditDateTime(data.confirmed_at)}</span>}
            </div>
            <img src={data.manager_signature} alt="Manager signature" className="h-24 rounded-lg border border-brand-100 bg-white" />
          </div>
        )}
      </div>
    </div>
  )
}
