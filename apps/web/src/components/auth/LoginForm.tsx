'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, persistSession } from '@/lib';
import { useLogin } from '@/lib';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardTitle } from '@/components/ui/Card';

interface LoginFormProps {
  /** Where to navigate after a successful (non-MFA) sign in. */
  redirectTo?: string;
  /** Route used to complete an MFA challenge. */
  mfaRoute?: string;
}

/**
 * Sign-in card with email/password fields.
 *
 * On success it either stores the token pair and redirects, or forwards the
 * MFA challenge to the challenge page.
 */
export default function LoginForm({
  redirectTo = '/dashboard',
  mfaRoute = '/mfa-challenge',
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const login = useLogin({
    onSuccess: (data) => {
      if (data.mfaRequired && data.challenge) {
        window.sessionStorage.setItem('gym.mfaChallenge', data.challenge);
        router.push(mfaRoute);
        return;
      }

      if (data.accessToken && data.refreshToken) {
        persistSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
        router.push(redirectTo);
        return;
      }

      setError('Unexpected response from the server.');
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.',
      );
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    login.mutate({ email, password });
  };

  return (
    <form className="card card-md" onSubmit={handleSubmit} noValidate>
      <CardBody>
        <CardTitle className="text-center mb-4">Sign in to your account</CardTitle>

        {error && (
          <div className="mb-3">
            <Alert type="danger">{error}</Alert>
          </div>
        )}

        <div className="mb-3">
          <label className="form-label" htmlFor="login-email">
            Email address
          </label>
          <input
            id="login-email"
            type="email"
            className="form-control"
            placeholder="you@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="mb-2">
          <label className="form-label" htmlFor="login-password">
            Password
            <span className="form-label-description">
              <a href="/forgot-password">Forgot password?</a>
            </span>
          </label>
          <input
            id="login-password"
            type="password"
            className="form-control"
            placeholder="Your password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="form-footer">
          <Button type="submit" variant="primary" className="w-100" loading={login.isPending}>
            Sign in
          </Button>
        </div>
      </CardBody>
      <CardFooter className="text-center text-secondary">
        Don&apos;t have an account?{' '}
        <a href="/register" className="ms-1">Sign up</a>
      </CardFooter>
    </form>
  );
}