import { useEffect, useState } from 'react'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { listWorkbookSheetNames } from '../bkImport'
import { isMonthSheet } from '../bkSalesHistoryImport'
import BizGridImport from './BizGridImport'
import BizHistoryImport from './BizHistoryImport'

// 營業 import: a workbook whose tabs are named like 202401 is one of the old
// yearly history files (BizHistoryImport); anything else is the per-store
// template / 營業 export (BizGridImport, unchanged).
export default function BizImportRouter(props) {
  const [mode, setMode] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const names = await listWorkbookSheetNames(await props.file.arrayBuffer())
        if (!cancelled) setMode(names.some(isMonthSheet) ? 'history' : 'grid')
      } catch {
        if (!cancelled) setMode('grid') // let the normal importer report the unreadable file
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.file])
  if (!mode) return <LoadingSpinner label="讀取檔案…" />
  return mode === 'history' ? <BizHistoryImport {...props} /> : <BizGridImport {...props} />
}
