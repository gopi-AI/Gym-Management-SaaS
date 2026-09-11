'use client';

import React from 'react';

interface EmptyProps {
  /** Small description rendered under the title */
  title?: string;
  description?: string;
  /** Inline icon rendered above the title. Pass any React node (e.g. an SVG). */
  icon?: React.ReactNode;
  /** Optional call-to-action rendered below the description */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Tabler `.empty` state placeholder.
 *
 * Use for empty lists, loading placeholders and generic error states.
 */
export default function Empty({
  title = 'No data found',
  description,
  icon,
  action,
  className = '',
  children,
}: EmptyProps) {
  return (
    <div className={`empty${className ? ` ${className}` : ''}`}>
      <div className="empty-header">
        {icon ?? <DefaultEmptyIcon />}
      </div>
      <p className="empty-title">{title}</p>
      {description && <p className="empty-subtitle text-secondary">{description}</p>}
      {children}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

function DefaultEmptyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="icon icon-lg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="currentColor"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 8l16 0" />
      <path d="M4 16l16 0" />
      <path d="M9 4l0 16" />
      <path d="M15 4l0 16" />
    </svg>
  );
}