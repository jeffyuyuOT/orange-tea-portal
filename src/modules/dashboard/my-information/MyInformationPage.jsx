import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { STAFF_DOC_TYPES } from '../../../lib/staffDocumentTypes'
import Button from '../../../components/ui/Button'

const DOC_TYPES = STAFF_DOC_TYPES

export default function MyInformationPage() {
  const { profile, currentStoreId, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [docs, setDocs] = useState({})
  const [templates, setTemplates] = useState({})

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name ?? '',
        last_name: profile.last_name ?? '',
        phone: profile.phone ?? '',
        date_of_birth: profile.date_of_birth ?? '',
        email: profile.email ?? '',
        tax_file_number: profile.tax_file_number ?? '',
      })
    }
  }, [profile])

  useEffect(() => {
    if (!profile) return
    supabase
      .from('user_documents')
      .select('*')
      .eq('profile_id', profile.id)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((d) => (map[d.doc_type] = d))
        setDocs(map)
      })
  }, [profile])

  // Which blank template file to offer depends on the staff's store — set
  // per store in Store Management (store_document_links) so, e.g., a
  // state-specific form can differ between stores. No store selected yet,
  // or that store has no file linked for a category, just means no
  // "Download blank form" link shows for it.
  useEffect(() => {
    if (!currentStoreId) {
      setTemplates({})
      return
    }
    supabase
      .from('store_document_links')
      .select('doc_type, url, file_repository(file_path)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        const map = {}
        ;(data ?? []).forEach((l) => {
          const href = l.url || (l.file_repository ? supabase.storage.from('documents').getPublicUrl(l.file_repository.file_path).data.publicUrl : null)
          if (href) map[l.doc_type] = href
        })
        setTemplates(map)
      })
  }, [currentStoreId])

  async function save() {
    setSaving(true)
    // An empty date input sends '' — Postgres's `date` column rejects that
    // outright (invalid input syntax for type date), which PostgREST
    // surfaces as an opaque HTTP 400 with no field-level detail in the UI.
    // Anyone who hasn't filled in a date of birth yet hits this on every
    // save, not just when editing the date field itself.
    const payload = { ...form, date_of_birth: form.date_of_birth || null }
    const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id)
    if (error) alert(`Save failed: ${error.message}`)
    await refreshProfile()
    setSaving(false)
  }

  async function uploadDoc(docType, file) {
    const path = `user-documents/${profile.id}/${docType}-${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (error) {
      alert(`Upload failed: ${error.message}`)
      return
    }
    const { data } = await supabase
      .from('user_documents')
      .insert({ profile_id: profile.id, doc_type: docType, file_path: path, original_name: file.name })
      .select()
      .single()
    setDocs((prev) => ({ ...prev, [docType]: data }))
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">Personal Details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name">
            <input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Date of birth">
            <input
              type="date"
              className="input"
              value={form.date_of_birth ?? ''}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Tax File Number">
            <input
              className="input"
              value={form.tax_file_number}
              onChange={(e) => setForm({ ...form, tax_file_number: e.target.value })}
            />
          </Field>
        </div>
        <Button className="mt-3" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">Account</h2>
        <Button variant="secondary" onClick={() => navigate('/set-password')}>
          Change password
        </Button>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-700">Documents</h2>
        <div className="space-y-3">
          {DOC_TYPES.map((d) => (
            <div key={d.key} className="flex items-center justify-between rounded-lg border border-brand-100 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-800">{d.label}</div>
                <div className="text-xs text-gray-400">
                  {docs[d.key] ? `Uploaded: ${docs[d.key].original_name}` : 'Not uploaded yet'}
                  {templates[d.key] && (
                    <>
                      {' · '}
                      <a className="text-brand-600 hover:underline" href={templates[d.key]} target="_blank" rel="noreferrer">
                        Download blank form
                      </a>
                    </>
                  )}
                </div>
              </div>
              <label className="cursor-pointer rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                Upload
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files[0] && uploadDoc(d.key, e.target.files[0])}
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  )
}
