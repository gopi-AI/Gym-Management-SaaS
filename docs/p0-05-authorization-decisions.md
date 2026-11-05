# P0-05 Authorization Policy Decisions

**Date:** 2026-11-04
**Scope:** P0-05 (Identity Module and Authentication) — organization-scoped authorization.
**Baseline:** branch `feat/p0-05-authz-foundation` @ `afc6bf7b0eddef5c6543126ba9ba38d212d1fe85`, with the P0-05 authorization work present in the working tree. File:line references are against that tree.
**Status:** Recorded. These decisions ratify behaviour that is already implemented. Recording them made **no application-code change**.

These four decisions were selected by the owner for P0-05 and recorded on 2026-11-04. No pre-existing approval identifier is cited, because the repository contains none for P0-05; the date and the decision text below are the record. P0-05-D1, P0-05-D2, P0-05-A-1 and P0-05-C-1 are recorded below.

---

## P0-05-D1 — Tenant membership is validated before permission evaluation (Option A)

**Owner decision, recorded 2026-11-04.**

**Decision.** After authentication, tenant-context membership validation runs before the RBAC/permission decision on tenant-scoped `@RequirePermissions()` routes. For a caller who is not a member of the requested organization, the response remains exactly:

```
403 Access to this organization is not allowed
```

It is not replaced by a permission-shaped refusal such as `403 Missing permission branch:read`. The existing `api-gate` `ten-02` contract is preserved: a non-member `GET /v1/branches` with `X-Organization-Id` naming another organization answers 403 with that exact fragment (`scripts/api-gate.js:974-993`).

**Intended guard ordering and observable request path.**

1. `JwtAuthGuard` — global `APP_GUARD`, registered first (`src/shared/auth/auth.module.ts:23`). Verifies the bearer token and populates `req.user`; `@Public()` routes opt out.
2. `PermissionsGuard` — global `APP_GUARD`, registered second (`src/shared/auth/auth.module.ts:24`). Routes with no `@RequirePermissions()` metadata pass through (authentication-only; see A-1). For a tenant-scoped route it resolves the organization (`:orgId` first, `X-Organization-Id` fallback, mismatch rejected), then performs **(a) membership validation via `IdentityService.isUserInOrganization` before (b) the permission check via `IdentityService.hasOrganizationPermission`** (`src/shared/auth/permissions.guard.ts:78-130`).
3. `TenantContextInterceptor` — `APP_INTERCEPTOR` (`src/tenancy/tenancy.module.ts:31-34`). Runs after the guard chain, as NestJS orders guards before interceptors. It records the authenticated user and the *requested* organization only; it does not authorize (`src/shared/tenant/tenant-context.interceptor.ts:30-71`).
4. Handlers/services that need the authorized organization continue to call `TenantContextService.requireOrganizationAccess`, which applies the same predicate and the same refusal constant (`src/shared/tenant/tenant-context.service.ts:123-133`).

**Implementation mechanism note.** Because global guards execute before global interceptors, the membership validation that decides the HTTP response cannot literally be performed by `TenantContextInterceptor` before `PermissionsGuard`. It is implemented as a pre-RBAC membership gate **inside** `PermissionsGuard` (`src/shared/auth/permissions.guard.ts:102-117`), using the same authoritative predicate (`IdentityService.isUserInOrganization`) and the same exported refusal constant (`ORGANIZATION_ACCESS_DENIED_MESSAGE`, `src/shared/tenant/tenant-context.service.ts:16-17`) as the tenant-context service. The observable ordering required by the decision — membership refusal before permission refusal — therefore holds.

**Organization-context compatibility (M3).** Missing route organization context and missing `X-Organization-Id` result in `403 Organization context required`. Route `:orgId` takes precedence over the `X-Organization-Id` header; conflicting route/header organization IDs are denied. External clients previously relying on global permission grants without organization context may be affected. This is intended P0-05 behavior and a compatibility consideration.
**Security rationale.** A non-member has no standing in the requested organization and must not receive a permission-shaped refusal, which would imply the membership was accepted and only a permission was missing. Membership is the tenant boundary; RBAC is subordinate to it. Membership is **not** a substitute for a permission: a member who lacks the required permission still receives `403 Missing permission <resource>:<action>`.

