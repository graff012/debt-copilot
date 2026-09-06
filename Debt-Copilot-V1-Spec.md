# Debt Collection SaaS — V1 Complete Specification

> **Core Principle:** Web SaaS = control center, Telegram bot = operational assistant, PostgreSQL = source of truth, AI = assistant around the data, never the accounting engine.
>
> **V1 Question:** "Who owes us money, how much, what should we do today, and what did they promise?"

**Stack:** TypeScript end-to-end • Next.js • NestJS • PostgreSQL • Drizzle/Prisma • BullMQ + Redis • grammY • S3 • Docker
**No-Go for V1:** No Android/iPhone apps, No Telegram Mini App, No ERP features

---

## Table of Contents

1.  [Define V1 Very Tightly](#1-define-v1-very-tightly)
2.  [What V1 Should Actually Do](#2-what-v1-should-actually-do)
3.  [Web App + Telegram Bot](#3-web-app--telegram-bot)
4.  [One Telegram Limitation](#4-one-telegram-limitation-you-need-to-understand)
5.  [Do NOT Build Accounting](#5-do-not-build-accounting)
6.  [Be Very Careful With Currencies](#6-be-very-careful-with-currencies)
7.  [Core Database Design](#7-core-database-design)
8.  [Customer Status Shouldn't Be One Field](#8-customer-status-shouldnt-be-one-field)
9.  [Your Prioritization Engine](#9-your-prioritization-engine)
10. [Where AI Should Actually Be Used](#10-where-ai-should-actually-be-used)
11. [AI Feature #1 — Intelligent Excel Importer](#11-ai-feature-1--intelligent-excel-importer)
12. [AI Feature #2 — Debt Reminder Writer](#12-ai-feature-2--debt-reminder-writer)
13. [AI Feature #3 — Extract Promises from Conversation](#13-ai-feature-3--extract-promises-from-conversation)
14. [AI Feature #4 — Morning Collections Copilot](#14-ai-feature-4--morning-collections-copilot)
15. [But Do NOT Build a Multi-Agent System Yet](#15-but-do-not-build-a-multi-agent-system-yet)
16. [Technical Stack I'd Use](#16-technical-stack-id-use)
17. [Repo Structure](#17-repo-structure)
18. [Domain Package is Important](#18-domain-package-is-important)
19. [APIs](#19-apis)
20. [Multi-Tenancy](#20-multi-tenancy)
21. [Roles](#21-roles)
22. [Data Import Strategy](#22-data-import-strategy)
23. [Identity Matching is Dangerous](#23-identity-matching-is-dangerous)
24. [Import Should Be Idempotent](#24-import-should-be-idempotent)
25. [Synchronization Comes Later](#25-synchronization-comes-later)
26. [Telegram Account Linking](#26-telegram-account-linking)
27. [Daily Scheduled Jobs](#27-daily-scheduled-jobs)
28. [Audit Log](#28-audit-log)
29. [Privacy and Uzbekistan Hosting](#29-privacy-and-uzbekistan-hosting)
30. [Your OpenCode Go Idea](#30-your-opencode-go-idea)
31. [How I Want You to Develop This With AI](#31-how-i-want-you-to-develop-this-with-ai)
32. [Your AGENTS.md](#32-your-agentsmd)
33. [Don't Tell AI "Build Dashboard"](#33-dont-tell-ai-build-dashboard)
34. [Your First Useful Multi-Agent Workflow](#34-your-first-useful-multi-agent-workflow)
35. [The Reviewer Should Not Trust the Builder](#35-the-reviewer-should-not-trust-the-builder)
36. [Give Agents a Deterministic Harness](#36-give-agents-a-deterministic-harness)
37. [Your V1 Screens](#37-your-v1-screens)
38. [Things Specifically Banned From V1](#38-things-specifically-banned-from-v1)
39. [The Complete V1 Flow](#39-the-complete-v1-flow)
40. [How I Would Measure Whether It's Succeeding](#40-how-i-would-measure-whether-its-succeeding)
41. [And The Product Can Grow Naturally](#41-and-the-product-can-grow-naturally)

---

## 1. Define V1 Very Tightly

Your first customer should be something like: **Wholesale/distribution businesses that sell to shops/customers on credit.**

Examples:
- construction materials
- agro supplies
- food distribution
- auto parts
- electronics
- pharmacy distributors
- textile suppliers
- furniture materials

Their process is roughly:

```
Sell product
    ↓
Invoice/customer debt appears
    ↓
Due date passes
    ↓
Salesperson calls customer
    ↓
Customer says "I'll pay Friday"
    ↓
Nobody remembers Friday
    ↓
Debt becomes 30/60/90 days old
```

Your software fixes exactly this.

## 2. What V1 Should Actually Do

The customer logs into your web app.

They upload an Excel file:

`Customer | Phone | Invoice | Date | Due Date | Amount | Remaining | Currency`

Example:

| Customer | Invoice | Due | Original | Remaining |
| :--- | :--- | :--- | :--- | :--- |
| Akbar Market | INV-102 | Aug 20 | 8m | 3m |
| Mega Shop | INV-115 | Aug 22 | 15m | 15m |
| Baraka | INV-130 | Sep 10 | 6m | 6m |

The system immediately tells them:

```
Total receivables        284,500,000 UZS
Overdue                   81,300,000
Due this week             42,000,000
Due later                161,200,000

1–7 days overdue          21,000,000
8–30 days overdue         33,500,000
31–60 days overdue        18,000,000
60+ days overdue           8,800,000
```

And most importantly:

**TODAY**
- 🔴 Call Mega Shop — 15,000,000 UZS — 12 days overdue — Last contact: 6 days ago
- 🟠 Akbar Market — 3,000,000 UZS — Promised payment TODAY
- 🟡 Baraka — 6,000,000 UZS — Due in 3 days

That is your product. Everything else comes afterwards.

## 3. Web App + Telegram Bot

This combination is the correct architecture.

### Web App

Web should handle things that need a large screen:
- Dashboard
- Customers
- Receivables
- Promises
- Activity
- Import Excel
- Reports
- Team
- Settings

### Telegram

Telegram should handle things where someone needs to act quickly:

**09:00 Message:**
> Good morning.
> Total overdue: 81.3m UZS
> 🔴 5 promises due today
> 🟠 17 overdue customers
> 💰 24.5m expected today
> [Promises] [Overdue] [My Customers]

**Salesperson opens:**
> Mega Shop — 15m UZS — 12 days overdue
> Buttons: [📞 Called] [💰 Payment received] [🤝 Promise received] [📝 Add note]

**Select: 🤝 Promise received**

Bot: When did they promise to pay?
> [Today] [Tomorrow] [Friday] [Choose date]

Then: How much?
> [Full 15m] [Enter amount]

Result:
> ✅ Promise saved
> Mega Shop — 10,000,000 UZS — September 4 — Assigned: Aziz

This is incredibly useful without needing complicated AI.

## 4. One Telegram Limitation You Need to Understand

Your bot cannot simply find every debtor on Telegram and message them.

**Telegram explicitly says a bot cannot start a conversation with a user; the user must first message the bot or otherwise initiate the connection.**

Therefore make customer messaging manual/semi-automatic in V1.

Example Customer record:
- Mega Shop
- +998 90 123 45 67
- Debt: 15,000,000

System generates:

> Assalomu alaykum. Mega Trade ma'lumotlariga ko'ra, sizda INV-115 bo'yicha 15 000 000 so'm to'lov mavjud. To'lov muddati 22.08.2026 edi. Iltimos, to'lov holati haqida ma'lumot bera olasizmi?

Employee presses: Copy and sends it using their normal Telegram account.

Later you can use Telegram Business integrations, SMS, WhatsApp or get customers to opt into your bot.

Telegram now also supports very capable Mini Apps, but deliberately postpone that.

## 5. Do NOT Build Accounting

This is probably the most important technical decision.

Don't try to become Odoo Accounts Receivable.

V1 shouldn't calculate accounting balances from:
- journal entries
- payments
- invoices
- credit notes
- FX gains
- exchange differences
- write-offs
- reconciliation

You'll disappear into accounting complexity.

Instead your application accepts an **open receivables snapshot**.

Example:
```json
{
  "customer": "Mega Shop",
  "invoice": "INV-115",
  "original_amount": 15000000,
  "remaining_amount": 8000000,
  "currency": "UZS",
  "due_date": "2026-08-22"
}
```

You trust: `remaining_amount = source system's current truth`

Your system's job is: **collect the remaining 8m**, not reconstruct the company's general ledger.

This distinction saves months of development.

## 6. Be Very Careful With Currencies

For V1: **Never do this:** `Total debt = $8,300 converted magically into UZS`

Instead:
```
Receivables
UZS: 284,500,000
USD: $18,350
EUR: €2,300
```

Store every debt with its original currency:
- amount
- currency
- remaining_amount

No automatic FX conversion required.

Later, if management wants consolidated numbers, add:
- reporting_currency
- fx_rate
- fx_rate_date
- fx_rate_source

But don't introduce that complexity initially.

## 7. Core Database Design

I'd start roughly here.

```
Organization
    id
    name
    timezone
    base_currency

User
    id
    organization_id
    name
    role
    telegram_user_id

Customer
    id
    organization_id
    external_id
    name
    phone
    tax_id
    assigned_user_id

Receivable
    id
    organization_id
    customer_id
    external_id
    invoice_number
    invoice_date
    due_date
    currency
    original_amount
    remaining_amount
    status

Payment
    id
    organization_id
    customer_id
    receivable_id
    amount
    currency
    payment_date
    source

PromiseToPay
    id
    organization_id
    customer_id
    amount
    currency
    promised_date
    status
    created_by_user_id
    source

Interaction
    id
    organization_id
    customer_id
    user_id
    type
    note
    created_at

Reminder
    id
    organization_id
    customer_id
    receivable_id
    type
    scheduled_at
    sent_at
    status

ImportJob
    id
    organization_id
    filename
    status
    imported_rows
    rejected_rows
    created_at
```

A nice part of this architecture is that nearly everything becomes an event/history.

**Customer page example:**

MEGA SHOP — Outstanding: 15m
- Sep 2 🤝 Promised 10m for Sep 4 — Aziz
- Aug 30 📞 Called customer — "They are waiting for payment from their buyer."
- Aug 27 📩 Reminder generated
- Aug 22 ⚠ Invoice became overdue
- Aug 1 🧾 INV-115 created — 15m

That history becomes extremely valuable later.

## 8. Customer Status Shouldn't Be One Field

Don't just have: `status = OVERDUE`

Calculate operational states.

For example:
- **Healthy** — not overdue
- **Due soon** — due_date <= today + 3
- **Overdue** — due_date < today AND remaining > 0
- **Promise** — active promise exists
- **Broken promise** — promise_date < today AND promised amount wasn't paid

Broken promises are especially useful. That could become:

> 🔥 High priority
> Mega Shop — 15m overdue — 3 broken promises — 43 days outstanding

That's something Excel won't give the business easily.

## 9. Your Prioritization Engine

This should initially be normal code, not AI.

For example:
```
priority_score =
    overdue_days × 1
    + overdue_amount_weight
    + broken_promises × 20
    + no_contact_days
```

Then rank customers:
- Mega Shop 94
- ABC Market 81
- Green Store 72

Later you can develop a better risk model using actual historical data. But V1: **rules > AI**.

## 10. Where AI Should Actually Be Used

Architecture to remember:

```
              DETERMINISTIC
                   │
money ─────────────┤
balances ──────────┤
dates ─────────────┤
permissions ───────┤
status ────────────┤
reminders ─────────┤
                   │
                   ▼
                  APP
                   ▲
                   │
language ──────────┤
summaries ─────────┤
classification ────┤
Excel mapping ─────┤
message writing ───┤
conversation ──────┤
                   │
                  AI
```

Never let an LLM decide financial truth. Use AI where ambiguity exists.

## 11. AI Feature #1 — Intelligent Excel Importer

This is potentially one of your killer features.

Every business has completely different Excel files.
- One company: Контрагент | Сумма | Остаток | Срок
- Another: Mijoz | Faktura | Qarz | Sana
- Another: Partner Name | Debit | Paid | Balance

Instead of forcing everyone to transform their Excel manually, AI examines headers and suggests:

> I think:
> Контрагент → Customer
> Номер документа → Invoice
> Остаток → Remaining amount
> Срок оплаты → Due date
> Валюта → Currency
> [Confirm mapping]

Then deterministic code performs the actual import.

**That combination is very strong:**
AI determines meaning → human confirms → normal program imports

Do not let the LLM directly insert thousands of records.

## 12. AI Feature #2 — Debt Reminder Writer

Input:
```json
{
  "customer": "Mega Shop",
  "remaining": 15000000,
  "currency": "UZS",
  "overdue_days": 12,
  "previous_reminders": 2,
  "language": "uz"
}
```

AI can produce:

**Friendly:**
> Assalomu alaykum. INV-115 hisob-fakturasi bo'yicha 15 000 000 so'm to'lov hali ochiq turibdi. To'lov holatini aniqlashtirib bera olasizmi?

**Firmer:**
> Assalomu alaykum. INV-115 bo'yicha 15 000 000 so'm qarzdorlikning to'lov muddati o'tgan. Iltimos, rejalashtirilgan to'lov sanasini tasdiqlang.

Eventually: [Friendly] [Normal] [Firm] — Uzbek / Russian / English.

## 13. AI Feature #3 — Extract Promises from Conversation

Employee pastes:
> Ular juma kuni 8 mln tashlab beradi, qolganini keyingi hafta berarkan.

AI returns structured JSON:
```json
{
  "intent": "promise_to_pay",
  "amount": 8000000,
  "currency": "UZS",
  "date": "2026-09-04",
  "remaining_followup": true
}
```

Employee sees:
> Detected: Promise: 8,000,000 UZS — September 4 — [Confirm]

Only after Confirm does it enter the database. This is excellent AI UX.

## 14. AI Feature #4 — Morning Collections Copilot

Eventually an owner asks: What should we focus on today?

AI gets structured tool results:
- get_overdue_customers()
- get_promises_due_today()
- get_broken_promises()
- get_large_balances()

And answers:
> You should prioritize five customers today. Mega Shop has the largest overdue amount at 15m and has already broken two promises. ABC Market promised 8m today. Green Market has not been contacted for 12 days.

**Important:** AI doesn't query random database tables directly. Give it explicit tools.

```
get_customer
get_customer_receivables
get_customer_history
get_overdue_summary
create_draft_reminder
```

This is the start of a proper agent.

## 15. But Do NOT Build a Multi-Agent System Yet

You mentioned wanting to learn agents, multi agents, proper AI engineering. This project will eventually be perfect for learning that.

But don't start with:
Manager Agent, Collector Agent, Finance Agent, Risk Agent, Messaging Agent, Supervisor Agent — That's architecture cosplay at this stage.

Start:
```
Collection Assistant
        │
        ├── tool: search_customer
        ├── tool: get_debt
        ├── tool: get_history
        ├── tool: draft_message
        └── tool: create_promise
```

One agent. Strong tools. Strict permissions. Structured output. Then you'll actually understand agent engineering.

## 16. Technical Stack I'd Use

Given this project, I would use TypeScript end-to-end.

- Frontend: Next.js
- Backend: NestJS
- Database: PostgreSQL
- ORM: Drizzle OR Prisma
- Queue: BullMQ + Redis
- Telegram: grammY
- Object storage: S3-compatible storage
- AI: provider abstraction
- Auth: email/password initially + Telegram linking
- Deployment: Docker
- Reverse proxy: Caddy / nginx
- Monitoring: Sentry, structured logs

You don't need microservices.

```
                   ┌───────────────┐
                   │   Next.js     │
                   │    SaaS       │
                   └───────┬───────┘
                           │
                           ▼
                    ┌─────────────┐
Telegram webhook ──►│   NestJS    │
                    │     API     │
                    └──────┬──────┘
                           │
             ┌─────────────┼──────────────┐
             │             │              │
             ▼             ▼              ▼
        PostgreSQL       Redis        Object Storage
                             │
                             ▼
                         Worker
                      ┌──────┴──────┐
                      │             │
                      ▼             ▼
                  Telegram          AI
```

## 17. Repo Structure

I'd make a monorepo.

```
debt-copilot/
apps/
    web/
    api/
    worker/
packages/
    db/
    domain/
    ai/
    telegram/
    shared/
    config/
docs/
    product.md
    architecture.md
    domain-rules.md
    database.md
    api.md
    security.md
    ai-rules.md
docker/
```

This becomes extremely important when you're using coding agents.

## 18. Domain Package is Important

Don't put your business rules everywhere.

Example: `packages/domain/` contains:
- calculateAging()
- calculatePriority()
- isOverdue()
- isPromiseBroken()
- allocatePayment()
- getCustomerCollectionStatus()

Then UI, Telegram and AI all use the same logic.

```ts
export function isPromiseBroken(
  promise: PromiseToPay,
  now: Date,
): boolean {
  return (
    promise.status === "OPEN" &&
    promise.promisedDate < now
  );
}
```

Simple, testable, deterministic.

## 19. APIs

Your core API might become:

```
POST   /auth/login
GET    /dashboard
GET    /customers
POST   /customers
GET    /customers/:id
GET    /receivables
POST   /receivables
PATCH  /receivables/:id
POST   /payments
GET    /promises
POST   /promises
PATCH  /promises/:id
POST   /imports
GET    /imports/:id
POST   /ai/map-columns
POST   /ai/draft-reminder
POST   /ai/extract-promise
POST   /telegram/webhook
```

That's enough.

## 20. Multi-Tenancy

From day one, put `organization_id` on basically everything.

Never write: `SELECT * FROM customers;`

Your queries should conceptually always be: `WHERE organization_id = currentOrganization`

A catastrophic SaaS bug would be: Company A seeing Company B's debtors.

Put tenant isolation at the core.

## 21. Roles

V1:
- Owner/Admin — Can see everything.
- Manager — Can see whole debt portfolio.
- Collector/Salesperson — Can see assigned customers.

That's enough. Don't implement 48 permission toggles.

## 22. Data Import Strategy

First import flow:

```
Upload Excel
        ↓
Read workbook
        ↓
Detect sheets
        ↓
Preview columns
        ↓
AI suggests mapping
        ↓
User confirms
        ↓
Validate data
        ↓
Show errors
        ↓
Import
```

Example validation:
- 2,034 rows found
- ✅ 1,992 valid
- ⚠ 32 missing due date
- ❌ 10 invalid amounts

User should never get: `Import failed.` They should get the actual rows and reasons.

## 23. Identity Matching is Dangerous

Imagine:
- "Mega Shop LLC"
- "Mega shop"
- "ООО MEGA SHOP"
- "MegaShop"

Don't automatically merge these because AI thinks they're the same.

Prefer IDs like: external_customer_id, TIN, phone

AI may suggest: These might be the same customer. But human confirms.

Same principle again: AI suggests. Deterministic system commits.

## 24. Import Should Be Idempotent

If they upload the same Excel twice, don't create duplicate invoices.

Have something like: `external_id` or generate `organization + customer + invoice_number`

Then: existing invoice → update, new invoice → insert. This matters enormously.

## 25. Synchronization Comes Later

After Excel works:
- Integration #1: Odoo. This would actually be easy for you. Odoo account.move, account.move.line, res.partner, account.payment ↓ Debt SaaS
- Then maybe: 1C, SAP, other ERP, custom API

Eventually your positioning becomes: **We don't replace your ERP. We make sure its receivables actually get collected.** That's strong.

## 26. Telegram Account Linking

User logs into SaaS. Settings: Telegram Not connected. [Connect Telegram]

Generate: `t.me/YourBot?start=link_XYZ123`

User clicks. Bot: ✅ Telegram connected to Mega Distribution — Welcome, Aziz.

Now you store: telegram_user_id, user_id and can send operational notifications.

## 27. Daily Scheduled Jobs

Worker does:
- 00:05 — update calculated states
- 08:55 — prepare morning summaries
- 09:00 — send Telegram summaries
- throughout day — check promise reminders
- 18:00 — daily result summary

Example:

> TODAY'S COLLECTION RESULT
> Expected: 42m
> Received: 29m
> Promises kept: 7
> Promises broken: 3
> New promises: 11
> Top collector: Aziz — 13.2m collected

Companies will love this.

## 28. Audit Log

Since this concerns money, keep history.

Don't silently overwrite: remaining_amount 15m → 8m

Record:
```
Sep 2 14:31
Remaining balance changed
15,000,000 ↓ 8,000,000
Source: Excel Import #238
User: Aziz
```

This is extremely important.

## 29. Privacy and Uzbekistan Hosting

This needs to be part of your architecture, not an afterthought.

The official Uzbek personal-data registry describes Article 27¹ requirements concerning collection, systematization and storage of Uzbek citizens' personal data on technical infrastructure physically located in Uzbekistan.

Your application can contain: names, phone numbers, individual debtor data, Telegram IDs, communication history.

So before production, get proper legal guidance on whether the exact data you're processing triggers registration/localization requirements.

Architecturally, I'd assume local hosting may be necessary and choose an Uzbekistan-hosted production database/server unless counsel confirms another setup is acceptable.

And here's another AI implication: don't casually send `Akmal Karimov +998... owes 18,000,000 UZS` to random foreign LLM APIs. Redact where possible: `CUSTOMER_182 owes 18,000,000` Then substitute names afterwards.

## 30. Your OpenCode Go Idea

Your understanding is right: OpenCode Go currently costs $10/month and provides access to a changing selection of coding models that can be used through OpenCode or other agents.

I would absolutely use something like this for the development experiment.

But distinguish two things:
- **AI THAT BUILDS YOUR PRODUCT:** OpenCode / coding agents
- **AI INSIDE YOUR PRODUCT:** Runtime LLM API

Those are separate systems. Your coding subscription helps you create the application. Your SaaS eventually needs its own AI runtime architecture.

## 31. How I Want You to Develop This With AI

This project is actually an excellent opportunity to stop doing: "Here is my prompt, build this." and start using AI professionally.

First create these documents:
- /docs/product.md
- /docs/domain-rules.md
- /docs/architecture.md
- /docs/database.md
- /docs/security.md
- /docs/api-contracts.md
- /docs/ai-rules.md

**product.md** Explains: What problem? Who is customer? What is V1? What is explicitly NOT V1?

**domain-rules.md** For example:
- RULE-001 A receivable is overdue when: remaining_amount > 0 AND due_date < organization_today
- RULE-002 Different currencies must never be added together.
- RULE-003 An AI model may never alter a financial amount without explicit confirmation.
- RULE-004 A promise becomes broken only after promised_date has passed and payment hasn't fulfilled it.

This is incredibly valuable for agents.

## 32. Your AGENTS.md

Put an AGENTS.md at repo root.

Something like:

> This is a multi-tenant debt collection SaaS.
> Critical rules:
> 1. Never mix tenant data.
> 2. Never use floating point for money.
> 3. Never automatically convert currencies.
> 4. AI may propose financial actions but not commit them.
> 5. Every financial state mutation requires an audit event.
> 6. Database migrations must be reversible where practical.
> 7. Every domain rule requires unit tests.
> 8. Run lint, typecheck and tests before considering work complete.

This becomes your agent constitution.

## 33. Don't Tell AI "Build Dashboard"

Give AI tasks like a senior engineer would assign.

**Bad:** Build dashboard.

**Good:** Implement the receivables aging service. Requirements: 1–7 days, 8–30, 31–60, 61–90, 90+. Group separately by currency. Never combine currencies. Use organization timezone. Add unit tests for: due today, one day overdue, leap day, UZS, USD, zero remaining amount. Do not modify UI.

Now agents become dramatically better.

## 34. Your First Useful Multi-Agent Workflow

Once the project has tests and documentation, try this.

```
                     ┌───────────┐
                     │  Planner  │
                     └─────┬─────┘
                           │
                           ▼
                   Implementation
                           │
                           ▼
                     ┌──────────┐
                     │ Reviewer │
                     └────┬─────┘
                          │
                          ▼
                      Test Agent
                          │
                    ┌─────┴─────┐
                    │           │
                  PASS         FAIL
                    │           │
                    ▼           ▼
                  Merge       Fix loop
```

They don't need to be five different LLM companies. The value is that they have different context and responsibilities.

## 35. The Reviewer Should Not Trust the Builder

Example workflow:

**Agent A:** Implement PromiseToPay.

**Agent B:** Receives requirements and diff: Review this code aggressively. Look for multi-tenancy leaks, money bugs, timezone bugs and missing tests. Do not rewrite the implementation.

**Agent C:** Create missing adversarial tests without changing production code.

This is real agentic development. Much more valuable than five agents chatting with each other.

## 36. Give Agents a Deterministic Harness

Every agent must be able to run:
- npm run lint
- npm run typecheck
- npm test
- npm run test:e2e
And ideally: npm run verify runs everything.

Then your prompt ends: Task is not complete until `npm run verify` passes.

That's what people mean when they talk about an effective AI coding harness. The model isn't trusted. The environment verifies it.

## 37. Your V1 Screens

I would only build these.

1. **Login**
2. **Dashboard**
   - Receivables 284.5m UZS
   - Overdue 81.3m
   - Promises today 24.5m
   - Collected this month 103m
   - Aging chart.
   - Top debtors.
   - Today list.
3. **Customers**
   - Search customer...
   - Mega Shop 15m 🔴
   - Akbar Market 8m 🤝
   - Baraka 6m 🟢
4. **Customer detail**
   - Mega Shop — Outstanding: 15m — Overdue: 12 days
   - Invoices, Promises, Activity, Notes
5. **Promises**
   - Today: Mega Shop 10m, ABC Market 5m
   - Broken: Green Shop 8m
6. **Import**
   - Drag Excel. Map. Validate. Import.
7. **Team**
   - Users + assignments.
8. **Settings**
   - Organization + Telegram.

Stop there.

## 38. Things Specifically Banned From V1

This list protects you from yourself.

Don't build:
- native Android
- native iOS
- full Telegram Mini App
- accounting
- journal entries
- inventory
- purchasing
- sales orders
- bank synchronization
- automatic FX
- payment gateways
- OCR
- voice calling AI
- 1C integration
- SAP integration
- complicated BI
- machine-learning credit scores
- multi-agent runtime
- mobile push notifications
- customer marketplace
- legal debt enforcement

You'll want to. Don't.

## 39. The Complete V1 Flow

This is what I would launch.

```
OWNER
  │
  │ signs up
  ▼
Create company
  │
  ▼
Upload receivables.xlsx
  │
  ▼
AI maps columns
  │
  ▼
Human confirms
  │
  ▼
System validates
  │
  ▼
Import
  │
  ▼
Dashboard calculates overdue debts
  │
  ▼
Assign customers to employees
  │
  ▼
Employees connect Telegram
  │
  ▼
Every morning they receive collection list
  │
  ▼
Employee calls customer
  │
  ├── paid
  ├── no answer
  └── promise received
           │
           ▼
      Promise saved
           │
           ▼
      Reminder on due date
           │
      ┌────┴────┐
      │         │
     Paid    Broken promise
      │         │
      ▼         ▼
     Done    Escalate
```

That's already a real SaaS.

## 40. How I Would Measure Whether It's Succeeding

Don't obsess about: registered users, website visitors, AI requests

Measure:
- Total receivables managed
- Overdue amount
- Money collected through active follow-up
- Promise fulfillment rate
- Average overdue days
- Broken promises
- Collectors using product daily

The killer metric eventually becomes something like: **Businesses using our product recovered 12.4 billion UZS of overdue receivables this month.** That sells the product.

## 41. And The Product Can Grow Naturally

- **V1:** Excel → Debt monitoring → Telegram collections
- **V2:** automatic ERP synchronization
- **V3:** customer payment portal
- **V4:** AI collection agent
- **V5:** risk scoring
- **V6:** credit limits

Then something interesting happens. You know:
- Customer A usually pays 3 days late
- Customer B usually pays 48 days late
- Customer C has broken 7 promises
- Customer D always pays on time

Now before a company sells goods on credit, your system can say:

> ⚠ Recommended credit limit: 25,000,000 UZS
> Reason: Average payment delay: 34 days, 3 broken promises in last 6 months, Current exposure: 21m

That is where this can eventually become a much more defensible financial product. But don't build that now.

So your first technical milestone should be surprisingly boring:

**Build this:** Multi-tenant SaaS + Excel import + Customers + Receivables + Aging + Promises + Activity history + Telegram employee notifications

Then add exactly three AI features: AI Excel column mapping, AI reminder drafting, AI promise extraction

That's enough AI for V1.

More importantly, it teaches you the correct pattern: **LLM for ambiguity. Code for truth. Human confirmation for consequential changes. Tests for everything.**

If you build the project that way, you'll learn much more about serious AI engineering than you would by forcing a complicated swarm of agents into the architecture on day one.
