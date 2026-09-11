'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, useLogin, useRegister } from '@/lib';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { CardBody, CardFooter, CardTitle } from '@/components/ui/Card';
import { persistSession } from '@/lib';

interface RegisterFormProps {
  /** Where to navigate after a successful sign up + auto sign in. */
  redirectTo?: string;
}

/**
 * Sign-up card. On success the user is automatically signed in (when the
 * subsequent login succeeds) and redirected to the dashboard.
 */
export default function RegisterForm({ redirectTo = '/dashboard' }: RegisterFormProps) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [error, setError] = React.useState<string | null>(null);

  const register = useRegister();
  const login = useLogin();

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      await register.mutateAsync({
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
      });

      const session = await login.mutateAsync({
        email: form.email,
        password: form.password,
      });

      if (session.accessToken && session.refreshToken) {
        persistSession({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
        router.push(redirectTo);
        return;
      }

      // MFA enabled straight away — send the user to the challenge page.
      if (session.mfaRequired && session.challenge) {
        window.sessionStorage.setItem('gym.mfaChallenge', session.challenge);
        router.push('/mfa-challenge');
        return;
      }

      router.push('/login');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to create your account. Please try again.',
      );
    }
  };

  const pending = register.isPending || login.isPending;

  return (
    <form className="card card-md" onSubmit={handleSubmit} noValidate>
      <CardBody>
        <CardTitle className="text-center mb-4">Create your account</CardTitle>

        {error && (
          <div className="mb-3">
            <Alert type="danger">{error}</Alert>
          </div>
        )}

        <div className="row">
          <div className="col-6 mb-3">
            <label className="form-label" htmlFor="reg-first-name">First name</label>
            <input
              id="reg-first-name"
              className="form-control"
              required
              value={form.first_name}
              onChange={update('first_name')}
            />
          </div>
          <div className="col-6 mb-3">
            <label className="form-label" htmlFor="reg-last-name">Last name</label>
            <input
              id="reg-last-name"
              className="form-control"
              required
              value={form.last_name}
              onChange={update('last_name')}
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="reg-email">Email address</label>
          <input
            id="reg-email"
            type="email"
            className="form-control"
            autoComplete="email"
            required
            value={form.email}
            onChange={update('email')}
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="reg-phone">Phone <span className="form-label-description">optional</span></label>
          <input
            id="reg-phone"
            className="form-control"
            autoComplete="tel"
            value={form.phone}
            onChange={update('phone')}
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
            type="password"
            className="form-control"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={update('password')}
          />
          <small className="form-hint">Minimum 8 characters.</small>
        </div>

        <div className="form-footer">
          <Button type="submit" variant="primary" className="w-100" loading={pending}>
            Create account
          </Button>
        </div>
      </CardBody>
      <CardFooter className="text-center text-secondary">
        Already have an account? <a href="/login" className="ms-1">Sign in</a>
      </CardFooter>
    </form>
  );
}