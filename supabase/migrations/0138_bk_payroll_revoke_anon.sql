-- Jeff, 2026-10-24: defence in depth. The bk_* and payroll_* tables are only ever used by a
-- signed-in developer (RLS = is_developer(), which now also needs aal2). Supabase grants
-- the signed-out `anon` role table access by default; RLS already returns nothing to it, but
-- take the grant away too so a future RLS mistake can never expose these tables to
-- signed-out visitors. `authenticated` is untouched (RLS still decides).
--
-- ROLLBACK: grant all on <table> to anon;  (for each table below)
revoke all on table
  bk_backup_log, bk_backup_settings, bk_cash_days, bk_cash_entries, bk_dividend_entries,
  bk_hour_sales, bk_hour_settings, bk_opening_balances, bk_owed_emma_claims,
  bk_owed_jeff_entries, bk_parties, bk_payment_types, bk_payouts, bk_sales_days,
  bk_sales_notes, bk_sales_stores, bk_settlements, bk_sf_days, bk_sf_months,
  bk_store_debts, bk_stores,
  payroll_calc_sheets, payroll_employees, payroll_settings, payroll_stores,
  payroll_support_ledger
from anon;
