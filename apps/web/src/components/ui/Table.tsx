'use client';

import React from 'react';

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  striped?: boolean;
  hover?: boolean;
  responsive?: boolean;
  cardTable?: boolean;
  nowrap?: boolean;
}

/**
 * Tabler `.table` component.
 *
 * Set `responsive` to wrap the table in a horizontally scrollable container, and
 * `cardTable` when the table lives inside a card (removes duplicated border).
 */
export default function Table({
  children,
  striped = false,
  hover = false,
  responsive = false,
  cardTable = false,
  nowrap = false,
  className = '',
  ...rest
}: TableProps) {
  const classes = [
    'table',
    striped && 'table-striped',
    hover && 'table-hover',
    cardTable && 'table-card',
    nowrap && 'table-nowrap',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const table = (
    <table className={classes} {...rest}>
      {children}
    </table>
  );

  if (responsive) {
    return <div className="table-responsive">{table}</div>;
  }

  return table;
}

export function THead({ children, ...rest }: React.HTMLAttributes<HTMLTableSectionElement> & { children: React.ReactNode }) {
  return <thead {...rest}>{children}</thead>;
}

export function TBody({ children, ...rest }: React.HTMLAttributes<HTMLTableSectionElement> & { children: React.ReactNode }) {
  return <tbody {...rest}>{children}</tbody>;
}

export function THeadRow({ children, ...rest }: React.HTMLAttributes<HTMLTableRowElement> & { children: React.ReactNode }) {
  return <tr {...rest}>{children}</tr>;
}

export function TBodyRow({ children, ...rest }: React.HTMLAttributes<HTMLTableRowElement> & { children: React.ReactNode }) {
  return <tr {...rest}>{children}</tr>;
}

export function Th({ children, className = '', ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { children?: React.ReactNode }) {
  return (
    <th className={className} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = '', ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { children?: React.ReactNode }) {
  return (
    <td className={className} {...rest}>
      {children}
    </td>
  );
}