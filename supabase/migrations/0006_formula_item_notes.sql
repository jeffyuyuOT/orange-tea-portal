-- Free-text footnote per formula item, for the kind of thing that doesn't
-- fit as an ingredient/quantity row — ratio call-outs, "see table"
-- references, "(TA mash = 1.5 topping)" style clarifications, etc. Shown
-- under the ingredients on the staff-facing Formula page when present.
alter table formula_items add column if not exists notes text;
