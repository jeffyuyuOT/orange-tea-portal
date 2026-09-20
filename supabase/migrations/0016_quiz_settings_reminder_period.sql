alter table quiz_settings
  add column reminder_period_months integer not null default 3
  check (reminder_period_months > 0);
