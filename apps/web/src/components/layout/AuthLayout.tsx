'use client';

import React from 'react';

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  /** Container size: 'tight' (default, ~400px), 'normal', or a custom container class */
  containerSize?: 'tight' | 'normal';
  hideLogo?: boolean;
}

/**
 * AuthLayout — centered authentication shell (sign in, sign up, MFA, etc.).
 *
 * Renders the Tabler "page page-center" layout with an optional logo
 * heading, perfect for single-card auth pages.
 */
export default function AuthLayout({
  children,
  title,
  containerSize = 'tight',
  hideLogo = false,
}: AuthLayoutProps) {
  return (
    <main className="page page-center" id="content">
      <div className={`container container-${containerSize} py-4`}>
        {!hideLogo && (
          <div className="text-center mb-4">
            {/* ── Brand logo SVG (Tabler-style) ────────────────── */}
            <a href="/" aria-label="Gym Management" className="navbar-brand navbar-brand-autodark">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="110"
                height="32"
                viewBox="0 0 232 68"
                className="navbar-brand-image"
                aria-label="Gym Management"
              >
                <path
                  d="M64.6 16.2C63 9.9 58.1 5 51.8 3.4 40 1.5 28 1.5 16.2 3.4 9.9 5 5 9.9 3.4 16.2 1.5 28 1.5 40 3.4 51.8 5 58.1 9.9 63 16.2 64.6c11.8 1.9 23.8 1.9 35.6 0C58.1 63 63 58.1 64.6 51.8c1.9-11.8 1.9-23.8 0-35.6zM33.3 36.3c-2.8 4.4-6.6 8.2-11.1 11-1.5.9-3.3.9-4.8.1s-2.4-2.3-2.5-4c0-1.7.9-3.3 2.4-4.1 2.3-1.4 4.4-3.2 6.1-5.3-1.8-2.1-3.8-3.8-6.1-5.3-2.3-1.3-3-4.2-1.7-6.4s4.3-2.9 6.5-1.6c4.5 2.8 8.2 6.5 11.1 10.9 1 1.4 1 3.3.1 4.7zM49.2 46H37.8c-2.1 0-3.8-1-3.8-3s1.7-3 3.8-3h11.4c2.1 0 3.8 1 3.8 3s-1.7 3-3.8 3z"
                  fill="#066fd1"
                  style={{ fill: 'var(--tblr-navbar-logo-color, var(--tblr-primary, #066fd1))' }}
                />
              </svg>
            </a>
          </div>
        )}

        {children}

        {/* Title rendered below the card if provided */}
        {title && !hideLogo && (
          <div className="text-center text-secondary mt-3">
            <p>{title}</p>
          </div>
        )}
      </div>
    </main>
  );
}