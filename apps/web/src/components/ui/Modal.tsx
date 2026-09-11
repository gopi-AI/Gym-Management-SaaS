'use client';

import React from 'react';

type ModalSize = 'sm' | 'lg' | 'xl';

interface ModalProps {
  /** Controls visibility */
  open: boolean;
  /** Called when the user dismisses (backdrop click, close button, Esc) */
  onClose: () => void;
  size?: ModalSize;
  centered?: boolean;
  /** Whether clicking the backdrop closes the modal (default: true) */
  closeOnBackdrop?: boolean;
  /** Whether pressing Escape closes the modal (default: true) */
  closeOnEsc?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Controlled Tabler/Bootstrap modal.
 *
 * Renders the standard `.modal` markup and handles backdrop clicks and the
 * Escape key. Visibility is fully driven by the `open` prop.
 */
export default function Modal({
  open,
  onClose,
  size,
  centered = false,
  closeOnBackdrop = true,
  closeOnEsc = true,
  children,
  className = '',
}: ModalProps) {
  React.useEffect(() => {
    if (!open || !closeOnEsc) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeOnEsc, onClose]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const dialogClasses = [
    'modal-dialog',
    size && `modal-${size}`,
    centered && 'modal-dialog-centered',
    'modal-dialog-scrollable',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {/* Backdrop */}
      <div
        className="modal-backdrop show"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className={`modal show d-block${className ? ` ${className}` : ''}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
      >
        <div className={dialogClasses} role="document">
          <div className="modal-content">{children}</div>
        </div>
      </div>
    </>
  );
}

interface ModalSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalHeader({
  children,
  className = '',
  onClose,
}: ModalSectionProps & { onClose?: () => void }) {
  return (
    <div className={`modal-header${className ? ` ${className}` : ''}`}>
      {children}
      {onClose && (
        <button
          type="button"
          className="btn-close"
          aria-label="Close"
          onClick={onClose}
        />
      )}
    </div>
  );
}

export function ModalTitle({ children, className = '' }: ModalSectionProps) {
  return <h5 className={`modal-title${className ? ` ${className}` : ''}`}>{children}</h5>;
}

export function ModalBody({ children, className = '' }: ModalSectionProps) {
  return <div className={`modal-body${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function ModalFooter({ children, className = '' }: ModalSectionProps) {
  return <div className={`modal-footer${className ? ` ${className}` : ''}`}>{children}</div>;
}