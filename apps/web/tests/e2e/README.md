# Web E2E tests (Playwright)

Browser-driven coverage for P1-08's four required areas: the login/logout
flow, navigation between pages, authentication protection on app routes, and
responsive layout.

These tests drive the real Next.js frontend and the real NestJS API through a
browser. They do not mock the API and they do not inject tokens.

## Coverage on this revision

- `login-flow.spec.ts` — empty submit is rejected by the API (400), invalid
  credentials (401), and a valid sign-in that stores the token pair, selects an
  organization, signs out, clears every session key, and confirms a protected
  route redirects afterwards.
- `auth-protection.spec.ts` — all 12 static app routes redirect to `/login`
  without a session; `/`, `/login`, `/register`, `/forgot-password` and
  `/mfa-challenge` stay public. This file runs without the API.
- `navigation.spec.ts` — all 12 sidebar destinations, the brand link, and the
  dashboard cards.
- `responsive-layout.spec.ts` — desktop sidebar, mobile collapse/toggler, and
  the mobile login form.

The three dynamic detail routes (`/members/[id]`, `/membership-plans/[id]`,
`/memberships/[id]`) wrap `AuthGuard` but need fixture ids, so they are outside
this first suite.

## Prerequisites

1. **Isolated test environment.** The backend must point at a throwaway
   database, never at the shared development database (`gym_management`). The
   repository's `.env` targets `gym_management` on `127.0.0.1:5433`; do not use
   it. Set `E2E_API_ISOLATED=1` only after an operator has confirmed isolation.
2. **Backend API** on `http://localhost:3000`, migrated, with a seeded test
   user in the `Development Gym` organization. `npm run bootstrap:dev` links the
   hard-coded development account `test2@example.com`, so register that email
   through `POST /v1/auth/register` before running it.
3. **Frontend dev server** on `http://localhost:3001` (`npm run dev`).
4. **MFA disabled** on the test account. An MFA-enabled account is redirected
   to `/mfa-challenge` and the authenticated helpers time out.
5. **CDN access** to `cdn.jsdelivr.net`. The app loads Tabler CSS and the
   Bootstrap bundle (dropdowns and collapse) from there in `src/app/layout.tsx`;
   without it the sign-out menu and mobile sidebar toggler do not open.
6. **Chromium** installed: `npx playwright install --with-deps chromium`.
7. **A scratch Redis index.** Point the API's `REDIS_DATABASE` at an index you
   can clear after the run; do not leave throttle or blacklist keys in the
   shared development index.

Playwright does not start either server; start both yourself.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `E2E_TEST_EMAIL` | For authenticated tests | Test account email. No default. |
| `E2E_TEST_PASSWORD` | For authenticated tests | Test account password. No default. |
| `E2E_API_ISOLATED` | For any API-backed test | Set to `1` only after confirming the backend uses a throwaway database. |

There are no default credentials. A missing credential fails the test that
needs it rather than falling back to a shared account.

## Isolated local run

The sketch below deliberately leaves the scratch database name and the
credentials to the operator. Replace every `<...>` placeholder; never point the
API at `gym_management`.

```bash
# 1. Create a uniquely named scratch database on the Docker Postgres instance.
#    Apply migrations with all five DB_* variables pointed at it. The TypeORM
#    CLI does not load .env, so use scripts/dev-db-env.sh --env-file with a
#    scratch env file, or export DB_* explicitly.

# 2. Start the API from the checkout under test.
DB_DATABASE=<scratch> REDIS_DATABASE=<scratch-index> PORT=3000 \
  node_modules/.bin/ts-node --transpile-only src/main.ts

# 3. Register the development account, then link it to Development Gym.
curl -sS -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test2@example.com","password":"<password>","first_name":"E2E","last_name":"User"}'
DB_DATABASE=<scratch> npm run bootstrap:dev

# 4. Start the frontend.
cd apps/web
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev

# 5. Run the suite (in another shell).
cd apps/web
E2E_API_ISOLATED=1 E2E_TEST_EMAIL=test2@example.com \
  E2E_TEST_PASSWORD=<password> npx playwright test
```

A full run performs five credential logins for the test account (plus one
empty-email submit). The default `login-pair` throttle is 10 per 15 minutes per
IP+email, so clear the scratch Redis index between back-to-back runs instead of
waiting for the window.

## Install browsers

```bash
cd apps/web
npx playwright install --with-deps chromium
```

## Run

```bash
cd apps/web
E2E_API_ISOLATED=1 E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npx playwright test
```

Run one file:

```bash
npx playwright test tests/e2e/login-flow.spec.ts
```

## Discovery only

```bash
cd apps/web
npx playwright test --list
```

`--list` proves the config loads and the specs are discovered. It does not open
a browser, log in, navigate, enforce a redirect, or check responsiveness.
Playwright 1.63 rejects `--dry-run` as an unknown option.

## Skip semantics

- Without `E2E_API_ISOLATED=1`, API-backed tests are reported as **skipped**,
  not passed.
- `auth-protection.spec.ts`'s redirect checks, the public-route checks and the
  mobile login-form render check need only the frontend, so they run without
  the flag.
- Skips are listed separately in the `list` reporter output.

## Data safety

- Never run the suite against `gym_management`.
- Never run destructive seeds or delete shared records.
- Successful login creates a session and sign-out revokes that session; both
  are writes. That is why an isolated database is mandatory.
- Do not add fixtures that create or mutate tenant data in this suite.

## Repository integration

- The repository-root Jest config ignores `apps/web/tests/e2e/`, so the
  backend suite does not collect these Playwright `*.spec.ts` files.
- The suite is not part of `npm test` (root Jest) and is not wired into CI.
  It is manual-only by owner decision on 2026-10-25.
- Failure artifacts go to `apps/web/.next/e2e-results/`, which is gitignored.
- `apps/web`'s own Jest config matches `*.test.ts(x)`, so it does not collect
  these specs.
- Convenience scripts: `npm run test:e2e` and `npm run test:e2e:list` from
  `apps/web`.

## Known limitations

- The auth guard is client-side UX protection only; the API remains the source
  of truth for authorization.
- The dropdown and mobile collapse behavior depend on the Tabler bundle loaded
  from the CDN.
- No isolated backend/database is provisioned by this repository, so browser
  execution requires an operator to supply one.
- CI does not run this suite.