**Expected denial behaviour.**

| Caller | Result |
|---|---|
| Unauthenticated | 401 from `JwtAuthGuard` (unless `@Public()`) |
| Authenticated non-member of the requested organization | 403 `Access to this organization is not allowed` |
| Authenticated member without the required permission | 403 `Missing permission <resource>:<action>` |
| Authenticated member holding every required permission | request proceeds to the handler |

**Verification evidence.**

- `src/shared/auth/permissions.guard.spec.ts`: `denies forged organization ID without membership and never reveals permissions`; `denies a member who lacks the permission with the permission error`.
- `src/shared/auth/permissions.guard.integration.spec.ts` (real Postgres, gated by `RUN_DB_INTEGRATION=1`): `refuses a non-member with the tenant-access message`; `refuses an inactive membership with the tenant-access message`; `returns the permission-denial message for a member lacking the permission`.
- `src/shared/tenant/tenant-context.service.spec.ts`: `rejects organization access when user is not a member (403)`.
- `scripts/api-gate.js` `ten-02`: `GET /v1/branches` with a non-member organization header → 403 containing `Access to this organization is not allowed`. The gate definition is cited; the gate itself was not re-run for this record.
- This record's verification run: `npm run typecheck` exit 0; the nine focused suites 9/9, 140 tests passed (2026-11-04, verification worktree).

**Scope boundary.**

- Applies only to tenant-scoped routes carrying `@RequirePermissions()` and **not** `@SystemWidePermissions()`.
- Does not change `@Public()` routes, authentication-only routes, or system-wide routes (the latter use `IdentityService.hasPermission()` and require no organization membership).
- Does not make membership an authorization grant by itself; the permission check still runs and can deny a member.

---

## P0-05-D2 — Organization-scoped authorization requires an active organization

**Owner decision, recorded 2026-11-04.**

**Decision.** `IdentityService.hasOrganizationPermission()` must require **all four** of:

