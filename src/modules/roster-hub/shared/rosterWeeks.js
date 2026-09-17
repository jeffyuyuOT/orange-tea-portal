import { addDays, format, startOfWeek } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'

export function thisWeekStart(date = new Date()) {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function nextWeekStart(date = new Date()) {
  return format(addDays(startOfWeek(date, { weekStartsOn: 1 }), 7), 'yyyy-MM-dd')
}

// Returns the latest SUBMITTED roster_periods row for a store + week_start
// (there may be multiple saved drafts; submitted ones are what staff see).
export async function fetchSubmittedPeriod(storeId, weekStart) {
  if (!storeId) return null
  const { data } = await supabase
    .from('roster_periods')
    .select('*')
    .eq('store_id', storeId)
    .eq('week_start_date', weekStart)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}
