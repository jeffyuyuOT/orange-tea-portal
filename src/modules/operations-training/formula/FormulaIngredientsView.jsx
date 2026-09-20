import RichTextViewer from '../../../components/ui/RichTextViewer'
import { isVideoPath } from '../../../lib/mediaType'

const GROUP_BORDER = '#f97316' // brand orange — distinct from the table's own thin gray gridlines

// Everything between "which ingredients apply" and "Method": the Iced/Cold
// vs Hot toggle, the ingredient table/chips (with any grouping boxes), the
// small above/below annotations, and the rich-text Notes. Shared by the
// staff-facing Formula page (FormulaItemDetail, fed saved data) and the
// admin Edit Item screen's live Preview panel (fed the still-unsaved form
// state) so the two can never drift apart — there is only one place that
// knows how a formula is drawn.
export default function FormulaIngredientsView({
  hasHotVersion,
  showHot,
  onToggleHot,
  displayMode,
  customImagePath,
  ingredients, // full set (every size, both hot states) — filtered here by showHot
  sizes,
  annotationsAbove = [],
  annotationsBelow = [],
  notesHtml,
  notesImagePath,
}) {
  const visibleIngredients = hasHotVersion ? ingredients.filter((ing) => !!ing.is_hot === showHot) : ingredients

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-brand-700">Ingredients</h4>
        {hasHotVersion && (
          <div className="flex w-fit gap-1 rounded-lg border border-orange-200 bg-orange-50 p-1">
            <button
              type="button"
              onClick={() => onToggleHot?.(false)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${!showHot ? 'bg-white text-orange-700 shadow-sm' : 'text-orange-500'}`}
            >
              Iced/Cold
            </button>
            <button
              type="button"
              onClick={() => onToggleHot?.(true)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${showHot ? 'bg-white text-orange-700 shadow-sm' : 'text-orange-500'}`}
            >
              Hot
            </button>
          </div>
        )}
      </div>

      {annotationsAbove.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-xs text-gray-500">
          {annotationsAbove.map((a, i) => (
            <li key={i}>· {a.text}</li>
          ))}
        </ul>
      )}

      {displayMode === 'custom' && customImagePath ? (
        <img src={customImagePath} alt="" className="max-w-sm rounded-lg border border-gray-200" />
      ) : visibleIngredients.length === 0 ? (
        <p className="text-sm text-gray-400">No ingredients recorded.</p>
      ) : sizes.length > 0 ? (
        <IngredientMatrix ingredients={visibleIngredients} sizes={sizes} />
      ) : (
        <GroupedChips ingredients={visibleIngredients} />
      )}

      {annotationsBelow.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
          {annotationsBelow.map((a, i) => (
            <li key={i}>· {a.text}</li>
          ))}
        </ul>
      )}

      {notesHtml && <RichTextViewer html={notesHtml} className="mt-2" />}
      {notesImagePath &&
        (isVideoPath(notesImagePath) ? (
          <video src={notesImagePath} controls className="mt-2 max-w-sm rounded-lg border border-gray-200" />
        ) : (
          <img src={notesImagePath} alt="" className="mt-2 max-w-sm rounded-lg border border-gray-200" />
        ))}
    </div>
  )
}

