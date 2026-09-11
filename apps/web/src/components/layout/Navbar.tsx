'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { authApi, clearTokens, decodeJwt, getAccessToken, getRefreshToken } from '@/lib';

interface NavbarProps {
  activeMenu?: string;
  userName?: string;
}

/**
 * Top navigation bar in Tabler style.
 *
 * Renders the `<header class="navbar navbar-expand-md">` with brand logo,
 * collapse menu toggler, and right-side user/notification icon group.
 */
export default function Navbar({ userName = '' }: NavbarProps) {
  return (
    <>
      {/* ── Top Navbar ────────────────────────────────────────────────── */}
      <header className="navbar navbar-expand-md d-print-none" data-bs-theme="dark">
        <div className="container-xl">
          {/* Mobile: toggles the collapsed sidebar menu (rendered outside this header). */}
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navbar-menu"
            aria-controls="navbar-menu"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon" />
          </button>

          {/* ── Right side: theme toggle + user dropdown ──────────────── */}
          <div className="navbar-nav flex-row order-md-last">
            <NavbarUserDropdown userName={userName} />
          </div>

          {/* ── Collapsible menu area (horizontal items) ──────────────── */}
          <div className="collapse navbar-collapse" id="navbar-menu">
            <div className="d-flex flex-column flex-md-row flex-fill align-items-stretch align-items-md-center">
              <nav aria-label="Primary" />
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

/* ── User dropdown in the top navbar ──────────────────────────────────── */

function NavbarUserDropdown({ userName }: { userName: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(userName);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    if (userName) {
      setDisplayName(userName);
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    const payload = decodeJwt(token);
    if (payload?.email) setDisplayName(payload.email);
  }, [userName]);

  const handleSignOut = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authApi.logout(getRefreshToken() ?? undefined);
    } catch {
      // Best-effort server logout; always clear locally.
      clearTokens();
    }
    router.push('/login');
  };

  return (
    <div className="nav-item dropdown">
      <a
        href="#"
        className="nav-link d-flex lh-1 text-reset p-0"
        data-bs-toggle="dropdown"
        aria-label="Open user menu"
      >
        <span className="avatar avatar-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="icon"
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
            <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
            <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
          </svg>
        </span>
        <div className="d-none d-xl-block ps-2">
          <div>{displayName || 'Administrator'}</div>
        </div>
      </a>
      <div className="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
        <a className="dropdown-item" href="/settings">Settings</a>
        <div className="dropdown-divider" />
        <a className="dropdown-item" href="/login" onClick={handleSignOut}>
          Sign out
        </a>
      </div>
    </div>
  );
}