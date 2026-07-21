# Tevus — Usage & Analytics Platform · Prototype Plan

> **What this is:** a clickable, front-end-only prototype built to show the client the *direction* of the Phase 1 product — not the real system. Every screen runs on **dummy JSON data** (`data/*.json`); there is no backend, no Tavus API call, and nothing is persisted. The goal is to confirm we're building the right thing before real engineering starts.

---

## 1. What the client asked for (from the three source docs)

A secure, **multi-tenant analytics & provisioning platform** layered on top of **Tavus** (a video-AI "persona" / **PAL** platform). Tavus is one flat account with no concept of separate clients. Our platform adds the **ownership, isolation, and usage-analytics layer** Tavus lacks.

Three things the prototype has to make obvious:

1. **Usage visibility** — conversations, minutes, personas (PALs), replicas (faces), in a clean dashboard.
2. **Multi-tenancy & ownership** — one internal team manages many clients; each client sees **only** their own data.
3. **Minute budgets** — allocations as a **ledger** (initial + top-ups + usage) with a live remaining balance.

Two user populations, one login, routed by role:

| Portal | Roles | Sees |
|---|---|---|
| **Internal** | internal-admin, internal-staff | Everything: all clients, provisioning, budgets, cross-client analytics |
| **Client** | client-admin, client-user | Only their own org's usage + remaining minutes |

*(End users — the public who talk to the personas — are not platform users and have no screens.)*

---

## 2. How to open it

Just **double-click `index.html`** — it runs offline, no server needed. You land on the **Login** screen.

- A **"Demo accounts" card sits in the bottom-left corner** listing every seeded login from `data/users.json` with its email. Click one and it fills the form and signs in automatically — no typing, no password.
- **The account you pick decides everything**: internal logins get the internal portal (all clients); client logins get their own scoped portal and can only reach their own org's data. Try `manish.c@tevus.io` (internal-admin) then `manish.d@manishcorp.com` (Manish Corporation) back to back — that contrast *is* the isolation story.
- Once inside, the **account switcher (top-right)** jumps straight between logins without going back to the login screen. Sign out returns you to `#/login`.
- Three account states are wired, not just the happy path: **active** signs in, **invited** (`aman.j@manishcorp.com`) is routed to the invite-only *set password* screen, **disabled** (`chirag.s@chiragexpert.com`, whose org is paused) is refused with a reason.
- Role differences are real, not cosmetic: **internal-staff** loses every provisioning action, and **client-user** (`mohan.m@manishcorp.com`) loses the org-logins panel and top-up request that **client-admin** has.

---

## 3. The dummy data model (`data/*.json`)

These files are the deliverable "schema + dummy data." They mirror the real data model from the implementation plan, so the client sees the actual shape of the system. `build.py` bundles them into `assets/db.js` so the page runs by double-click (browsers block `fetch()` of local files). **The JSON files are the source of truth** — edit them, run `python3 build.py`, refresh.

| File | Entity | Key fields | Requirement |
|---|---|---|---|
| `clients.json` | Client org (tenant) | id, name, status, term, budget_minutes | 4.1, 4.3 |
| `personas.json` | Persona / PAL | id, tavus_persona_id, **client_id (null = unassigned)**, replica_id, system_prompt | 3.1, 4.4/4.5, 5.3 |
| `replicas.json` | Replica / Face | id, tavus_replica_id, client_id, status | 4.4, 5.5 |
| `conversations.json` | End-user session | id, persona_id, replica_id, started_at, duration_seconds | 3.1 |
| `transcripts.json` | Turn-by-turn transcript | conversation_id, turns[] | 3.4, 6.4 |
| `minute_ledger.json` | Budget ledger (append-only) | client_id, type (initial/topup/usage), amount, balance_after | 4.3, 7.x |
| `users.json` | Login | id, email, **group** (Cognito role), client_id, status | 2.1/2.2, 4.2 |
| `usage_daily.json` | Daily usage rollup | client_id, persona_id, date, conversations, minutes | 5.4 charts |
| `sync_status.json` | Data-freshness / pipeline health | last_sync_at, interval, recent_runs | 3.1–3.3, 5.6 |

**Everything on screen is derived** from these files: client balances come from the ledger, persona/client totals come from `usage_daily`, the charts plot the real daily series. Nothing is hard-coded — change the data and the UI changes.

**Ownership & isolation** (the core idea): a persona's `client_id` is the single source of truth. Conversations inherit their owner through the persona. Assign a persona to a client and it leaves every other client's pool (one persona = one client). `client_id: null` = unassigned = hidden from all client views. In the prototype, "Viewing as: <Client>" applies exactly the filter the real API would apply from the token's `client_id`.

