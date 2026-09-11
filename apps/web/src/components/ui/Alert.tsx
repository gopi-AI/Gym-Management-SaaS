'use client';

import React from 'react';

type AlertType = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps {
  type?: AlertType;
  dismissible?: boolean;
  title?: string;
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
}

const ALERT_CLASS: Record<AlertType, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  danger: 'alert-danger',
};

/**
 * Bootstrap / Tabler alert component.
 */
export default function Alert({
  type = 'info',
  dismissible = false,
  title,
  children,
  className = '',
  onClose,
}: AlertProps) {
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <div
      className={`alert ${ALERT_CLASS[type]}${dismissible ? ' alert-dismissible' : ''}${className ? ` ${className}` : ''}`}
      role="alert"
    >
      {title && <h4 className="alert-title">{title}</h4>}
      {children}
      {dismissible && (
        <button
          type="button"
          className="btn-close"
          aria-label="Dismiss"
          onClick={() => {
            setDismissed(true);
            onClose?.();
          }}
        />
      )}
    </div>
  );
}