'use client';

import React from 'react';

interface PaginationProps {
  children: React.ReactNode;
  className?: string;
  /** `end` (default) or `center` alignment wrapper */
  align?: 'start' | 'center' | 'end';
}

/**
 * Tabler `.pagination` list container.
 */
export function Pagination({
  children,
  className = '',
  align = 'end',
}: PaginationProps) {
  const alignClass =
    align === 'center' ? 'justify-content-center' : align === 'start' ? 'justify-content-start' : '';

  return (
    <ul className={`pagination${className ? ` ${className}` : ''}${alignClass ? ` ${alignClass}` : ''}`}>
      {children}
    </ul>
  );
}

interface PageItemProps {
  children?: React.ReactNode;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  /** Render as a non-interactive ellipsis */
  dots?: boolean;
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * A single `.page-item`. Renders an `<a class="page-link">` when `href` is set,
 * otherwise a `<span>`/`<button>`.
 */
export function PageItem({
  children,
  href,
  active = false,
  disabled = false,
  dots = false,
  onClick,
  className = '',
  ...rest
}: PageItemProps) {
  const itemClasses = [
    'page-item',
    active && 'active',
    disabled && 'disabled',
    dots && 'disabled',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (dots) {
    return (
      <li className={itemClasses}>
        <span className="page-link">…</span>
      </li>
    );
  }

  if (href && !disabled && !active) {
    return (
      <li className={itemClasses}>
        <a className="page-link" href={href} onClick={onClick} {...rest}>
          {children}
        </a>
      </li>
    );
  }

  return (
    <li className={itemClasses}>
      <button
        type="button"
        className="page-link"
        disabled={disabled}
        onClick={onClick}
        {...rest}
      >
        {children}
      </button>
    </li>
  );
}

export default Pagination;