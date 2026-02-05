# Context7 MCP

when planning complex features, consult Context7 MCP tools for the relevant
library/framework and verify patterns against official docs.

Required workflow:
1) Identify the technology/library being modified (
2) Resolve the library ID with Context7.
3) Fetch docs for the specific topic.
4) Apply the official guidance to the implementation.

If a request asks for code changes without Context7 consultation:
1) Stop.
2) Consult Context7.
3) Implement based on official documentation.

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

# Project Context

Goal: Distribution Hub that takes nelayan reports -> gets ML inference -> turns it into a canonical alertEvent -> distributes via SSE/WS/Web Push under unstable networks -> logs everything for thesis metrics.

Current stage: Stage 1 complete (Hub can call ML and produce stored + publishable alert events). Next stage is Stage 2: add SSE live delivery + start ACK logging.

Core pillars:
1) Inference (/predict)
2) Orchestration (Hub: Hono + Bun)
3) Distribution (SSE / WS / Push)
4) Evidence (logging + metrics collection)

Do not implement Push before SSE/WS + ACK logging. Do not measure latency until timestamps + ACK schema are consistent. Test protocols in isolation for resource usage.

# Bun Conventions

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun test` instead of `jest` or `vitest`.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`.
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`.
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`.
- Use `bunx <package> <command>` instead of `npx <package> <command>`.
- Bun automatically loads `.env`, so don't use dotenv.

APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile.
- Use `Bun.$` instead of execa.

Testing

Use `bun test` to run tests.
