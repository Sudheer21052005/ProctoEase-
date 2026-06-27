# ProctoEase — Project Plan

> Multi-tenant AI-assisted online examination SaaS
> FastAPI + PostgreSQL + Redis + Docker

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [Database Schema](#4-database-schema)
5. [API Routes](#5-api-routes)
6. [Security Architecture](#6-security-architecture)
7. [Completion Status](#7-completion-status)
8. [Phase Breakdown](#8-phase-breakdown)
9. [Dependency Graph](#9-dependency-graph)
10. [Kanban Board](#10-kanban-board)
11. [Week-by-Week Execution Plan](#11-week-by-week-execution-plan)
12. [Effort Estimates](#12-effort-estimates)
13. [Architectural Risks](#13-architectural-risks)

---

## 1. Project Overview

ProctoEase is a multi-tenant SaaS platform for AI-assisted online examinations. It supports:

- **Multi-tenancy** with Row-Level Security (RLS) — one DB, isolated data per organisation
- **Role-based access** — Admin, Recruiter, Candidate
- **AI proctoring** — real-time face detection and event monitoring
- **Code execution** — sandboxed via Judge0
- **Plagiarism detection** — AST-based code similarity analysis
- **Risk scoring** — composite risk scores from proctoring events

### MVP Scope

| Use Case | Role |
|:---|:---|
| Create tenant (organisation) | Public |
| Register / Login / Refresh | Public |
| Create exam | Recruiter |
| List & view exams (tenant-isolated) | Any authenticated |
| Start exam attempt | Candidate |
| View own attempts | Candidate |

---

## 2. Tech Stack

| Component | Technology |
|:---|:---|
| Backend framework | FastAPI (async) |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.x (async) |
| Migrations | Alembic |
| Auth | JWT (HS256) — access + refresh tokens |
| Password hashing | bcrypt (via passlib) |
| Caching / Pub-Sub | Redis 7 |
| Background tasks | Celery (future) |
| Containerisation | Docker + Docker Compose |
| Code execution | Judge0 CE (future) |
| AI inference | MediaPipe / YOLO-face (future) |

---

## 3. Folder Structure

```
proctoease/
├── docker-compose.yml
├── Dockerfile
├── .env / .env.example
├── alembic.ini
├── requirements.txt
├── init.sql
│
├── alembic/
│   ├── env.py
│   └── versions/
│       ├── 001_phase1_foundation.py
│       └── 002_phase3_exams_attempts.py
│
└── app/
    ├── __init__.py
    ├── main.py                  # FastAPI app factory, middleware, lifespan
    │
    ├── core/
    │   ├── config.py            # Pydantic Settings (env-driven)
    │   ├── database.py          # AsyncEngine, session factory, get_db + RLS
    │   ├── security.py          # JWT creation/verification, password hashing
    │   └── dependencies.py      # get_current_user, require_role()
    │
    ├── middleware/
    │   └── tenant.py            # TenantMiddleware — sets tenant context per request
    │
    ├── models/
    │   ├── __init__.py           # Re-export all models (for Alembic discovery)
    │   ├── base.py              # Declarative Base + TenantMixin + TimestampMixin
    │   ├── tenant.py            # Tenant model
    │   ├── user.py              # User model + UserRole enum
    │   ├── exam.py              # Exam model
    │   └── attempt.py           # ExamAttempt model + AttemptStatus enum
    │
    ├── schemas/
    │   ├── tenant.py            # TenantCreate, TenantRead
    │   ├── user.py              # UserRegister, UserRead
    │   ├── auth.py              # LoginRequest, TokenResponse, RefreshRequest
    │   ├── exam.py              # ExamCreate, ExamRead
    │   └── attempt.py           # AttemptCreate, AttemptRead
    │
    ├── services/
    │   ├── tenant_service.py    # Tenant provisioning logic
    │   ├── user_service.py      # Registration, lookup
    │   ├── auth_service.py      # Login, token refresh
    │   ├── exam_service.py      # Exam create, list, get
    │   └── attempt_service.py   # Attempt creation, list own
    │
    └── api/
        ├── router.py            # Central router aggregator
        └── v1/
            ├── tenants.py       # POST /tenants
            ├── auth.py          # register, login, refresh, /me
            ├── exams.py         # POST, GET /exams
            └── attempts.py      # POST /exams/{id}/attempts, GET /attempts/me
```

### Layer Responsibilities

| Layer | Responsibility |
|:---|:---|
| `models/` | SQLAlchemy ORM — database truth. One file per entity. |
| `schemas/` | Pydantic DTOs — request/response validation. Zero DB awareness. |
| `services/` | Business logic — orchestrates models, raises domain exceptions. |
| `api/v1/` | HTTP layer — thin controller; validates, delegates to services. |
| `core/` | Cross-cutting: config, DB engine, auth, dependency injection. |
| `middleware/` | Pre-route processing (tenant context injection). |

> Future modules (proctoring, plagiarism, risk scoring) each become a new
> `models/*.py` + `schemas/*.py` + `services/*.py` + `api/v1/*.py`
> — zero changes to existing files.

---

## 4. Database Schema

All PKs are `UUID` (generated server-side). All business tables carry `tenant_id` FK.

```
┌─────────────┐       ┌─────────────┐       ┌─────────────────┐
│   tenants    │       │    users     │       │     exams       │
├─────────────┤       ├─────────────┤       ├─────────────────┤
│ id (PK)     │──┐    │ id (PK)     │──┐    │ id (PK)         │
│ name        │  │    │ tenant_id   │←─┘    │ tenant_id (FK)  │
│ slug (UK)   │  │    │ email       │       │ title           │
│ is_active   │  │    │ hashed_pw   │       │ description     │
│ created_at  │  │    │ full_name   │       │ duration_min    │
└─────────────┘  │    │ role        │       │ is_published    │
                 │    │ is_active   │       │ is_active       │
                 │    │ created_at  │       │ created_by (FK) │→ users.id
                 │    └─────────────┘       │ created_at      │
                 │                          └─────────────────┘
                 │                                   │
                 │    ┌───────────────────┐          │
                 └───→│  exam_attempts     │←─────────┘
                      ├───────────────────┤
                      │ id (PK)           │
                      │ tenant_id (FK)    │
                      │ exam_id (FK)      │→ exams.id
                      │ candidate_id (FK) │→ users.id
                      │ status            │   (started|submitted|evaluated)
                      │ is_active         │
                      │ started_at        │
                      │ submitted_at      │
                      │ answers (JSONB)   │
                      └───────────────────┘
```

### Key Constraints

- `users`: compound unique on `(tenant_id, email)` — same email allowed across tenants
- `role`: stored as `VARCHAR(20)`, not PG ENUM (avoids DDL migration pain)
- RLS policies on `users`, `exams`, `exam_attempts` — defense-in-depth
- `is_active` on all entities — soft delete, no hard delete

---

## 5. API Routes

All routes under `/api/v1`. Tenant context is implicit via JWT (no `tenant_id` in URL).

| Method | Path | Auth | Role | Purpose |
|:---|:---|:---|:---|:---|
| `GET` | `/health` | — | — | DB liveness probe |
| `POST` | `/api/v1/tenants/` | — | — | Create organisation |
| `POST` | `/api/v1/auth/register` | — | — | Register user (tenant_slug in body) |
| `POST` | `/api/v1/auth/login` | — | — | Get access + refresh tokens |
| `POST` | `/api/v1/auth/refresh` | Refresh | — | Rotate token pair |
| `GET` | `/api/v1/auth/me` | Bearer | Any | Current user profile |
| `POST` | `/api/v1/exams/` | Bearer | Recruiter/Admin | Create exam |
| `GET` | `/api/v1/exams/` | Bearer | Any | List exams (candidates: published only) |
| `GET` | `/api/v1/exams/{id}` | Bearer | Any | Single exam detail |
| `POST` | `/api/v1/exams/{id}/attempts` | Bearer | Candidate | Start attempt |
| `GET` | `/api/v1/attempts/me` | Bearer | Candidate | List own attempts |

---

## 6. Security Architecture

### Authentication Flow

```
Client → POST /auth/login {email, password, tenant_slug}
       → AuthService: lookup tenant by slug
       → AuthService: SELECT user WHERE email AND tenant_id
       → AuthService: bcrypt verify password
       ← {access_token (15 min), refresh_token (7 days)}
```

### Token Design

| Claim | Access Token | Refresh Token |
|:---|:---|:---|
| `sub` | user UUID | user UUID |
| `tenant_id` | ✅ | ✅ |
| `role` | ✅ | ❌ |
| `type` | `"access"` | `"refresh"` |
| `exp` | 15 min | 7 days |

- Signed with **HS256** + `SECRET_KEY` from environment
- Stateless refresh tokens for MVP; DB-backed rotation planned for Phase 4

### RBAC: `require_role()`

```python
@router.post("/exams")
async def create_exam(
    payload: ExamCreate,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
): ...
```

Returns **403 Forbidden** if the user's role is not in the allowed list.

### Tenant Isolation (4 layers)

| Layer | Mechanism |
|:---|:---|
| **JWT** | `tenant_id` embedded in every token |
| **Middleware** | Extracts `tenant_id`, sets `request.state.tenant_id` |
| **`get_db` dependency** | Runs `SET app.current_tenant_id = '{uuid}'` on PG session |
| **PostgreSQL RLS** | `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)` |

> MVP uses app-level filtering + RLS. Services explicitly filter by `tenant_id`,
> and RLS acts as a safety net. A bug in service code CANNOT leak cross-tenant data.

---

## 7. Completion Status

| Phase | Status | Summary |
|:---|:---|:---|
| Phase 1 — Foundation | ✅ Done | Docker, config, database, security, models, Alembic, health endpoint |
| Phase 2 — Auth & Tenancy | ✅ Done | Schemas, services, dependencies, middleware, auth + tenant APIs |
| Phase 3 — Business Endpoints | ✅ Done | Exam + attempt models, services, RBAC routers, migration with RLS |
| Phase 4 — Hardening | ✅ Done | Custom exceptions, error handlers, structured logging, Dockerfile, OpenAPI |
| Phase 5 — AI Proctoring | ✅ Done | WebSocket proctoring, event storage, questions CRUD |
| Phase 6 — Judge0 Code Exec | ✅ Done | Judge0 Docker service, code submission API, results polling |
| Phase 7 — Plagiarism Detection | ✅ Done | AST-based token similarity, pairwise comparison, threshold flagging |
| Phase 8 — Risk Scoring | ✅ Done | Weighted composite scoring, diminishing returns, 4-tier risk levels |
| Phase 9 — Reporting | ✅ Done | Analytics dashboards, CSV exports, candidate performance |
| Phase 10 — Production | ✅ Done | Rate limiting, DB pool tuning, health checks, Prometheus, CI/CD |
| Phase 11 — Frontend Gaps | ✅ Done | CORS fix, answer management, attempt submit, exam update, auto-grading |
| Phase F1 — Auth Wiring | ✅ Done | Token persistence (localStorage), rehydration on startup, auto-logout |
| Phase F2 — Candidate Exam | ✅ Done | Real questions from API, auto-save 30s, submit with auto-grading |
| Phase F3 — Proctoring WS | ✅ Done | WebSocket connection, violation forwarding, heartbeat |
| Phase F4 — Recruiter Mgmt | ✅ Done | Publish toggle, question CRUD, attempt listing |
| Phase F5 — Analytics | ✅ Done | Dashboard stats from API, risk distribution, CSV exports |
| Phase F6 — Code API | ✅ Done | API client for Judge0 code execution |
| Phase F7 — Admin Panel | ✅ Done | Tenant-wide stats, risk chart, completion rate, CSV exports |

---

## 8. Phase Breakdown

### Phase 4 — Hardening (2 days) — `MVP-CRITICAL`

| Task | Detail |
|:---|:---|
| Custom exception classes | `TenantNotFound`, `DuplicateEmail`, `ExamNotPublished` etc. |
| Global error handler | Consistent JSON error responses, hide tracebacks in prod |
| Request validation edge cases | Empty bodies, invalid UUIDs, overlong strings |
| Structured logging | `structlog` with request_id, tenant_id correlation |
| Smoke tests | `pytest` + `httpx.AsyncClient` for all 11 endpoints |
| Dockerfile optimization | `.dockerignore`, layer caching, non-root user |
| API docs polish | OpenAPI tags, descriptions, example payloads |

### Phase 5 — AI Proctoring (4 days) — `CORE FEATURE`

> Depends on: Phase 4

| Task | Detail |
|:---|:---|
| `models/proctoring_event.py` | Per-candidate events (face_away, tab_switch, multi_face) |
| WebSocket endpoint | `ws://…/exams/{id}/attempts/{id}/proctor` — real-time event stream |
| Frame analysis service | Base64 frames → face detection (MediaPipe / YOLO-face) |
| Event classification | `no_face`, `multiple_faces`, `tab_switch`, `audio_anomaly` |
| Snapshot storage | Save flagged frames to S3 / local volume |
| Alembic migration | `proctoring_events` table + RLS |

**Architecture:**

```
Browser Camera → WebSocket frame → FastAPI WS → Frame Analyzer
                                                    ↓
                                              Violation?
                                              Yes → Store Event + Flag → Risk Engine
                                              No  → Discard
```

### Phase 6 — Judge0 Code Execution (3 days) — `CORE FEATURE`

> Depends on: Phase 4 · Can run in parallel with Phase 5

| Task | Detail |
|:---|:---|
| Judge0 Docker service | Add Judge0 CE to `docker-compose.yml` |
| `services/code_execution_service.py` | Submit code → Judge0 API → poll result |
| `models/code_submission.py` | Source, language, stdin, stdout, status |
| `api/v1/code.py` | `POST /attempts/{id}/code` — submit + execute |
| Language whitelist | Configurable allowed languages per exam |
| Resource limits | Per-submission timeout + memory caps |
| Alembic migration | `code_submissions` table |

### Phase 7 — Plagiarism Detection (3 days) — `ENHANCEMENT`

> Depends on: Phase 6

| Task | Detail |
|:---|:---|
| `services/plagiarism_service.py` | Token-based similarity (AST fingerprinting) |
| `models/plagiarism_report.py` | Similarity scores between submission pairs |
| Celery background task | Pairwise comparison after exam deadline |
| Threshold configuration | Per-tenant similarity threshold (default 80%) |
| Results API | `GET /exams/{id}/plagiarism-report` (Recruiter only) |

### Phase 8 — Risk Scoring Engine (2 days) — `ENHANCEMENT`

> Depends on: Phase 5

| Task | Detail |
|:---|:---|
| `services/risk_engine.py` | Weighted score from proctoring events |
| Scoring model | Configurable: tab_switch(0.3), no_face(0.5), multi_face(0.8) |
| `models/risk_score.py` | Per-attempt composite risk score + breakdown |
| Real-time updates | Redis pub/sub from proctoring → risk engine |
| Dashboard API | `GET /attempts/{id}/risk-score` |

### Phase 9 — Reporting & Analytics (3 days) — `ENHANCEMENT`

> Depends on: Phases 5–8

| Task | Detail |
|:---|:---|
| Tenant dashboard API | Exam stats, attempt counts, pass rates |
| Exam analytics | Per-exam: avg score, completion rate, avg duration |
| Candidate performance | Attempt history, risk scores, code results |
| Export endpoints | CSV / PDF export for exam results |

### Phase 10 — Production Readiness (2 days) — `MVP-CRITICAL`

| Task | Detail |
|:---|:---|
| Rate limiting | Redis-backed (slowapi or custom) |
| DB pooling tuning | `pool_size`, `max_overflow`, `pool_recycle` |
| Health check expansion | Redis, Judge0, disk space checks |
| CI/CD pipeline | GitHub Actions: lint → test → build → push |
| Monitoring | Prometheus metrics endpoint |

---

## 9. Dependency Graph

```
Phase 1 (Foundation) ✅
    └──→ Phase 2 (Auth & Tenancy) ✅
            └──→ Phase 3 (Business Endpoints) ✅
                    └──→ Phase 4 (Hardening)
                            ├──→ Phase 5 (AI Proctoring)  ──→ Phase 8 (Risk Scoring) ──┐
                            │                                                           │
                            └──→ Phase 6 (Judge0)  ──→ Phase 7 (Plagiarism) ────────────┤
                                                                                        │
                                                            Phase 9 (Reporting) ←───────┘
                                                                │
                                                                └──→ Phase 10 (Production)
```

> **Key insight:** Phases 5 & 6 can run in parallel — they share no dependencies.

---

## 10. Kanban Board

| ✅ Done | ⏳ Next | 📋 Backlog | 🔮 Future |
|:---|:---|:---|:---|
| Foundation | Error handler | AI Proctoring: WS endpoint | Reporting: CSV export |
| Auth & Tenancy | Smoke tests | AI Proctoring: frame analysis | Reporting: PDF export |
| Business Endpoints | Structured logging | Judge0: Docker service | Production: CI/CD |
| | Dockerfile optim. | Judge0: code submission API | Production: monitoring |
| | Custom exceptions | Plagiarism: similarity engine | Real-time notifications |
| | | Risk Scoring: weighted model | Admin superpanel |
| | | Risk Scoring: Redis pub/sub | Question bank module |

---

## 11. Week-by-Week Execution Plan

| Week | Focus | Deliverables |
|:---|:---|:---|
| **Week 1** ✅ | Foundation + Auth + Business | Phases 1–3 complete |
| **Week 2** | Hardening + AI Proctoring start | Error handling, tests, logging, WS scaffold |
| **Week 3** | AI Proctoring + Judge0 (parallel) | Frame analysis, code execution, submissions |
| **Week 4** | Plagiarism + Risk Scoring | Similarity engine, weighted scoring, alerts |
| **Week 5** | Reporting + Production Readiness | Analytics APIs, CI/CD, rate limiting |

---

## 12. Effort Estimates

| Phase | Days | Complexity | Priority |
|:---|:---:|:---:|:---|
| ~~Phase 1 — Foundation~~ | ~~1~~ | — | ✅ Done |
| ~~Phase 2 — Auth & Tenancy~~ | ~~1~~ | — | ✅ Done |
| ~~Phase 3 — Business Endpoints~~ | ~~1~~ | — | ✅ Done |
| Phase 4 — Hardening | **2** | Medium | 🔴 MVP-Critical |
| Phase 5 — AI Proctoring | **4** | High | 🟡 Core Feature |
| Phase 6 — Judge0 | **3** | Medium | 🟡 Core Feature |
| Phase 7 — Plagiarism | **3** | High | 🟢 Enhancement |
| Phase 8 — Risk Scoring | **2** | Medium | 🟢 Enhancement |
| Phase 9 — Reporting | **3** | Medium | 🟢 Enhancement |
| Phase 10 — Production | **2** | Low | 🔴 MVP-Critical |
| **Total remaining** | **~22 days** | | |

---

## 13. Architectural Risks

| Risk | Impact | Mitigation |
|:---|:---|:---|
| **WebSocket scaling** | Proctoring WS connections × concurrent candidates | Horizontal scaling + connection limits per worker |
| **Frame processing latency** | ML inference blocking event loop | Offload to background worker (Celery / process pool) |
| **Judge0 resource exhaustion** | Infinite loops from student code | Per-submission timeout + memory cap + queue limits |
| **RLS bypass** | Bug in `get_db` skips tenant context | Unit test asserting RLS context is always set |
| **Refresh token theft** | Stateless tokens can't be revoked | Phase 4: move to DB-backed token store + rotation |
| **Plagiarism false positives** | Boilerplate triggers similarity | Exclude imports/boilerplate, use AST-level comparison |
| **JSONB answers schema** | No validation on answer format | Define JSON Schema per exam type, validate in service |

---

## Quick Start

```bash
# 1. Start all services
docker compose up -d --build

# 2. Run migrations
docker compose exec app alembic upgrade head

# 3. Verify
curl http://localhost:8000/health
# → {"status":"healthy","service":"proctoease","database":"connected"}

# 4. Create a tenant
curl -X POST http://localhost:8000/api/v1/tenants/ \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "slug": "acme-corp"}'

# 5. Register a user
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "securepass123", "full_name": "Admin", "role": "admin", "tenant_slug": "acme-corp"}'

# 6. Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "securepass123", "tenant_slug": "acme-corp"}'
```
