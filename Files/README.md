# ProctoEase - AI-Powered Online Examination Platform

ProctoEase is a full-stack, multi-tenant online assessment system built for secure technical evaluations. It supports mixed exams (MCQ + coding), live proctoring, plagiarism analysis, and recruiter analytics in a production-ready Dockerized setup.

## Final Status

- QA-critical defects are remediated and verified.
- Plagiarism API serialization issue (MissingGreenlet) is fixed for both trigger and report retrieval flows.
- Candidate preflight gating (camera/mic/fullscreen + identity photo) is intentional and active.
- Platform is demo-ready for mentor review and academic viva.

---

## Tech Stack

## Frontend

- Vite
- React 19 + TypeScript
- Zustand
- TanStack React Query
- Tailwind CSS v4

## Backend

- FastAPI (async)
- SQLAlchemy 2 (async) + asyncpg
- PostgreSQL
- Redis
- Alembic

## Assessment Engines

- Judge0 sandbox for coding execution
- Proctoring event pipeline over WebSocket
- Plagiarism analysis with token-structure similarity
- Risk scoring from proctoring violation events

---

## Repository Layout

- ProctoEase/: core backend + docker compose + migrations + frontend app
- FEATURES.md: complete role/module feature matrix
- ARCHITECTURE.md: system design and component behavior
- VIVA_PREPARATION.md: ready-to-use viva Q&A and presentation flow

---

## Run Full Stack with Docker (Recommended)

## 1) Prerequisites

- Docker Desktop installed and running
- Docker Compose v2 available

## 2) Start services

From the ProctoEase directory:

```powershell
cd ProctoEase
docker compose up -d --build
```

This starts:

- app (FastAPI backend)
- db (PostgreSQL)
- redis
- judge0-server
- judge0-worker
- judge0-db

## 3) Verify health

```powershell
curl http://localhost:8000/health
curl http://localhost:8000/health/ready
```

## 4) Access points

- API docs: http://localhost:8000/docs
- Backend base URL: http://localhost:8000
- Frontend (dev mode): run separately from ProctoEase/frontend

## 5) Stop services

```powershell
docker compose down
```

To remove volumes too:

```powershell
docker compose down -v
```

---

## Demo Credentials

Located in ProctoEase/demo_credentials.txt.

Primary recruiter account:

- Email: aarav.mehta@techcorp.com
- Password: DemoPass@123
- Tenant slug: techcorp

---

## Core Workflow Snapshot

1. Recruiter logs in and creates/publishes exam (manual/JSON/PDF ingestion).
2. Candidate passes preflight checks and starts attempt with verification image.
3. Candidate answers MCQs and submits coding solutions (Judge0 execution).
4. Live proctoring events are captured and persisted.
5. Recruiter computes risk, triggers plagiarism analysis, and reviews analytics/exports.

---

## Key API Modules

- /api/v1/auth
- /api/v1/exams
- /api/v1/attempts
- /api/v1/questions
- /api/v1/code
- /api/v1/proctoring
- /api/v1/plagiarism
- /api/v1/risk
- /api/v1/reporting

---

## Notes for Evaluation

- Architecture intentionally supports mixed question-format exams (not hard-separated by exam type).
- Security model includes tenant scoping, RBAC, ownership checks, and route-level throttling.
- Operational readiness includes health checks, metrics endpoint, and containerized reproducibility.
