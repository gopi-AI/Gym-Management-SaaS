'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib';

/**
 * Client-side route guard.
 *
 * Renders `children` only when an access token is present, otherwise redirects
 * to the sign-in page. This is a UX guard only — the API remains the source of
 * truth for authorization.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="page page-center">
        <div className="text-secondary">Loading…</div>
      </div>
    );
  }

  return <>{children}</>;
}