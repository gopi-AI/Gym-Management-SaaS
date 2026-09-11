'use client';

import React from 'react';

/**
 * Minimal footer in Tabler style.
 */
export default function Footer() {
  return (
    <footer className="footer footer-transparent d-print-none">
      <div className="container-xl">
        <div className="row text-center align-items-center flex-row-reverse">
          <div className="col-lg-auto ms-lg-auto">
            <ul className="list-inline list-inline-dots mb-0">
              <li className="list-inline-item">
                <a href="/docs" className="link-secondary">Documentation</a>
              </li>
              <li className="list-inline-item">
                <a href="https://github.com" target="_blank" className="link-secondary" rel="noopener">Source code</a>
              </li>
            </ul>
          </div>
          <div className="col-12 col-lg-auto mt-3 mt-lg-0">
            <ul className="list-inline list-inline-dots mb-0">
              <li className="list-inline-item">
                Copyright &copy; {new Date().getFullYear()}
                {' '}
                <a href="/" className="link-secondary">Gym Management</a>.
                All rights reserved.
              </li>
              <li className="list-inline-item">v0.1.0</li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}