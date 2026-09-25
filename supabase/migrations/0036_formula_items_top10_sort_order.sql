-- Independent sort order for how Top 10 drinks are arranged in the Formula
-- page's "Top 10" category and Admin Center > Formula Database's "Top 10"
-- management view — separate from `sort_order` (which is scoped to the
-- item's own real category) so reordering the Top 10 list never reshuffles
-- a drink's position inside its own category, and vice versa.
alter table formula_items add column if not exists top_10_sort_order integer not null default 0;
