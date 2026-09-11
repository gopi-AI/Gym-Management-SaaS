'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, persistSession, useVerifyMfa } from '@/lib';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { CardBody, CardTitle } from '@/components/ui/Card';

interface MfaFormProps {
  /** Where to navigate once the challenge is verified. */
  redirectTo?: string;
}

const CHALLENGE_KEY = 'gym.mfaChallenge';

/**
 * MFA challenge card. Reads the short-lived challenge token left by the login
 * flow and exchanges it (plus a TOTP code) for the access/refresh pair.
 */
export default function MfaForm({ redirectTo = '/dashboard' }: MfaFormProps) {
  const router = useRouter();
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [otpCode, setOtpCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = window.sessionStorage.getItem(CHALLENGE_KEY);
    if (!stored) {
      setError('Your verification session has expired. Please sign in again.');
      return;
    }
    setChallenge(stored);
  }, []);

  const verify = useVerifyMfa({
    onSuccess: (tokens) => {
      persistSession(tokens);
      window.sessionStorage.removeItem(CHALLENGE_KEY);
      router.push(redirectTo);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Invalid code. Please check your authenticator app.',
      );
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!challenge) return;
    verify.mutate({ challengeToken: challenge, otpCode });
  };

  return (
    <form className="card card-md" onSubmit={handleSubmit} noValidate>
      <CardBody>
        <CardTitle className="text-center mb-3">Two-factor verification</CardTitle>
        <p className="text-secondary text-center mb-4">
          Enter the 6-digit code from your authenticator app.
        </p>

        {error && (
          <div className="mb-3">
            <Alert type={challenge ? 'danger' : 'warning'}>{error}</Alert>
          </div>
        )}

        <div className="mb-3">
          <label className="form-label" htmlFor="mfa-code">Authentication code</label>
          <input
            id="mfa-code"
            className="form-control"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            required
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="form-footer">
          <Button
            type="submit"
            variant="primary"
            className="w-100"
            loading={verify.isPending}
            disabled={!challenge}
          >
            Verify
          </Button>
        </div>

        <div className="text-center text-secondary mt-3">
          <a href="/login">Back to sign in</a>
        </div>
      </CardBody>
    </form>
  );
}