// Chips in normal flow, except ingredients sharing the same non-blank
// group_label (set in Edit Item, e.g. "Blender") are drawn together inside
// one bordered box instead of as separate standalone chips — for things
// like "these four go in the blender together" vs. a topping added after.
function GroupedChips({ ingredients }) {
  const segments = []
  for (const ing of ingredients) {
    const label = ing.group_label || ''
    const last = segments[segments.length - 1]
    if (label && last?.type === 'group' && last.label === label) {
      last.items.push(ing)
    } else if (label) {
      segments.push({ type: 'group', label, items: [ing] })
    } else {
      segments.push({ type: 'single', item: ing })
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {segments.map((seg, i) =>
        seg.type === 'single' ? (
          <IngredientChip key={seg.item.id ?? seg.item._key ?? i} ing={seg.item} />
        ) : (
          <div key={i} className="flex items-center gap-1.5 rounded-lg border-2 p-1.5" style={{ borderColor: GROUP_BORDER }}>
            {seg.label && (
              <span className="pl-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: GROUP_BORDER }}>
                {seg.label}
              </span>
            )}
            {seg.items.map((ing) => (
              <IngredientChip key={ing.id ?? ing._key} ing={ing} />
            ))}
          </div>
        )
      )}
    </div>
  )
}

// Compact spreadsheet-style view for a multi-size item: one column per
// distinct ingredient (colored/labelled per its Format Rule), one row per
// size, so M vs L can be compared at a glance instead of switching tabs.
// Columns sharing the same non-blank group_label get an orange box drawn
// around their header + every size's cells, same idea as the chip grouping
// above but spanning the whole column instead of one chip.
function IngredientMatrix({ ingredients, sizes }) {
  // The same ingredient can legitimately appear more than once for one
  // size (e.g. sugar added at two different points in the recipe), so
  // columns can't just be keyed by ingredient_id — that collapsed every
  // repeat down to a single column and silently dropped the second one.
  // Instead each column is keyed by (ingredient_id, occurrence-within-that
  // -size): a size's 1st "Sugar" row lines up under the same column as
  // every other size's 1st "Sugar" row, its 2nd goes in its own column,
  // and so on — so a size with only one occurrence just leaves that later
  // column's cell blank rather than losing the row entirely.
  const sizeOccurrenceCounts = new Map() // size_id -> Map(ingredientKey -> next occurrence #)
  const withOccurrence = ingredients.map((ing) => {
    const ingredientKey = ing.ingredient_id ?? ing.id
    let counts = sizeOccurrenceCounts.get(ing.size_id)
    if (!counts) {
      counts = new Map()
      sizeOccurrenceCounts.set(ing.size_id, counts)
    }
    const occurrence = counts.get(ingredientKey) || 0
    counts.set(ingredientKey, occurrence + 1)
    return { ing, colKey: `${ingredientKey}|${occurrence}` }
  })

  const columns = []
  const seen = new Set()
  for (const entry of withOccurrence) {
    if (!seen.has(entry.colKey)) {
      seen.add(entry.colKey)
      columns.push(entry)
    }
  }

  function cellFor(sizeId, colKey) {
    return withOccurrence.find((entry) => entry.colKey === colKey && entry.ing.size_id === sizeId)?.ing
  }

  // Same Format Rule styling for a column's header AND its quantity cells,
  // so "PF" being bold/pink up top means every quantity under it is too.
  function ruleStyle(rule, { header }) {
    return {
      color: rule?.font_color || '#1f2937',
      backgroundColor: rule?.background_color || '#fff7ed',
      fontWeight: rule?.is_bold ? 700 : header ? 600 : 400,
      fontStyle: rule?.is_italic ? 'italic' : 'normal',
    }
  }

  function groupBorderStyle(idx) {
    const col = columns[idx].ing
    if (!col.group_label) return {}
    const isStart = idx === 0 || columns[idx - 1].ing.group_label !== col.group_label
    const isEnd = idx === columns.length - 1 || columns[idx + 1].ing.group_label !== col.group_label
    return {
      borderLeft: isStart ? `2px solid ${GROUP_BORDER}` : undefined,
      borderRight: isEnd ? `2px solid ${GROUP_BORDER}` : undefined,
    }
  }

  const hasGroups = columns.some((c) => c.ing.group_label)

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="border-collapse text-sm">
        {hasGroups && (
          <thead>
            <tr>
              <th className="border-b border-r border-gray-200" />
              {columns.map(({ ing: col, colKey }, idx) => {
                const isStart = idx === 0 || columns[idx - 1].ing.group_label !== col.group_label
                if (col.group_label && !isStart) return null
                let span = 1
                if (col.group_label) {
                  while (columns[idx + span] && columns[idx + span].ing.group_label === col.group_label) span += 1
                }
                return (
                  <th
                    key={colKey}
                    colSpan={span}
                    className="px-1 pt-1 text-center text-[10px] font-semibold uppercase tracking-wide"
                    style={
                      col.group_label
                        ? { color: GROUP_BORDER, borderTop: `2px solid ${GROUP_BORDER}`, borderLeft: `2px solid ${GROUP_BORDER}`, borderRight: `2px solid ${GROUP_BORDER}` }
                        : undefined
                    }
                  >
                    {col.group_label || ''}
                  </th>
                )
              })}
            </tr>
          </thead>
        )}
        <thead>
          <tr>
            <th className="border-b border-r border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left text-xs font-semibold text-gray-500">
              Size
            </th>
            {columns.map(({ ing: col, colKey }, idx) => {
              const rule = col.ingredient_master?.ingredient_format_rules
              return (
                <th
                  key={colKey}
                  className="border-b border-r border-gray-200 px-2.5 py-1.5 text-center text-xs whitespace-nowrap"
                  style={{ ...ruleStyle(rule, { header: true }), ...groupBorderStyle(idx) }}
                >
                  {rule?.abbreviation || col.ingredient_master?.name || 'Ingredient'}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sizes.map((size, rowIdx) => (
            <tr key={size.id}>
              <td className="border-r border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-semibold text-gray-600">{size.name}</td>
              {columns.map(({ ing: col, colKey }, idx) => {
                const cell = cellFor(size.id, colKey)
                const rule = col.ingredient_master?.ingredient_format_rules
                const unit = col.ingredient_master?.unit
                const isLastRow = rowIdx === sizes.length - 1
                return (
                  <td
                    key={colKey}
                    className="border-r border-gray-200 px-2.5 py-1.5 text-center text-xs"
                    style={{
                      ...ruleStyle(rule, { header: false }),
                      ...groupBorderStyle(idx),
                      borderBottom: isLastRow && col.group_label ? `2px solid ${GROUP_BORDER}` : undefined,
                    }}
                    title={cell?.quantity_text && unit ? unit : undefined}
                  >
                    {cell?.quantity_text || ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IngredientChip({ ing }) {
  const rule = ing.ingredient_master?.ingredient_format_rules
  const label = rule?.abbreviation || ing.ingredient_master?.name || 'Ingredient'
  const unit = ing.ingredient_master?.unit
  return (
    <span
      className="rounded-md border px-2 py-1 text-sm"
      style={{
        fontSize: rule?.font_size || '14px',
        color: rule?.font_color || '#1f2937',
        backgroundColor: rule?.background_color || '#fff7ed',
        borderColor: rule?.background_color || '#fed7aa',
        fontWeight: rule?.is_bold ? 700 : 400,
        fontStyle: rule?.is_italic ? 'italic' : 'normal',
      }}
    >
      {label}
      {ing.quantity_text && (
        <>
          {' · '}
          <span title={unit || undefined}>{ing.quantity_text}</span>
        </>
      )}
    </span>
  )
}
