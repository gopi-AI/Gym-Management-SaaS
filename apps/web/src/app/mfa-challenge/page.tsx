import type { Metadata } from 'next';
import AuthLayout from '@/components/layout/AuthLayout';
import MfaForm from '@/components/auth/MfaForm';

export const metadata: Metadata = {
  title: 'Two-factor verification',
};

export default function MfaChallengePage() {
  return (
    <AuthLayout hideLogo={false}>
      <MfaForm />
    </AuthLayout>
  );
}