import { useEffect, useRef, useState } from 'react'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import MediaPreview from '../../../components/ui/MediaPreview'

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
  videos = [], // titled videos — a drink or shop-training item can have more than one
}) {
  const visibleIngredients = hasHotVersion ? ingredients.filter((ing) => !!ing.is_hot === showHot) : ingredients
  const hasCustomImage = displayMode === 'custom' && !!customImagePath
  // Some items (e.g. a machine-operation how-to) are pure description/Method
  // with no ingredients recorded at all — for those, showing an "Ingredients"
  // heading above a "No ingredients recorded." placeholder is just noise, so
  // the whole section is skipped. This only fires when there is truly nothing
  // to show for the item as a whole (`ingredients`, unfiltered by hot state);
  // an item with a hot version where just one of the two states happens to
  // have no ingredients still shows the heading/toggle/placeholder as before,
  // since that's a real "this variant has none" case, not "no ingredients at all".
  const showIngredientsSection = hasCustomImage || ingredients.length > 0

  // The table/chips only have room for each ingredient's abbreviation —
  // hovering it with a mouse, or tapping it on mobile (where there's no
  // hover), pops up its full "name(unit)" instead. Only one popover is
  // open at a time; tracking it here rather than locally in each chip/
  // header cell lets a tap anywhere else in this section close it.
  const [openTooltip, setOpenTooltip] = useState(null)
  const containerRef = useRef(null)
  useEffect(() => {
    function handleOutsideClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpenTooltip(null)
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [])

  return (
    <div ref={containerRef}>
      {showIngredientsSection && (
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
      )}

      {annotationsAbove.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-xs text-gray-500">
          {annotationsAbove.map((a, i) => (
            <li key={i}>· {a.text}</li>
          ))}
        </ul>
      )}

      {hasCustomImage ? (
        <img src={customImagePath} alt="" className="max-w-sm rounded-lg border border-gray-200" />
      ) : visibleIngredients.length === 0 ? (
        // Only say "No ingredients recorded." when the section is actually
        // showing (this item has ingredients for its OTHER hot/cold state) —
        // when there's nothing at all, showIngredientsSection is false and
        // the heading above is already hidden, so stay silent here too.
        showIngredientsSection && <p className="text-sm text-gray-400">No ingredients recorded.</p>
      ) : sizes.length > 0 ? (
        <IngredientMatrix ingredients={visibleIngredients} sizes={sizes} openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
      ) : (
        <GroupedChips ingredients={visibleIngredients} openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
      )}

      {annotationsBelow.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
          {annotationsBelow.map((a, i) => (
            <li key={i}>· {a.text}</li>
          ))}
        </ul>
      )}

      {notesHtml && <RichTextViewer html={notesHtml} className="mt-2" />}
      {notesImagePath && <MediaPreview src={notesImagePath} alt="" className="mt-2 max-w-sm rounded-lg border border-gray-200" />}

      {videos.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {videos.map((v, i) => (
            <div key={v.id ?? i} className="flex items-center gap-2">
              <span className="text-sm text-gray-700">{v.title || 'Video'}</span>
              <a
                href={v.url}
                target="_blank"
                rel="noreferrer"
                title="Watch video"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs text-white hover:bg-brand-600"
              >
                ▶
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Small dark popover showing an ingredient's full name(unit). `position`
// controls which side it opens on: chips open it above themselves (they
// can sit anywhere down the page), matrix header cells open it below
// (above would land outside the scrollable table area).
function NameTooltip({ name, unit, position = 'top' }) {
  const text = unit ? `${name} (${unit})` : name
  const posClass = position === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
  return (
    <span
      className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-normal text-white shadow-lg ${posClass}`}
    >
      {text}
    </span>
  )
}

// Chips in normal flow, except ingredients sharing the same non-blank
// group_label (set in Edit Item, e.g. "Blender") are drawn together inside
// one bordered box instead of as separate standalone chips — for things
// like "these four go in the blender together" vs. a topping added after.
function GroupedChips({ ingredients, openTooltip, setOpenTooltip }) {
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
          <IngredientChip key={seg.item.id ?? seg.item._key ?? i} ing={seg.item} openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
        ) : (
          <div key={i} className="flex items-center gap-1.5 rounded-lg border-2 p-1.5" style={{ borderColor: GROUP_BORDER }}>
            {seg.label && (
              <span className="pl-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: GROUP_BORDER }}>
                {seg.label}
              </span>
            )}
            {seg.items.map((ing) => (
              <IngredientChip key={ing.id ?? ing._key} ing={ing} openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
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
function IngredientMatrix({ ingredients, sizes, openTooltip, setOpenTooltip }) {
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

  function toggle(key) {
    setOpenTooltip?.((cur) => (cur === key ? null : key))
  }
  function showOnHover(key) {
    setOpenTooltip?.(key)
  }
  function hideOnLeave(key) {
    setOpenTooltip?.((cur) => (cur === key ? null : cur))
  }

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
              const name = col.ingredient_master?.name || 'Ingredient'
              const unit = col.ingredient_master?.unit
              const isOpen = openTooltip === colKey
              return (
                <th
                  key={colKey}
                  className="relative cursor-pointer border-b border-r border-gray-200 px-2.5 py-1.5 text-center text-xs whitespace-nowrap"
                  style={{ ...ruleStyle(rule, { header: true }), ...groupBorderStyle(idx) }}
                  onMouseEnter={() => showOnHover(colKey)}
                  onMouseLeave={() => hideOnLeave(colKey)}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(colKey)
                  }}
                >
                  {rule?.abbreviation || name}
                  {isOpen && <NameTooltip name={name} unit={unit} position="bottom" />}
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

function IngredientChip({ ing, openTooltip, setOpenTooltip }) {
  const rule = ing.ingredient_master?.ingredient_format_rules
  const label = rule?.abbreviation || ing.ingredient_master?.name || 'Ingredient'
  const name = ing.ingredient_master?.name || 'Ingredient'
  const unit = ing.ingredient_master?.unit
  const key = ing.id ?? ing._key
  const isOpen = openTooltip === key

  return (
    <span
      className="relative inline-block cursor-pointer rounded-md border px-2 py-1 text-sm"
      style={{
        fontSize: rule?.font_size || '14px',
        color: rule?.font_color || '#1f2937',
        backgroundColor: rule?.background_color || '#fff7ed',
        borderColor: rule?.background_color || '#fed7aa',
        fontWeight: rule?.is_bold ? 700 : 400,
        fontStyle: rule?.is_italic ? 'italic' : 'normal',
      }}
      onMouseEnter={() => setOpenTooltip?.(key)}
      onMouseLeave={() => setOpenTooltip?.((cur) => (cur === key ? null : cur))}
      onClick={(e) => {
        e.stopPropagation()
        setOpenTooltip?.((cur) => (cur === key ? null : key))
      }}
    >
      {label}
      {ing.quantity_text && (
        <>
          {' · '}
          <span>{ing.quantity_text}</span>
        </>
      )}
      {isOpen && <NameTooltip name={name} unit={unit} position="top" />}
    </span>
  )
}
