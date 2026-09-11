'use client';

import React from 'react';

interface PageHeaderProps {
  title: string;
  pretitle?: string;
  description?: string;
  children?: React.ReactNode;
}

/**
 * Page header with title, optional pre-title and description, and action slot.
 */
export default function PageHeader({
  title,
  pretitle,
  description,
  children,
}: PageHeaderProps) {
  return (
    <div className="page-header d-print-none">
      <div className="container-xl">
        <div className="row g-2 align-items-center">
          <div className="col">
            {pretitle && (
              <div className="page-pretitle">{pretitle}</div>
            )}
            <h2 className="page-title">{title}</h2>
            {description && (
              <div className="text-secondary mt-1">{description}</div>
            )}
          </div>
          {children && (
            <div className="col-auto ms-auto d-print-none">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}