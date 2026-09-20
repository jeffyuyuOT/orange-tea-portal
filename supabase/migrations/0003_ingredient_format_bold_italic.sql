-- Adds Bold / Italic options to ingredient_format_rules, for the Format
-- Rule tab in Admin Center > Formula Database.
alter table ingredient_format_rules
  add column if not exists is_bold boolean not null default false,
  add column if not exists is_italic boolean not null default false;
