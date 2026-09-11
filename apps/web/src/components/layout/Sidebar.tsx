'use client';

import React from 'react';

interface SidebarProps {
  activeMenu?: string;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
}

/**
 * Side navigation menu — the vertical sidebar in Tabler style.
 *
 * Uses the `<aside class="navbar navbar-vertical">` layout with a
 * collapsible menu and a user footer.
 */
export default function Sidebar({
  activeMenu = '',
  userName = 'Gym Manager',
  userRole = 'Administrator',
  userAvatar,
}: SidebarProps) {
  return (
    <aside
      className="navbar navbar-vertical navbar-expand-lg"
      data-bs-theme="dark"
    >
      <div className="container-fluid">
        {/* ── Mobile toggler ────────────────────────────────────── */}
        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#sidebar-menu"
          aria-controls="sidebar-menu"
          aria-expanded="false"
          aria-label="Toggle sidebar navigation"
        >
          <span className="navbar-toggler-icon" />
        </button>

        {/* ── Brand Logo ────────────────────────────────────────── */}
        <div className="navbar-brand navbar-brand-autodark">
          <a href="/dashboard" aria-label="Gym Management">
            <SidebarLogoMark />
          </a>
        </div>

        {/* ── Mobile user toggle ────────────────────────────────── */}
        <div className="navbar-nav flex-row d-lg-none">
          <div className="nav-item">
            <a href="/settings" className="nav-link" aria-label="Settings">
              <SettingsIcon />
            </a>
          </div>
        </div>

        {/* ── Sidebar Menu ──────────────────────────────────────── */}
        <nav className="collapse navbar-collapse" id="sidebar-menu" aria-label="Sidebar">
          <ul className="navbar-nav pt-lg-3">
            <SidebarSection title="Overview" />
            <SidebarItem
              icon="home"
              label="Dashboard"
              href="/dashboard"
              active={activeMenu === 'dashboard'}
            />

            <SidebarSection title="Management" />
            <SidebarItem
              icon="users"
              label="Members"
              href="/members"
              active={activeMenu === 'members'}
            />
            <SidebarItem
              icon="building-store"
              label="Branches"
              href="/branches"
              active={activeMenu === 'branches'}
            />
            <SidebarItem
              icon="building"
              label="Organizations"
              href="/organizations"
              active={activeMenu === 'organizations'}
            />

            <SidebarSection title="System" />
            <SidebarItem
              icon="settings"
              label="Settings"
              href="/settings"
              active={activeMenu === 'settings'}
            />
          </ul>

          {/* ── Sidebar Footer (user) ───────────────────────────── */}
          <SidebarUserFooter
            userName={userName}
            userRole={userRole}
            userAvatar={userAvatar}
          />
        </nav>
      </div>
    </aside>
  );
}

/* ── Sidebar sub-components ────────────────────────────────────────────── */

function SidebarSection({ title }: { title: string }) {
  return <li className="nav-section-title">{title}</li>;
}

interface SidebarItemProps {
  icon: string;
  label: string;
  href: string;
  active?: boolean;
  badge?: string;
}

function SidebarItem({ icon, label, href, active, badge }: SidebarItemProps) {
  return (
    <li className={`nav-item${active ? ' active' : ''}`}>
      <a className="nav-link" href={href} aria-current={active ? 'page' : undefined}>
        <span className="nav-link-icon">
          <SidebarIcon name={icon} />
        </span>
        <span className="nav-link-title">{label}</span>
        {badge && <span className="badge badge-sm bg-red text-red-fg ms-auto">{badge}</span>}
      </a>
    </li>
  );
}

/* ── Sidebar footer — current user + sign out ─────────────────────────────── */

interface SidebarUserFooterProps {
  userName: string;
  userRole: string;
  userAvatar?: string;
}

function SidebarUserFooter({ userName, userRole, userAvatar }: SidebarUserFooterProps) {
  return (
    <div className="navbar-footer">
      <ul className="navbar-nav">
        <li className="nav-item dropup">
          <a href="#" className="nav-link" data-bs-toggle="dropdown" aria-label="Open user menu">
            <AvatarSM userAvatar={userAvatar} />
            <span className="nav-link-title">
              {userName}
              <div className="small text-secondary">{userRole}</div>
            </span>
          </a>
          <div className="dropdown-menu">
            <a className="dropdown-item" href="/settings">
              <span className="dropdown-item-icon"><SettingsGlyph /></span>
              Settings
            </a>
            <div className="dropdown-divider" />
            <a className="dropdown-item" href="/login">
              <span className="dropdown-item-icon"><LogoutGlyph /></span>
              Sign out
            </a>
          </div>
        </li>
      </ul>
    </div>
  );
}

