import Modal from '../../../components/ui/Modal'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function TipsModal({ category, onClose }) {
  return (
    <Modal open={!!category} onClose={onClose} title={`${category?.name ?? ''} — Tips`}>
      {category?.tips_content ? (
        <RichTextViewer html={category.tips_content} />
      ) : (
        <EmptyState label="No tips added for this category yet." />
      )}
    </Modal>
  )
}
