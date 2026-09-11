'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { ApiError, getOrganizationId, useTenantSettings, useUpdateTenantSettings } from '@/lib';

function SettingsContent() {
  const [orgId, setOrgId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<{ type: 'success' | 'danger'; message: string } | null>(
    null,
  );

  React.useEffect(() => {
    setOrgId(getOrganizationId());
  }, []);

  const settingsQuery = useTenantSettings(orgId ?? '');

  const [form, setForm] = React.useState({
    time_zone: '',
    locale: '',
    currency: '',
  });

  React.useEffect(() => {
    if (settingsQuery.data) {
      setForm({
        time_zone: settingsQuery.data.time_zone,
        locale: settingsQuery.data.locale,
        currency: settingsQuery.data.currency,
      });
    }
  }, [settingsQuery.data]);

  const update = useUpdateTenantSettings({
    onSuccess: () => setStatus({ type: 'success', message: 'Settings saved.' }),
    onError: (err) =>
      setStatus({
        type: 'danger',
        message: err instanceof ApiError ? err.message : 'Failed to save settings.',
      }),
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    if (!orgId) return;
    update.mutate({ orgId, payload: form });
  };

  return (
    <AppLayout title="Settings" pretitle="System" pageMenu="settings">
      {!orgId ? (
        <Card>
          <CardBody>
            <Empty
              title="No organization selected"
              description="Select an organization before configuring tenant settings."
              action={
                <Button variant="primary" onClick={() => (window.location.href = '/organizations')}>
                  Choose organization
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="row row-cards">
          <div className="col-lg-6">
            <Card>
              <CardBody>
                <h3 className="card-title">Tenant settings</h3>

                {status && (
                  <Alert type={status.type} className="mb-3" dismissible>
                    {status.message}
                  </Alert>
                )}

                {settingsQuery.isError && (
                  <Alert type="warning" className="mb-3">
                    {settingsQuery.error instanceof ApiError
                      ? settingsQuery.error.message
                      : 'Unable to load settings.'}
                  </Alert>
                )}

                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label className="form-label" htmlFor="settings-timezone">Time zone</label>
                    <input
                      id="settings-timezone"
                      className="form-control"
                      placeholder="UTC"
                      value={form.time_zone}
                      onChange={(e) => setForm({ ...form, time_zone: e.target.value })}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label" htmlFor="settings-locale">Locale</label>
                    <input
                      id="settings-locale"
                      className="form-control"
                      placeholder="en-US"
                      value={form.locale}
                      onChange={(e) => setForm({ ...form, locale: e.target.value })}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label" htmlFor="settings-currency">Currency</label>
                    <input
                      id="settings-currency"
                      className="form-control"
                      placeholder="USD"
                      maxLength={3}
                      value={form.currency}
                      onChange={(e) =>
                        setForm({ ...form, currency: e.target.value.toUpperCase() })
                      }
                    />
                  </div>

                  <div className="form-footer">
                    <Button type="submit" variant="primary" loading={update.isPending}>
                      Save settings
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          </div>

          <div className="col-lg-6">
            <Card>
              <CardBody>
                <h3 className="card-title">Account</h3>
                <p className="text-secondary">
                  Manage your personal profile and security preferences. Two-factor
                  authentication can be enabled from your account security page.
                </p>
                <a href="/mfa-challenge" className="btn btn-outline-secondary">
                  Configure two-factor authentication
                </a>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}