function AvatarSM({ userAvatar }: { userAvatar?: string }) {
  if (userAvatar) {
    return (
      <span className="avatar avatar-sm">
        <img src={userAvatar} alt="" />
      </span>
    );
  }
  return (
    <span className="avatar avatar-sm">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="icon"
        width="24" height="24" viewBox="0 0 24 24"
        strokeWidth="2" stroke="currentColor" fill="none"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
        <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
      </svg>
    </span>
  );
}
function SettingsGlyph() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24"
      viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.066 2.573c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.573 1.066c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.066 -2.573c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1.008 .613 2.21 .037 2.573 -1.066z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function LogoutGlyph() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24"
      viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />
      <path d="M20 12h-13l3 -3m0 6l-3 -3" />
    </svg>
  );
}

function SidebarLogoMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 68 68"
      className="navbar-brand-image" aria-label="Gym Management"
    >
      <path
        d="M64.6 16.2C63 9.9 58.1 5 51.8 3.4 40 1.5 28 1.5 16.2 3.4 9.9 5 5 9.9 3.4 16.2 1.5 28 1.5 40 3.4 51.8 5 58.1 9.9 63 16.2 64.6c11.8 1.9 23.8 1.9 35.6 0C58.1 63 63 58.1 64.6 51.8c1.9-11.8 1.9-23.8 0-35.6zM33.3 36.3c-2.8 4.4-6.6 8.2-11.1 11-1.5.9-3.3.9-4.8.1s-2.4-2.3-2.5-4c0-1.7.9-3.3 2.4-4.1 2.3-1.4 4.4-3.2 6.1-5.3-1.8-2.1-3.8-3.8-6.1-5.3-2.3-1.3-3-4.2-1.7-6.4s4.3-2.9 6.5-1.6c4.5 2.8 8.2 6.5 11.1 10.9 1 1.4 1 3.3.1 4.7zM49.2 46H37.8c-2.1 0-3.8-1-3.8-3s1.7-3 3.8-3h11.4c2.1 0 3.8 1 3.8 3s-1.7 3-3.8 3z"
        fill="#066fd1"
        style={{ fill: 'var(--tblr-navbar-logo-color, var(--tblr-primary, #066fd1))' }}
      />
    </svg>
  );
}

function SettingsIcon() {
  return <SettingsGlyph />;
}
/* ── Inline SVG icon lookup ────────────────────────────────────────────────────── */

const ICON_PATHS: Record<string, React.ReactNode> = {
  home: (
    <>
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 12l-2 0l9 -9l9 9l-2 0" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />
      <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />
    </>
  ),
  users: (
    <>
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0 -3 -3.87" />
    </>
  ),
  'building-store': (
    <>
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 21l1 -17h16l1 17" />
      <path d="M7 7v.01" />
      <path d="M12 7v.01" />
      <path d="M17 7v.01" />
      <path d="M3 12a3 3 0 0 0 3 3a3 3 0 0 0 3 -3a3 3 0 0 0 3 3a3 3 0 0 0 3 -3a3 3 0 0 0 3 3a3 3 0 0 0 3 0" />
      <path d="M5 21h14" />
    </>
  ),
  building: (
    <>
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 21l18 0" />
      <path d="M9 8l1 0" />
      <path d="M9 12l1 0" />
      <path d="M9 16l1 0" />
      <path d="M14 8l1 0" />
      <path d="M14 12l1 0" />
      <path d="M14 16l1 0" />
      <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />
    </>
  ),
  settings: (
    <>
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.066 2.573c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.573 1.066c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.066 -2.573c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1.008 .613 2.21 .037 2.573 -1.066z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

function SidebarIcon({ name }: { name: string }) {
  const children = ICON_PATHS[name];
  if (!children) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="icon"
      width="24" height="24" viewBox="0 0 24 24"
      strokeWidth="2" stroke="currentColor" fill="none"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {children}
    </svg>
  );
}
