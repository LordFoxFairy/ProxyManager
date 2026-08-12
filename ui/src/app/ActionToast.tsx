import { CircleCheck, CircleX, Info, X } from 'lucide-react';
import type { ToastMessage } from './types';

export function ActionToast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  return (
    <div className={`action-toast ${toast.tone}`} role="status" aria-live="polite">
      <span className="action-toast-icon">
        {toast.tone === 'success'
          ? <CircleCheck size={18} />
          : toast.tone === 'danger'
            ? <CircleX size={18} />
            : <Info size={18} />}
      </span>
      <div>
        <strong>{toast.title}</strong>
        <span>{toast.detail}</span>
      </div>
      <button title="关闭提示" onClick={onClose}><X size={15} /></button>
    </div>
  );
}
