'use client';

import React from 'react';

export interface TabItem {
  /** Stable key, compared against `active`. */
  key: string;
  label: string;
}

interface TabsProps {
  items: readonly TabItem[];
  /** Key of the currently selected tab. */
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Tabler `.nav-tabs` navigation.
 *
 * Presentational: the caller owns the active key and renders the panel for it.
 * Tabs are rendered as buttons (not links) so switching never navigates, and
 * each one is wired to its panel by the shared id convention — the tab button
 * is `tab-${key}` with `aria-controls="panel-${key}"`, and the matching panel
 * carries `id="panel-${key}"` and `aria-labelledby="tab-${key}"`.
 */
export default function Tabs({ items, active, onChange, className = '' }: TabsProps) {
  return (
    <ul className={`nav nav-tabs${className ? ` ${className}` : ''}`} role="tablist">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <li className="nav-item" role="presentation" key={item.key}>
            <button
              type="button"
              role="tab"
              id={`tab-${item.key}`}
              aria-controls={`panel-${item.key}`}
              aria-selected={isActive}
              className={`nav-link${isActive ? ' active' : ''}`}
              onClick={() => onChange(item.key)}
            >
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
