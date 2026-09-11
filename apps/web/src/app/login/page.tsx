import type { Metadata } from 'next';
import AuthLayout from '@/components/layout/AuthLayout';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <AuthLayout title="Gym Management — manage your facilities with ease.">
      <LoginForm />
    </AuthLayout>
  );
}