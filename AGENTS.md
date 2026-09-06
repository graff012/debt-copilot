# AGENTS.md — Debt Copilot Harness Constitution

This file is automatically loaded into every OpenCode session. This is your project bible.

## Project Overview
Debt Copilot is a multi-tenant debt collection SaaS for wholesale/distribution businesses in Uzbekistan.
V1 answers one question: "Who owes us money, how much, what should we do today, and what did they promise?"
Web SaaS = control center, Telegram bot = operational assistant, PostgreSQL = source of truth, AI = assistant around data, never accounting engine.

What it IS:
- Multi-tenant SaaS + Excel import + Customers + Receivables + Aging + Promises + Activity history + Telegram notifications
- 3 AI features only: Excel column mapping, reminder drafting, promise extraction

What it is NOT (V1):
- No Android/iOS apps, No Telegram Mini App, No accounting/journal entries, No inventory, No bank sync, No FX auto-conversion, No payment gateways, No 1C/SAP integration, No ML credit scores, No multi-agent runtime

## Architecture Principles — NEVER VIOLATE
1. **Tenant isolation is sacred.** Every table has organization_id. Every query MUST filter by organization_id. A leak where Company A sees Company B's debtors is catastrophic.
2. **Money = bigint, never float.** Store amount in minor units (tiyin/cents) as bigint or Prisma Decimal. Never use JavaScript number for money math. Never combine currencies.
3. **AI proposes, deterministic code commits.** LLM may suggest mappings, drafts, promises — human confirms. LLM never directly writes to financial tables.
4. **Every financial mutation = audit event.** Never silently overwrite remaining_amount. Create Interaction / AuditLog record with source, user, timestamp.
5. **Idempotent imports.** External_id or org+customer+invoice_number unique constraint. Same Excel twice = update, not duplicate.
6. **Timezones matter.** Use organization timezone for all due date calculations. Never use server local time.
7. **Postgres is source of truth.** No business logic only in frontend.

## Stack Reference
- Frontend: Next.js 15 (App Router) + TypeScript + Tailwind
- Backend: NestJS + TypeScript
- Database: PostgreSQL 16 + Prisma or Drizzle ORM
- Queue: BullMQ + Redis
- Telegram: grammY
- Object Storage: S3-compatible
- Auth: Email/password + Telegram linking (t.me/YourBot?start=link_XYZ)
- Deployment: Docker + Caddy/nginx, Sentry

## Repo Structure
```
debt-copilot/
apps/
  web/       # Next.js SaaS dashboard
  api/       # NestJS API
  worker/    # BullMQ jobs
packages/
  db/        # Prisma/Drizzle schema + migrations
  domain/    # Pure business logic, no I/O
  ai/        # Provider abstraction + prompts + tools
  telegram/  # grammY bot handlers
  shared/    # Types, utils
  config/
docs/
  product.md
  architecture.md
  domain-rules.md
  database.md
  api-contracts.md
  security.md
  ai-rules.md
docker/
AGENTS.md
opencode.jsonc
.env.example
```

## Key Design Decisions + Why
- **Snapshot model, not accounting:** We accept remaining_amount as truth from ERP/Excel. Why: avoids months building GL reconciliation.
- **Manual Telegram messaging V1:** Bot cannot start conversation with debtor per Telegram policy. Why: we use copy-paste from bot draft, later Business API.
- **Currency: no auto-conversion:** Store currency with every amount. Why: UZS/USD mixing destroys trust. Reporting FX later with explicit rate/source/date.
- **Priority = rules > AI:** priority_score = overdue_days*1 + broken_promises*20 + no_contact_days + amount_weight. Why: deterministic, explainable.

## What NOT to Do — Explicit Bans
- Do NOT build: native mobile apps, Telegram Mini App, accounting entries, inventory, purchasing, sales orders, bank sync, auto FX, payment gateways, OCR, voice AI, 1C/SAP sync, complicated BI, ML credit scoring, marketplace, legal enforcement
- Do NOT use floating point for money
- Do NOT add currencies together
- Do NOT let LLM decide financial truth
- Do NOT auto-merge customers by name ("Mega Shop LLC" != "Mega shop") without human confirm via TIN/phone/external_id
- Do NOT create files outside monorepo structure
- Do NOT skip tests for domain logic

## External File Loading — Lazy Load
CRITICAL: Use Read tool on demand. Do NOT preload all docs.

- For domain rules: @docs/domain-rules.md or @.opencode/skills/domain-rules/SKILL.md
- For DB schema: @.opencode/skills/db-schema/SKILL.md
- For API contracts: @.opencode/skills/api-contracts/SKILL.md
- For security: @.opencode/skills/security/SKILL.md
- For AI rules: @.opencode/skills/ai-rules/SKILL.md
- For money handling: @.opencode/skills/money-handling/SKILL.md

## Development Guidelines

### Package Manager — pnpm only
Use only pnpm. Never npm, npx, or yarn. Install with `pnpm install`, run tasks with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify` (or `pnpm run <script>`). Use `pnpm exec` / `pnpm dlx` instead of `npx`.

### Verification Harness — MANDATORY
Every task is NOT complete until:
```
pnpm lint
pnpm typecheck
pnpm test
pnpm verify
```
All must pass. `pnpm verify` runs lint + typecheck + tests + e2e.

### How to Work With This Harness
1. **Planner first for large tasks:** Use @planner agent to break down implementation
2. **Implement with domain skill:** "Using the domain-rules skill, implement calculateAging()"
3. **Reviewer never trusts builder:** @reviewer must check for multi-tenancy leaks, money bugs, timezone bugs, missing tests
4. **Test writer adds adversarial tests:** @test-writer creates missing edge cases without editing production code

### Task Format (Use This)
Bad: "Build dashboard"
Good: "Implement receivables aging service. Requirements: buckets 1-7, 8-30, 31-60, 61-90, 90+. Group by currency separately. Use org timezone. Never combine currencies. Add unit tests for due today, 1 day overdue, leap day, UZS, USD, zero remaining. Do not modify UI."

## Business Domain Glossary
- **Receivable:** Invoice snapshot with original_amount, remaining_amount, currency, due_date
- **PromiseToPay:** Customer commitment to pay X amount by Y date
- **Broken Promise:** promise.status=OPEN AND promisedDate < now AND not fulfilled
- **Interaction:** Call, note, reminder, promise — history timeline
- **Priority:** Deterministic score ranking who to call today

## Privacy — Uzbekistan
Contains PII (names, phones, Telegram IDs). Assume production DB must be hosted in Uzbekistan per Article 27-1. Never send raw PII to foreign LLM APIs — redact to CUSTOMER_123 before LLM call, then rehydrate after.

## Git Conventions
- Migrations must be reversible where practical
- Never commit .env, commit .env.example
- Branch: feat/xxx, fix/xxx
