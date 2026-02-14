# Stage 7 - JWT Auth + Nelayan Registration

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the backend supports account registration and login for nelayan users with JWT-based authentication. A user can register using `nama`, `noIdentitasNelayan`, `email`, and `password`, login to receive a token, and then access protected API routes (`/api/report`, `/api/ack`, `/api/sse`, `/api/ws`, push subscription routes). This replaces the earlier Basic Auth middleware with JWT.

## Progress

- [x] (2026-02-14 02:32Z) Reviewed `.agent/PLANS.md` requirements and current backend route structure.
- [x] (2026-02-14 02:32Z) Consulted Context7 for official Hono JWT usage (`sign`, `verify`, route protection) and Bun password hashing (`Bun.password.hash/verify`).
- [x] (2026-02-14 02:32Z) Added JWT auth configuration and Redis auth key prefixes in `src/config.ts`.
- [x] (2026-02-14 02:32Z) Implemented Redis-backed user registration/login service in `src/lib/auth.ts` with unique email + unique identity enforcement.
- [x] (2026-02-14 02:32Z) Added auth routes in `src/routes/auth.ts` for register/login/logout/me.
- [x] (2026-02-14 02:32Z) Replaced Basic Auth middleware with JWT middleware in `src/middleware/jwtAuth.ts` and `src/index.ts`.
- [x] (2026-02-14 02:32Z) Updated health + docs + README + browser harness files for JWT flow.
- [ ] Run full runtime verification with live Redis + ML and confirm end-to-end protected flow from web harness.

## Surprises & Discoveries

- Observation: SSE/EventSource cannot attach custom Authorization headers directly in this harness path.
  Evidence: Existing receiver implementation only accepted a URL for EventSource and no header injection point.
- Observation: Using JWT in either bearer header, cookie, or query token gives practical compatibility for API, browser harness, SSE, and WS clients without route duplication.
  Evidence: `src/middleware/jwtAuth.ts` now checks all three token locations.

## Decision Log

- Decision: Store users in Redis keys (user record key + email index key + identity index key) instead of adding SQL/SQLite in this stage.
  Rationale: Keeps the auth feature minimal and aligned with existing Redis-first architecture; avoids introducing migration and ORM complexity before current thesis protocol work completes.
  Date/Author: 2026-02-14 / Codex

- Decision: Keep JWT auth optional by default (`JWT_AUTH_ENABLED=false`).
  Rationale: Preserves current experimental workflows and allows staged rollout without breaking existing scripts immediately.
  Date/Author: 2026-02-14 / Codex

- Decision: Accept JWT from bearer header, cookie, and query `token`.
  Rationale: Header works for API clients, cookie supports browser login sessions, and query token supports EventSource/WebSocket client constraints.
  Date/Author: 2026-02-14 / Codex

## Outcomes & Retrospective

Core Stage 7 auth scaffolding is implemented: registration, login, JWT issuance and verification, and API protection with configurable public routes. The web harness also includes register/login/logout controls and token persistence for protected operations. Remaining validation is a full live run with Redis/ML to confirm all protocol endpoints behave correctly under auth-enabled mode.

## Context and Orientation

This repository is a Bun + Hono backend that distributes canonical `alertEvent` objects using Redis Pub/Sub and stores evidence in Redis Streams. Before this plan, auth was implemented as optional HTTP Basic Auth middleware. The main server entry is `src/index.ts`, route modules are in `src/routes/`, and shared config is in `src/config.ts`.

A "JWT" (JSON Web Token) is a signed token string carrying user claims (for example `sub` and `email`) and expiry (`exp`). In this repository, JWTs are signed with `HS256` using a shared secret (`JWT_SECRET`). A "middleware" is request-processing code run before route handlers.

## Plan of Work

Update `src/config.ts` with JWT flags, secret, expiry, public route allowlist, and Redis auth key prefixes. Add validation to fail startup if JWT mode is enabled without a secret.

Add `src/lib/auth.ts` to own user registration and login primitives. User records are persisted in Redis with three key groups:

- `auth:user:<userId>` for full user JSON (including password hash).
- `auth:user:email:<email>` for unique email index.
- `auth:user:identity:<noIdentitasNelayan>` for unique identity index.

Implement password hashing with Bun built-in APIs and token issuance with Hono JWT helper.

Create `src/routes/auth.ts` for:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Replace old middleware wiring in `src/index.ts` to use `src/middleware/jwtAuth.ts`, and remove Basic Auth middleware file. Update health output and API docs to expose new auth behavior.

Update `public/index.html`, `public/app.js`, and `public/receiver.js` so browser harnesses can authenticate and keep calling protected endpoints.

## Concrete Steps

Run from repository root:

    bunx tsc --noEmit

Expected result: no TypeScript errors.

To test auth-enabled mode manually:

    JWT_AUTH_ENABLED=true JWT_SECRET=dev-secret bun run dev

Then:

    curl -X POST http://localhost:3000/api/auth/register \
      -H "content-type: application/json" \
      -d '{"nama":"Budi","noIdentitasNelayan":"NLYN-001","email":"budi@example.com","password":"strongpass123"}'

    curl -X POST http://localhost:3000/api/auth/login \
      -H "content-type: application/json" \
      -d '{"email":"budi@example.com","password":"strongpass123"}'

    curl -X POST http://localhost:3000/api/report \
      -H "authorization: Bearer <token>" \
      -H "content-type: application/json" \
      -d '{"lik_codes":["wn-1","wn-2","wn-3","wn-4"],"level_of_interaction_with_disaster":5,"age":35,"usage_duration":10,"min_frequency_of_usage":10,"fishing_experience":5}'

## Validation and Acceptance

Acceptance is met when:

- Register endpoint accepts valid fields (`nama`, `noIdentitasNelayan`, `email`, `password`) and rejects duplicates.
- Login returns a JWT token and protected routes reject missing/invalid tokens with `401`.
- Protected routes accept valid JWT and existing behavior for report/ack/delivery remains unchanged.
- `GET /api/health` shows auth enabled flag and public path list.
- `bunx tsc --noEmit` completes successfully.

## Idempotence and Recovery

Registration is idempotent for unique user identifiers by returning conflict responses on duplicates; it does not corrupt existing users. If a registration fails after key reservation, rollback logic removes reserved index keys. JWT auth is controlled by env toggles; recovery to prior behavior is setting `JWT_AUTH_ENABLED=false` and restarting.

## Artifacts and Notes

Key file additions:

- `src/lib/auth.ts`
- `src/routes/auth.ts`
- `src/middleware/jwtAuth.ts`
- `docs/execplan-stage-7-jwt-auth.md`

Key file replacements/updates:

- Removed `src/middleware/basicAuth.ts`
- Updated `src/index.ts`, `src/config.ts`, `src/routes/health.ts`, `src/routes/docs.ts`, `README.md`, `public/app.js`, `public/receiver.js`, `public/index.html`

## Interfaces and Dependencies

Auth logic uses:

- `hono/jwt` helper functions `sign(payload, secret, "HS256")` and `verify(token, secret, "HS256")`
- Bun password API `Bun.password.hash()` and `Bun.password.verify()`
- Existing Redis client from `src/lib/redis.ts`

Key route interfaces:

- `POST /api/auth/register` body: `{ nama, noIdentitasNelayan, email, password }`
- `POST /api/auth/login` body: `{ email, password }`, response includes `{ token, user }`
- `GET /api/auth/me` returns decoded JWT payload for authenticated users

Plan update note: Created during implementation to satisfy PLANS.md requirement for significant feature work and to capture JWT design decisions and rollout steps for future contributors.
