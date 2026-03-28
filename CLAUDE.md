# CLAUDE.md — Daily Report Fill-Out System

This file provides guidance for AI assistants (Claude, Copilot, etc.) working in this repository.

---

## Project Overview

A **Next.js 16 App Router + PostgreSQL** daily report management system for Japanese companies. Employees submit daily work records; admins review them and export to Excel. Includes time calculations (overtime, deep-night hours) and paid-leave tracking.

**Live URL**: http://localhost:3000 (development)
**Initial Admin Login**: employee_id=`0001`, password=`password123`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1.6 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Database | PostgreSQL 16 via `pg` client |
| Styling | Tailwind CSS 4 |
| Auth | Cookie-based sessions (httpOnly, bcrypt passwords) |
| Excel | exceljs 4 |
| Runtime | Node.js >=20.9.0 |

**No Supabase SDK is used** — `lib/supabase.ts` is a custom PostgreSQL query builder that mimics the Supabase PostgREST fluent API.

---

## Repository Structure

```
daily-report-fill-out/
├── app/
│   ├── (auth)/               # Public routes (no session required)
│   │   └── login/page.tsx    # Login + password change page
│   ├── (app)/                # Protected routes (session required)
│   │   ├── layout.tsx        # App shell with header/nav
│   │   ├── reports/page.tsx  # User's monthly report view
│   │   └── admin/            # Admin-only pages
│   │       ├── reports/      # View all user reports
│   │       ├── export/       # Excel export
│   │       ├── users/        # User management
│   │       ├── paid-leave/   # Paid leave grants
│   │       └── maintenance/  # Bulk data deletion
│   ├── api/
│   │   ├── auth/             # login, logout, change-password
│   │   ├── reports/          # CRUD + export + bulk-delete
│   │   ├── users/            # Admin user management
│   │   ├── paid-leave/       # Paid leave CRUD
│   │   ├── health/           # Health check
│   │   └── version/          # Version info
│   └── layout.tsx            # Root layout
├── lib/
│   ├── supabase.ts           # Custom PostgreSQL query builder
│   ├── session.ts            # Session create/validate/delete
│   ├── calc.ts               # Work time calculations
│   ├── time.ts               # HH:MM ↔ minutes conversion
│   └── constants.ts          # App-wide constants
├── supabase/migrations/      # SQL migrations (applied in order)
├── scripts/migrate.js        # Auto-migration runner
├── proxy.ts                  # Auth middleware (cookie check)
├── templates/                # Excel template (日報ひな形.xlsx goes here)
├── .claude/hooks/            # Claude Code web session setup
└── public/                   # Static assets (logo, PWA manifest)
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Production build
npm run build

# Start production (runs migrations first, then server)
npm start

# Lint
npm run lint
```

**Note**: `npm start` calls `scripts/migrate.js` before launching the server. This auto-applies any pending SQL migrations from `supabase/migrations/`.

---

## Environment Configuration

Required environment variable:

```bash
# .env.local (development)
DATABASE_URL=postgresql://app_user:app_password@localhost:5432/daily_report
```

Optional overrides (with defaults):

```bash
BREAK_MINUTES=120       # Break minutes deducted from site work
STANDARD_MINUTES=480    # Standard work day in minutes (8 hours)
```

Production uses Railway + Supabase (session pooler URL at port 6543).

---

## Database Schema

### Tables

**`users`**
- `id` uuid PK
- `employee_id` char(4) UNIQUE — 4-digit employee number
- `password_hash` text — bcrypt(cost=10)
- `role` enum: `'user'` | `'admin'`
- `name` text
- `created_at` timestamptz

**`daily_reports`**
- `id` uuid PK
- `user_id` uuid FK → users(id) ON DELETE CASCADE
- `report_date` date
- `attendance_type` text — one of: 出勤, 欠勤, 休日, 有給, 振休, 休日出勤
- Time columns (all `smallint`, minutes 0–2879): `start_time`, `site_arrival_time`, `work_start_time`, `work_end_time`, `return_time`, `end_time`
- `note` text
- UNIQUE(user_id, report_date) — enables upsert

**`sessions`**
- `token` text UNIQUE — 64-char hex (crypto.randomBytes(32))
- `user_id` uuid FK → users(id) ON DELETE CASCADE
- `expires_at` timestamptz — 7-day sliding window

**`paid_leave_grants`**
- `user_id` uuid FK → users(id) ON DELETE CASCADE
- `grant_date` date, `expiry_date` date
- `granted_days` numeric

### Migrations

Located in `supabase/migrations/` — numbered `001_` through `005_`. Add new migrations as `006_*.sql`, etc. They are applied in alphabetical order via `scripts/migrate.js` which tracks applied files.

---

## Authentication & Authorization

### Session Flow
1. `POST /api/auth/login` → validates employee_id + bcrypt password → inserts session row → sets `session_token` httpOnly cookie
2. `proxy.ts` (middleware) — checks cookie presence on every request; redirects to `/login` if missing
3. Route handlers call `getSession()` (lib/session.ts) → queries sessions + users → extends `expires_at` by 7 days (sliding window)
4. `POST /api/auth/logout` → deletes session row → clears cookie

### Authorization Pattern
```typescript
// In every protected API route:
const session = await getSession();
if (!session) return NextResponse.json({ error: "..." }, { status: 401 });
if (session.role !== "admin") return NextResponse.json({ error: "..." }, { status: 403 });
```

