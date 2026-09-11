import type { Metadata } from 'next';
import AuthLayout from '@/components/layout/AuthLayout';
import Alert from '@/components/ui/Alert';
import { Card, CardBody, CardTitle } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Reset password',
};

export default function ForgotPasswordPage() {
  return (
    <AuthLayout hideLogo={false}>
      <div className="card card-md">
        <CardBody>
          <CardTitle className="text-center mb-4">Reset your password</CardTitle>

          <Alert type="info">
            Password recovery is not yet enabled. Please contact your
            organization administrator to reset your credentials.
          </Alert>

          <div className="text-center text-secondary mt-3">
            <a href="/login">Back to sign in</a>
          </div>
        </CardBody>
      </div>
    </AuthLayout>
  );
}