---

## 4. Screen inventory

### Internal portal
| # | Screen | Route | Shows | Req |
|---|---|---|---|---|
| 1 | Overview | `#/overview` | Cross-client stat tiles, minutes-over-time, usage-by-client, top personas | 5.1–5.4, 5.6 |
| 2 | Clients | `#/clients` | List with status, personas, minutes used, balance · **+ New client** | 4.1, 4.3 |
| 3 | Client Detail | `#/client/:id` | Tabs: Overview · Personas & Replicas (assign/unassign) · Minutes (ledger) · Logins | 4.1–4.6 |
| 4 | Personas | `#/personas` | All synced PALs, filter All/Assigned/Unassigned | 3.1, 4.5, 5.3 |
| 5 | Persona Detail | `#/persona/:id` | Config, replica, usage trend, recent conversations | 5.3 |
| 6 | Replicas | `#/replicas` | All synced faces + assignment state | 4.4, 5.5 |
| 7 | Conversations | `#/conversations` | Cross-client log + transcript drawer | 3.1, 3.4 |
| 8 | Reports | `#/reports` | Saved reports + CSV export | (open Q) |
| 9 | Users | `#/users` | All logins, Cognito group, client, status | 2.1/2.2, 4.2 |
| 10 | Database | `#/database` | Pan/zoom schema canvas: every table, its columns and keys, and the foreign keys linking them | §3 data model |
| — | Sync status | (drawer via top-bar indicator) | Last sync, interval, recent runs, reconciliation | 3.1–3.3, 5.6 |

### Client portal (scoped)
| # | Screen | Route | Shows | Req |
|---|---|---|---|---|
| 11 | Dashboard | `#/c/dashboard` | Remaining-minutes hero, own usage, usage-by-persona | 5.7, 6.1, 6.3 |
| 12 | Minutes | `#/c/minutes` | Balance + read-only ledger, request top-up | 4.3, 6.3, 7.2 |
| 13 | Personas | `#/c/personas` | Own assigned personas as cards | 6.1 |
| 14 | Conversations | `#/c/conversations` | Own conversations + transcripts | 6.1, 6.4 |
| 15 | Profile & Settings | `#/c/profile` | Account + (client-admin) org logins | 4.2 |

### Auth (shared)
Login (`#/login`) · Set password (`#/set-password`, invite-based).

---

## 5. What the prototype demonstrates live (not just static screens)

- **Isolation** — sign in as a client login; every screen re-scopes and the internal routes are guarded (typing `#/overview` as a client bounces you back; opening another client's persona URL bounces you to your own list). No cross-client data is reachable.
- **Assignment** — Client Detail → Personas & Replicas → **+ Assign** picks from the *unassigned pool only*; assigning moves the persona to that client (and out of everyone else's pool). **Unassign** puts it back. Personas list reflects it immediately.
- **Ledger budgets** — remaining balance, % used, and the meter all recompute from `minute_ledger.json`.
- **Role permissions** — as **internal-staff**, provisioning actions (New client, Assign, Add minutes) are hidden — "read-mostly" (Req 2.2).
- **New client** — appends a client + initial ledger entry and drops you on its detail page.
- **Transcripts & sync** — transcript drawer per conversation; the "Synced Nm ago" indicator opens a pipeline-health drawer.

---

## 6. Open questions to confirm with the client (they steer direction)

1. **Signup model** — invite-based *set-password* (what we drew) vs. open self-registration?
2. **internal-staff limits** — is "hide provisioning actions" the right read of "read-mostly"?
3. **Client top-ups** — can a client *request* a top-up (button drawn), or purely internal-admin driven?
4. **Reports depth** — listing + CSV export enough for Phase 1, or a full in-app report builder?
5. **Sync/ops surface** — is a data-freshness drawer enough, or a dedicated internal Sync/Ops screen?

*(Items 4.7 export transcripts, 5.5 replica detail, 6.4 client transcript viewing are marked "nice-to-have / defer if tight" in the requirements — represented here but flagged.)*

---

## 7. Notes & boundaries

- **Front-end only.** No Tavus API, no auth, no persistence. Refresh resets any changes.
- **Not final visual design.** Clean near-monochrome SaaS look (from `../DESIGN.md`) — no brand color committed.
- **Real architecture** (Cognito, API Gateway + Lambda, Aurora, EventBridge sync + webhooks) is described in `../Tavus_Implementation_Plan.docx`; this prototype only visualizes the product surface that architecture serves.
