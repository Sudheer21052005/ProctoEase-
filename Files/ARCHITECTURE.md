# ProctoEase - System Architecture

## 1. Architecture Overview

ProctoEase is a multi-tenant, full-stack online examination platform designed for secure assessment workflows combining objective questions, coding challenges, and AI-assisted proctoring telemetry.

The architecture follows a layered model:

- Frontend: React SPA for candidate and recruiter/admin workflows.
- Backend: FastAPI async API with domain services and strict tenant scoping.
- Data Layer: PostgreSQL for transactional data and Redis for runtime support.
- Execution Layer: Judge0 sandbox for untrusted code execution.
- Monitoring Layer: Prometheus metrics and health/readiness probes.

---

## 2. High-Level Component Diagram (Textual)

Client Browser (React + Vite + Zustand + Tailwind)
  -> FastAPI API Gateway (/api/v1)
    -> Service Layer (Auth, Exams, Attempts, Proctoring, Code, Plagiarism, Risk, Reporting)
      -> PostgreSQL (tenant-scoped relational persistence)
      -> Redis (rate limiting and fast runtime infra)
      -> Judge0 Server + Worker + Judge0 DB (code sandbox)

In parallel:

Client Proctoring Hook
  -> WebSocket channel (/api/v1/exams/{exam_id}/attempts/{attempt_id}/proctor)
    -> Proctoring event persistence
    -> Risk scoring input pipeline

---

## 3. Frontend Architecture

## 3.1 Technology Stack

- Build tool: Vite.
- UI framework: React 19.
- Language: TypeScript.
- State management: Zustand (session and interaction stores).
- Data fetching and caching: TanStack React Query.
- Styling: Tailwind CSS v4.
- Forms and validation: React Hook Form + Zod.
- Animation/UI polish: Framer Motion + component-level utility styling.

## 3.2 Frontend Design Structure

- Role-oriented route groups for Admin/Recruiter/Candidate.
- Feature-centric hooks:
  - useProctoring
  - useAttempts
  - useExams
  - useProctoringData
- API abstraction layer (axios-based) for each domain.
- Candidate preflight gate before attempt creation (camera/mic/fullscreen/rules/photo capture).
- Real-time websocket client lifecycle management with heartbeat and resilience to transient failures.

## 3.3 Runtime Behavior

- React Query holds server-backed canonical domain data.
- Zustand handles UI/interaction state (active attempt, proctoring counters, transient drafts).
- Browser event listeners enforce client-side integrity controls (tab/focus, keyboard, copy-paste, fullscreen, inactivity).

---

## 4. Backend Architecture

## 4.1 Technology Stack

- Framework: FastAPI (asynchronous).
- ORM: SQLAlchemy 2 async.
- Driver: asyncpg for PostgreSQL.
- Validation: Pydantic v2.
- Auth: JWT (access + refresh).
- Migrations: Alembic.
- Rate limiting: slowapi + Redis-backed limits.

## 4.2 Layered Backend Design

- api/v1: HTTP interfaces and request/response models.
- services: domain logic orchestration.
- models: SQLAlchemy entities with tenant-aware structure.
- schemas: request/response DTOs.
- core: config, database, security, dependencies, exceptions, logging.
- middleware: request logging + tenant context handling.

## 4.3 API Surface

Core modules exposed under /api/v1:

- tenants
- auth
- exams
- attempts
- proctoring
- questions
- code
- plagiarism
- risk
- reporting

## 4.4 Cross-Cutting Concerns

- Middleware-based tenant context extraction.
- Role guard dependency for route-level RBAC.
- Central exception mapping for consistent API failures.
- Structured logs for request and service-level events.
- OpenAPI tags and endpoint summaries for maintainability.

---

## 5. Data Architecture (PostgreSQL + Async Access)

## 5.1 Persistence Model

Key entities:

- Tenant
- User
- Exam
- Question
- ExamAttempt
- CodeSubmission
- ProctoringEvent
- PlagiarismReport / PlagiarismPair
- RiskScore

## 5.2 Multi-Tenant Isolation

- tenant_id present across tenant-scoped domain entities.
- Query-time tenant filtering enforced in services.
- Tenant context handled at middleware/dependency level.
- Role + ownership checks prevent horizontal privilege escalation.

## 5.3 Async ORM Strategy

