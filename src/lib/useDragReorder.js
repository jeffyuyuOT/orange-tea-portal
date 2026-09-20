import { createElement, useState } from 'react'

// Native HTML5 drag & drop reordering for a plain list — deliberately no
// extra dependency (a past drag/style library broke the whole app on load,
// see git history around xlsx-js-style), so this is hand-rolled with the
// browser's own draggable/dragover/drop events.
//
// The drag only starts from a small handle element (spread `handleProps`
// onto it), not the whole row — so clicking an item's name still opens it
// instead of accidentally starting a drag. The row itself gets `rowProps`
// so it can highlight as a drop target and accept the drop anywhere along
// its height, not just exactly on the handle.
//
// `items` needs stable `.id`s. `onReorder(nextItems)` fires once, on drop,
// with the whole re-ordered array — the caller is responsible for saving
// (usually: optimistically setItems(next), then persist sequential
// sort_order values for every item in `next`).
export function useDragReorder(items, onReorder) {
  const [draggedId, setDraggedId] = useState(null)
  const [overId, setOverId] = useState(null)

  function handleProps(id) {
    return {
      draggable: true,
      onDragStart: (e) => {
        setDraggedId(id)
        e.dataTransfer.effectAllowed = 'move'
        // Firefox requires data to be set for the drag to start at all.
        e.dataTransfer.setData('text/plain', String(id))
      },
      onDragEnd: () => {
        setDraggedId(null)
        setOverId(null)
      },
    }
  }

  function rowProps(id) {
    return {
      onDragOver: (e) => {
        if (draggedId == null) return
        e.preventDefault()
        if (overId !== id) setOverId(id)
      },
      onDrop: (e) => {
        e.preventDefault()
        if (draggedId != null && draggedId !== id) {
          const from = items.findIndex((i) => i.id === draggedId)
          const to = items.findIndex((i) => i.id === id)
          if (from !== -1 && to !== -1) {
            const next = [...items]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            onReorder(next)
          }
        }
        setDraggedId(null)
        setOverId(null)
      },
      isDragging: draggedId === id,
      isDropTarget: overId === id && draggedId !== id,
    }
  }

  return { handleProps, rowProps }
}

// Small "⠿" grab-handle button — shared look across the reorderable lists.
// Written with createElement (not JSX) because this is a plain .js file —
// Vite's oxc transformer only parses JSX syntax in .jsx/.tsx files, and
// using JSX here failed the whole build ("Unexpected JSX expression").
export function DragHandle(props) {
  return createElement(
    'span',
    {
      ...props,
      className: 'cursor-grab select-none px-1.5 text-lg leading-none text-gray-300 hover:text-gray-500 active:cursor-grabbing',
      title: 'Drag to reorder',
    },
    '⠿'
  )
}