1. an **active organization** (`TENANCY_ORGANIZATIONS.is_active === true`);
2. an **active organization membership** (`IDENTITY_USER_ORGANIZATIONS.is_active === true` for the exact `(user_id, organization_id)`);
3. an **active organization role** (`IDENTITY_ROLES.is_active === true` on the membership's `role_id`);
4. an **active permission** (`IDENTITY_PERMISSIONS.is_active === true`) matching the required resource and action.

A user whose membership, role and permission all remain active must still be denied when the organization itself is deactivated. A deactivated organization must not authorize merely because the downstream rows were never switched off.

**Affected authorization method and request path.** `IdentityService.hasOrganizationPermission(userId, organizationId, resource, action)` (`src/identity/services/identity.service.ts:196-238`), reached from tenant-scoped routes through `PermissionsGuard` (`src/shared/auth/permissions.guard.ts:119-130`).

**Implementation evidence.**

- The membership lookup is organization-scoped and active-only: `findOne({ where: { user_id, organization_id, is_active: true }, relations: ['organization', 'role'] })` (`src/identity/services/identity.service.ts:203-210`).
- The organization activity gate: `if (membership.organization?.is_active !== true) return false;` (`src/identity/services/identity.service.ts:215`).
- Null role and inactive role: `src/identity/services/identity.service.ts:218-221`.
- Active permission only: the role-permission rows are filtered on `permission.is_active === true` (`src/identity/services/identity.service.ts:228-231`) and the final permission lookup repeats `is_active: true` (`src/identity/services/identity.service.ts:233-235`).
- No global fallback: the method never consults `IDENTITY_USER_ROLES` or `IdentityService.hasPermission()`. It reads only the membership's organization, the membership's role, and that role's permissions.

**Expected denial behaviour.** `hasOrganizationPermission()` returns `false`. On a tenant-scoped route the guard converts this to `403 Missing permission <resource>:<action>` for a member. A non-member is refused earlier by P0-05-D1 with the tenant-access message, so a deactivated organization does not change the non-member contract.

**Verification evidence.**

- `src/identity/services/identity.service.spec.ts` (hermetic): `denies when the organization is deactivated even though the membership and its role are active`; `denies when the membership is inactive`; `denies when the organization role is inactive`; `denies when the organization role permission is inactive`; `denies when the organization role lacks the permission even though a global role has it`; `allows when the organization role has the permission even though the global role lacks it`.
- `src/identity/services/identity-authorization.integration.spec.ts` (real Postgres, gated by `RUN_DB_INTEGRATION=1`): `denies when the organization is deactivated`; `does not let an active membership, role and permission override a deactivated organization`; `denies when the membership is inactive`; `denies when the organization role is inactive`; `denies when the organization role permission is inactive`; `denies when a global role grants the permission but the organization role does not`.
- This record's verification run: the corrected unit spec passes 17/17 (2026-11-04, verification worktree).

**Scope boundary.**

- Applies to organization-scoped authorization only. It does **not** extend to the global/system-wide `IdentityService.hasPermission()`, which has no organization parameter and continues to authorize from global user roles and global permissions.
- System-wide routes (the organization catalog) are not affected by this decision.
- An organization-scoped grant does not fall back to a global role or global permission, and a global grant does not substitute for an organization-scoped permission.

---

## P0-05-A-1 — Authentication-only routes require no permission metadata

**Owner decision, recorded 2026-11-04.**

**Decision.** Routes protected by JWT authentication but without explicit `@RequirePermissions()` metadata remain authentication-only. No `@RequirePermissions` decorator is added to these routes, and no `@AuthOnly` (or equivalent explicit authentication-only classification) decorator is introduced. Authentication alone (`JwtAuthGuard`) is sufficient authorization for these routes.

The 13 affected routes are:

**Five self-service auth routes (`v1/auth`), each operating only on the calling user's own account via `@CurrentUser()` identity from the verified JWT:**
- `POST /v1/auth/mfa-enable` — `AuthController.enableMfa` (`src/identity/controllers/auth.controller.ts:81`)
- `POST /v1/auth/mfa-verify` — `AuthController.verifyMfaSetup` (`src/identity/controllers/auth.controller.ts:107`)
- `POST /v1/auth/mfa-disable` — `AuthController.disableMfa` (`src/identity/controllers/auth.controller.ts:126`)
- `POST /v1/auth/mfa-check` — `AuthController.checkMfaStatus` (`src/identity/controllers/auth.controller.ts:140`)
- `POST /v1/auth/logout` — `AuthController.logout` (`src/identity/controllers/auth.controller.ts:148`)

**Eight member routes, each tenant-membership-scoped in the service/tenant layer (`TenantContextService.requireOrganizationAccess` / `IdentityService.isUserInOrganization`) but carrying no permission-level authorization:**
- `GET /v1/members` — `MembersController.findAll` (`src/members/controllers/members.controller.ts:11`)
- `GET /v1/members/:id` — `MembersController.findOne` (`src/members/controllers/members.controller.ts:17`)
- `POST /v1/members` — `MembersController.create` (`src/members/controllers/members.controller.ts:23`)
- `PATCH /v1/members/:id` — `MembersController.update` (`src/members/controllers/members.controller.ts:29`)
- `GET /v1/members/:memberId/identifiers` — `MemberIdentifiersController.findAll` (`src/members/controllers/member-identifiers.controller.ts:9`)
- `POST /v1/members/:memberId/identifiers` — `MemberIdentifiersController.create` (`src/members/controllers/member-identifiers.controller.ts:15`)
- `DELETE /v1/members/:memberId/identifiers/:identifierId` — `MemberIdentifiersController.remove` (`src/members/controllers/member-identifiers.controller.ts:24`)
- `GET /v1/members/:memberId/360/header` — `Member360Controller.getHeader` (`src/members/controllers/member-360.controller.ts:37`)

**Rationale.** `PermissionsGuard` returns `true` for any handler with no `@RequirePermissions()` metadata once `JwtAuthGuard` has authenticated (`src/shared/auth/permissions.guard.ts:31`), so authentication alone is the existing, documented contract (`CLAUDE.md:128`). The self-service routes are inherently bounded to the caller's own identity (the handler reads `userId` from the JWT, never from a client-supplied ID). The member routes enforce organization membership at the service layer rather than via a user-global permission. Introducing an `@AuthOnly` marker would invent a new architectural pattern, which the repository rules prohibit ("REPOSITORY IS LAW"; prefer the smallest structural change). On `main`, `IdentityService.hasPermission()` is user-global, so a permission check could not express org-scoping anyway.

**Scope boundary.** This decision covers only the 13 routes listed. It does not change the tenant-scoped `@RequirePermissions()` routes governed by P0-05-D1/D2, nor the system-wide organization catalog governed by P0-05-C-1.

**Verification evidence.**
- `src/shared/auth/permissions.guard.ts:31` — the guard passes handlers with no `@RequirePermissions()` metadata after authentication.
- `CLAUDE.md:128` — documents that a handler with no decorator passes for any authenticated user.
- Each route's controller (file:line references above) confirms no `@RequirePermissions` decorator is present.

**Residual risk (M2).** The eight member routes listed above remain without `@RequirePermissions` metadata under the approved P0-05-A-1 decision. They rely on authentication and existing organization membership/tenant enforcement. This is an explicitly accepted residual risk, not an accidental omission or a newly completed authorization feature. Role-based authorization for these routes remains deferred.
---
## P0-05-C-1 — Organization catalog routes remain system-wide

**Owner decision, recorded 2026-11-04.**

**Decision.** The four organization catalog routes remain system-wide and are protected by the global `organization:read`, `organization:create`, and `organization:update` permissions via `@RequirePermissions()`. They are not moved to tenant-scoped (organization-admin) authorization, and organization administrators cannot manage their own organization through organization-scoped permissions for these routes.

The four affected routes (`src/tenancy/controllers/organizations.controller.ts`):
- `GET /v1/organizations` — `findAll`, `@RequirePermissions({ resource: 'organization', action: 'read' })` (line 27)
- `GET /v1/organizations/:id` — `findOne`, `@RequirePermissions({ resource: 'organization', action: 'read' })` (line 34)
- `POST /v1/organizations` — `create`, `@RequirePermissions({ resource: 'organization', action: 'create' })` (line 43)
- `PATCH /v1/organizations/:id` — `update`, `@RequirePermissions({ resource: 'organization', action: 'update' })` (line 50)

**Rationale.** `POST /v1/organizations` creates a brand-new organization, so no pre-existing organization exists to scope the caller to; it is inherently platform-level. `GET /v1/organizations` lists the global catalog and would require a redesigned list route to scope callers to their own organizations. `GET/PATCH /v1/organizations/:id` address an organization by `:id` with no `:orgId` in the path and no ownership check that `row.organization_id === authorizedOrgId`; moving them to tenant scope would require that check plus a mechanism to derive the caller's authorized organization. No org-scoped permission routing exists in the guard on `main`; `bootstrap-dev.ts` seeds `organization:*` as system-wide permissions granted to the `owner` role, consistent with catalog management being a platform/system-admin function. The controller docblock already documents these as system-level administration that is not tenant-scoped (`src/tenancy/controllers/organizations.controller.ts:8-19`).

Organization administrators continue to manage their own organization through existing org-scoped routes (e.g., `v1/organizations/:orgId/branches` and branch settings), not the global catalog.

**Scope boundary.** This decision covers only the four `v1/organizations` catalog routes. It does not affect tenant-scoped routes governed by P0-05-D1/D2 or the authentication-only routes governed by P0-05-A-1.

**Verification evidence.**
- `src/tenancy/controllers/organizations.controller.ts:27,34,43,50` — `@RequirePermissions` decorators on the four catalog routes.
- `src/tenancy/controllers/organizations.controller.spec.ts` — asserts each catalog route's `organization:read`/`organization:create`/`organization:update` metadata.
- `src/scripts/bootstrap-dev.ts:54-59` — seeds `organization:read/create/update` as system-wide permissions.

---

## Related open questions (not decided here)

None. P0-05-A-1 (authentication-only routes) and P0-05-C-1 (organization catalog authorization) are decided above and recorded as owner decisions. All P0-05 authorization questions in this document are resolved.
