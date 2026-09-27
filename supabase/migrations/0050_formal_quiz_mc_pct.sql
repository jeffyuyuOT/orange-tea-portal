-- Jeff asked why Formal Quiz's auto-generated "how much of this ingredient"
-- questions are always typed fill-in-the-blank, unlike Quick Quiz's version
-- of the same question type, which is always multiple choice. Rather than
-- picking one or the other, this adds a setting so Formal Quiz can mix the
-- two: some percentage of those auto-generated formula questions are shown
-- as multiple choice (same real-quantity/synthesized-distractor style Quick
-- Quiz already uses), the rest stay typed. Default 0 keeps today's behavior
-- (100% typed) unchanged until Jeff turns it up in Quiz Bank > Setting.
-- Only affects the auto-generated ingredient-quantity questions — a
-- curated Quiz Bank fill-in-the-blank question (admin-authored free text,
-- not necessarily even a quantity) has no reliable way to synthesize wrong
-- answers, so those always stay typed regardless of this setting.
alter table formal_quiz_settings
  add column if not exists mc_fill_blank_pct integer not null default 0;
