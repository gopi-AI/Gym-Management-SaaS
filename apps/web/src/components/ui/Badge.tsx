'use client';

import React from 'react';

type BadgeColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'red'
  | 'green'
  | 'blue'
  | 'azure'
  | string;

interface BadgeProps {
  color?: BadgeColor;
  pill?: boolean;
  /** Render the soft/light variant (e.g. bg-green-lt) instead of solid. */
  light?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Tabler badge component.
 *
 * By default renders the soft variant (`bg-{color}-lt`), which pairs with
 * Tabler's automatic foreground colour. Set `light={false}` for the solid
 * coloured badge.
 */
export default function Badge({
  color = 'primary',
  pill = false,
  light = true,
  children,
  className = '',
}: BadgeProps) {
  const classes = [
    'badge',
    color && `bg-${color}${light ? '-lt' : ''}`,
    pill && 'badge-pill',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <span className={classes}>{children}</span>;
}