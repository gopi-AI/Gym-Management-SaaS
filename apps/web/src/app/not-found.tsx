import type { Metadata } from 'next';
import Empty from '@/components/ui/Empty';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main className="page page-center" id="content">
      <div className="container-tight py-4">
        <Empty
          title="404 — Page not found"
          description="The page you were looking for doesn't exist or has been moved."
          action={
            <a href="/dashboard" className="btn btn-primary">
              Back to dashboard
            </a>
          }
        />
      </div>
    </main>
  );
}