### Public Paths (no auth required)
- `/login`
- `/api/auth/login`
- `/api/auth/change-password`
- `/api/health`
- `/logo.png`

---

## Key Library: QueryBuilder (`lib/supabase.ts`)

Custom PostgreSQL client with Supabase-style fluent API — **not** the Supabase JS SDK.

```typescript
import { supabase } from "@/lib/supabase";

// SELECT
const { data, error } = await supabase
  .from("daily_reports")
  .select("*")
  .eq("user_id", userId)
  .gte("report_date", from)
  .lte("report_date", to)
  .order("report_date");

// UPSERT (insert or update on conflict)
await supabase.from("daily_reports").upsert(row, { onConflict: "user_id,report_date" });

// DELETE
await supabase.from("sessions").delete().eq("token", token);
```

**Safety guard**: DELETE and UPDATE without a `.eq()` / `.in()` / `.lte()` / `.gte()` filter will throw an error to prevent accidental full-table wipes.

---

## Time Calculation Logic (`lib/calc.ts`)

Time fields are stored as **minutes since midnight** (0–2879 to support night shifts past midnight).

```
site_work_minutes      = work_end_time - work_start_time - BREAK_MINUTES(120)
travel_office_minutes  = (site_arrival_time - start_time) + (end_time - return_time)
overtime_minutes       = max(travel_office + site_work - STANDARD_MINUTES(480), 0)
deep_night_minutes     = overlap([start_time, end_time], [22:00, 29:00(=翌5:00)])
```

**Display**: `lib/time.ts` provides `minutesToHHMM(minutes)` → `"HH:MM"` and `hhmmToMinutes("HH:MM")` → integer.

---

## Constants (`lib/constants.ts`)

```typescript
BREAK_MINUTES = 120           // 2-hour break
STANDARD_MINUTES = 480        // 8-hour standard day
SESSION_TTL_MS = 604800000    // 7 days
SESSION_COOKIE = "session_token"
DEEP_NIGHT_START_MIN = 1320   // 22:00
DEEP_NIGHT_END_MIN = 1740     // 29:00 (= 翌5:00)
MAX_TIME_MINUTES = 2879       // 47:59 maximum

ATTENDANCE_TYPES = ['出勤', '欠勤', '休日', '有給', '振休', '休日出勤']
```

---

## API Reference

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Login; returns session cookie |
| POST | `/api/auth/logout` | User | Logout; clears cookie |
| POST | `/api/auth/change-password` | None | Change password (requires old password) |

### Reports
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reports?from=&to=[&user_id=]` | User | Fetch reports with computed columns |
| POST | `/api/reports` | User | Upsert a report for a date |
| POST | `/api/reports/export` | Admin | Generate Excel export |
| POST | `/api/reports/bulk-delete` | Admin | Delete reports in date range |

### Users (Admin Only)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | Admin | List all users |
| POST | `/api/users` | Admin | Create user |
| PATCH | `/api/users` | Admin | Reset user password |
| DELETE | `/api/users?id=` | Admin | Delete user |

### Paid Leave (Admin Only)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/paid-leave?user_id=` | Admin | Get grants + used + remaining |
| POST | `/api/paid-leave` | Admin | Create grant |
| DELETE | `/api/paid-leave?id=` | Admin | Delete grant |

---

## Excel Export

Requires `templates/日報ひな形.xlsx` to exist. The export route:
1. Reads the template file
2. Populates rows with report data for the given user/month
3. Applies number formatting for hours/minutes
4. Returns the file as an attachment

If the template file is missing, export returns a 500 error. See `templates/README.md` for placement instructions.

---

## Adding New Features

### New API Route
1. Create `app/api/<name>/route.ts`
2. Always call `getSession()` and check authorization at the top
3. Use `supabase.from(...)` for DB access — never raw SQL strings with user input
4. Return `NextResponse.json(...)` with appropriate HTTP status codes

### New Database Column
1. Create `supabase/migrations/00N_description.sql`
2. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
3. The migration runs automatically on next `npm start`

### New Page (Protected)
- Place under `app/(app)/` — the layout provides session-gated header/nav
- For admin-only pages, place under `app/(app)/admin/` and check `session.role === "admin"` in the component or a server action

---

## Conventions

- **Language**: UI and error messages are in Japanese (ja-JP)
- **Date format**: `YYYY-MM-DD` in API params; displayed as `YYYY年M月D日` in UI
- **Time format**: stored as minutes integer; displayed as `HH:MM`
- **Employee IDs**: always 4 numeric digits (e.g., `"0001"`)
- **Passwords**: minimum 6 alphanumeric characters
- **No test suite**: test manually via browser after changes
- **No ORM**: use the QueryBuilder in `lib/supabase.ts` for all DB access
- **Server components**: default in App Router; add `"use client"` only when using React hooks/events
- **Error responses**: use generic messages that don't leak whether a user exists

---

## Claude Code Web Setup

The `.claude/hooks/session-start.sh` script auto-provisions the environment when using Claude Code on the web:
1. Starts PostgreSQL
2. Creates `app_user` + `daily_report` database
3. Applies all migrations
4. Starts the Next.js dev server in the background

This runs automatically on session start — no manual setup needed in web sessions.
