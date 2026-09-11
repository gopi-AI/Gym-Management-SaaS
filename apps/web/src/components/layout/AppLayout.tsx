'use client';

import React from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import PageHeader from './PageHeader';
import Footer from './Footer';

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  pretitle?: string;
  description?: string;
  /** Active menu entry, e.g. "dashboard" */
  pageMenu?: string;
  containerCentered?: boolean;
  wrapperFull?: boolean;
  /** Extra actions rendered in the page header */
  headerActions?: React.ReactNode;
}

/**
 * AppLayout — the authenticated dashboard shell.
 *
 * Renders the Tabler vertical sidebar + top navbar + page header + content
 * area + footer.  Use this layout for all protected pages.
 */
export default function AppLayout({
  children,
  title,
  pretitle,
  description,
  pageMenu,
  containerCentered = false,
  wrapperFull = false,
  headerActions,
}: AppLayoutProps) {
  return (
    <div className="page">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <Sidebar activeMenu={pageMenu} />

      {/* ── Top Navbar ──────────────────────────────────────────── */}
      <Navbar activeMenu={pageMenu} />

      {/* ── Page Wrapper ────────────────────────────────────────── */}
      <div className={`page-wrapper${wrapperFull ? ' page-wrapper-full' : ''}`}>
        {/* Page Header */}
        {title && (
          <PageHeader
            title={title}
            pretitle={pretitle}
            description={description}
          >
            {headerActions}
          </PageHeader>
        )}

        {/* Page Body */}
        <main id="content" className="page-body">
          {wrapperFull ? (
            children
          ) : (
            <div className={`container-xl${containerCentered ? ' my-auto' : ''}`}>
              {children}
            </div>
          )}
        </main>

        {/* Footer */}
        <Footer />
      </div>
    </div>
  );
}