- Async session dependency per request.
- Explicit loading/serialization to avoid runtime lazy-load issues in async response rendering.
- Domain services return response-safe structures where async lazy relations could fail (notably plagiarism reports).

---

## 6. Redis Architecture

Redis is used as a fast infrastructure component for:

- request rate-limiting backend store,
- runtime dependency for Judge0 service composition,
- low-latency operational support.

This separation keeps transactional truth in PostgreSQL while enabling scalable request control and distributed service health.

---

## 7. Code Execution Sandbox Architecture (Judge0)

## 7.1 Components

- judge0-server: API entrypoint for code execution.
- judge0-worker: asynchronous execution worker.
- judge0-db: dedicated PostgreSQL store for Judge0 internal metadata.

## 7.2 Flow

1. Candidate submits code to FastAPI endpoint.
2. Backend validates attempt ownership and tenant scope.
3. Backend forwards source/language/stdin to Judge0.
4. Judge0 returns token (queued execution).
5. Backend polls Judge0 for final status and stores outputs.
6. Candidate/recruiter fetches persisted result from ProctoEase API.

## 7.3 Security and Isolation

- Code execution runs outside core app process.
- Judge0 resource limits configured in Docker Compose.
- App stores only execution metadata/results, never executes untrusted code locally.

---

## 8. AI / Proctoring Architecture

## 8.1 Real-Time Proctoring Pipeline

- Candidate client emits events over WebSocket for each active attempt.
- Backend validates token, tenant, and attempt context.
- Events are normalized to canonical violation types and persisted.
- Server sends acknowledgment with violation count for synchronization.

## 8.2 Event Sources

- Tab switch and window blur.
- Fullscreen exits.
- Blocked keyboard shortcuts.
- Copy/paste and context menu usage.
- Inactivity timeout.
- Devtools heuristics.
- Periodic checkpoints with optional snapshots.
- Face consistency signals (no-face, multiple-faces, transition anomalies).

## 8.3 Face Detection Layer (TensorFlow Context)

Current implementation uses browser-native face detection capability when available (FaceDetector API) for non-blocking real-time checks.

Architecture is intentionally model-agnostic and ready for upgrade to TensorFlow-based inference (or MediaPipe) by replacing the client-side face detector adapter while keeping event contracts unchanged.

This allows viva discussion on AI extensibility without destabilizing the current demo build.

## 8.4 Risk Integration

Proctoring events feed directly into risk scoring:

- weighted contributions by event type,
- diminishing returns to reduce over-amplification,
- normalized overall risk score,
- categorical level assignment for recruiter action.

---

## 9. Plagiarism Detection Architecture

## 9.1 Analysis Strategy

- Collect code submissions for an exam.
- Tokenize code (Python-aware path + generic fallback path).
- Run pairwise similarity comparisons.
- Flag pairs above threshold.
- Persist report and pair records.

## 9.2 Similarity Logic

- Combines token-level overlap signals.
- Preserves explainability through matching token counts and metadata.
- Supports configurable threshold per trigger request.

## 9.3 API Reliability Fix (Final)

- Async lazy-loading issues in ORM-to-response conversion were eliminated for plagiarism report payloads by using explicit dictionary serialization.
- Both trigger and report retrieval paths now avoid MissingGreenlet failures in FastAPI response rendering.

---

## 10. Operational Architecture

## 10.1 Containerized Deployment

Docker Compose services:

- app
- db
- redis
- judge0-server
- judge0-worker
- judge0-db

## 10.2 Health and Observability

- Liveness endpoint: /health
- Readiness endpoint: /health/ready (checks DB, Redis, Judge0)
- Metrics endpoint: /metrics (Prometheus format)

## 10.3 Resilience Features

- Route-level throttling for abuse-prone endpoints.
- Non-fatal websocket degradation handling on client side.
- Safe restart workflow via container health checks.
- Consistent startup/shutdown lifecycle management for async engine.

---

## 11. Why This Architecture Is Strong for Academic Evaluation

- Demonstrates end-to-end full-stack engineering, not isolated prototypes.
- Balances security, performance, and maintainability.
- Integrates real-time channels, async APIs, and sandbox execution responsibly.
- Supports advanced topics (AI proctoring, plagiarism detection, risk modeling) with clear modular separation.
- Maintains extensibility for future improvements (TensorFlow adapters, richer analytics, background workers).
