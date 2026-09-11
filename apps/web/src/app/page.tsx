import { redirect } from 'next/navigation';

/**
 * Root route — send visitors straight to the sign-in screen.
 */
export default function HomePage() {
  redirect('/login');
}