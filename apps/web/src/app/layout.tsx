import type { Metadata } from 'next';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Gym Management',
    template: '%s — Gym Management',
  },
  description: 'Gym Management SaaS platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-bs-theme="light" data-theme="light" data-bs-navbar-position="vertical">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta httpEquiv="X-UA-Compatible" content="ie=edge" />
      </head>
      <body className="layout-fluid">
        <Providers>{children}</Providers>
        <script
          src="https://cdn.jsdelivr.net/npm/@tabler/core@latest/dist/js/tabler.min.js"
          defer
        />
      </body>
    </html>
  );
}