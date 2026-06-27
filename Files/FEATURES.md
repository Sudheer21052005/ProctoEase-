# ProctoEase - Comprehensive Feature List

## 1. Platform-Wide Core Capabilities

- Multi-tenant SaaS architecture with strict tenant isolation.
- Role-based access control (RBAC) with three roles: Admin, Recruiter, Candidate.
- JWT authentication with access and refresh token flow.
- PostgreSQL-backed persistence with async SQLAlchemy ORM.
- Redis integration for rate-limiting and real-time support services.
- Production-ready Docker Compose stack (API, PostgreSQL, Redis, Judge0 services).
- Structured domain exceptions and centralized error response model.
- API documentation via OpenAPI/Swagger.
- Health and readiness endpoints for deployment probes.
- Prometheus metrics exposure for observability.

---

## 2. Role-Wise Feature Coverage

## 2.1 Admin Features

- Tenant-aware admin login and session management.
- Controlled account model: admin self-registration is blocked by policy.
- Access to all recruiter-level monitoring and reporting capabilities.
- Full visibility into exam operations and candidate attempt analytics within tenant scope.
- Read-only access to candidate answers and coding submissions for audit workflows.
- Access to violation guidelines, proctoring timelines, risk analytics, and plagiarism reports.

## 2.2 Recruiter Features

### Exam Management

- Create exam manually via API payload.
- Create exam via JSON ingestion mode.
- Create exam via PDF ingestion mode.
- Preview exam ingestion output before persistence.
- Publish/unpublish exam using exam update endpoint.
- Manage mixed-format exams (MCQ + coding in same exam).
- Retrieve exam list and individual exam details.

### Candidate Attempt Management

- List attempts for an exam.
- Paginated attempt listing for high-volume exam sessions.
- Inspect candidate attempt status and timestamps.
- View candidate saved answers and post-submission graded output.

### Proctoring and Integrity Monitoring

- Access per-attempt proctoring event timeline.
- Access paginated event timeline.
- View event type breakdown and total violation count.
- Read canonical violation guidelines and suggested interventions.

### Code and Technical Evaluation

- View candidate code submissions for each attempt.
- Inspect execution result metadata (stdout, stderr, compile output, memory/time usage, status).

### Risk and Fraud Analytics

- Compute risk score per attempt on demand.
- Override default risk weights during computation.
- View existing risk score for attempt.
- List and rank risk summaries for all attempts in an exam.

### Plagiarism Analysis

- Trigger exam-wide plagiarism report generation.
- List plagiarism report summaries for exam.
- Fetch detailed plagiarism report with pairwise comparison records.
- Review flagged pairs, similarity scores, matching token counts, and analysis details.

### Reporting and Exports

- Tenant dashboard with high-level aggregate metrics.
- Per-exam analytics endpoint (completion, duration, risk, event stats).
- Question-level performance analytics with pagination.
- Candidate performance analytics with pagination envelope.
- CSV export of exam results.
- CSV export of tenant dashboard roll-up.

## 2.3 Candidate Features

### Authentication and Session

- Tenant-scoped login using email, password, tenant slug.
- Access token and refresh token lifecycle.
- Secure profile retrieval endpoint.

### Exam Discovery and Access

- List only published exams.
- View exam details and schedule window.

### Preflight and Start Controls

- Browser capability checks (media APIs, fullscreen, visibility APIs).
- Webcam permission verification.
- Microphone permission verification.
- Fullscreen capability verification.
- Mandatory identity verification photo capture before attempt creation.
- Proctoring terms agreement gate before Begin Exam is enabled.
- Exam window enforcement (not started / expired guard).
- Active-attempt resume flow to prevent accidental duplicate starts.

### Attempt and Answer Lifecycle

- Start attempt (candidate only).
- Auto-save friendly bulk answer upsert endpoint.
- Fetch saved answers while attempt is active.
- Submit attempt endpoint (finalize session).
- Automatic MCQ grading at submission.
- Auto-submit behavior when attempt duration expires.

### Coding Assessment Flow

- Submit code against selected question and language.
- Poll execution status/results via Judge0 token mapping.
- View own submission history for attempt.
- Access language catalog from Judge0.

### Real-Time Proctoring Experience

- WebSocket-based live proctoring event pipeline.
- Client-side violation detection for tab switches and focus loss.
- Fullscreen-exit detection with enforced fullscreen re-entry attempt.
- Keyboard shortcut blocking (copy/paste/devtools-related combos).
- Copy, paste, and right-click blocking with event logging.
- Inactivity detection with threshold-based events.
- Developer tools heuristic detection.
- Periodic webcam checkpoint events.
- Face consistency monitoring (no-face, multiple-faces, abrupt transition signals when supported by browser APIs).
- Local robustness: proctoring continues even when websocket has transient errors.

---

## 3. Module-Wise Feature Map

## 3.1 Authentication and Security Module

- JWT issuance and refresh rotation.
- Access token claim includes tenant and role context.
- OAuth2 bearer dependency integration.
- Password hashing and verification.
- Tenant-scoped account validation.
- Route-level role guards.
- Candidate ownership checks for answer/code access.
- Tenant middleware pass-through support for public and preflight requests.

## 3.2 Exam Ingestion and Question Module

- Manual, JSON, and PDF ingestion pathways.
- Payload validation and mode-specific error handling.
- Mixed question-type support design.
- Question CRUD support under exam scope.

## 3.3 Attempt and Answer Module

- One-attempt-per-candidate-per-exam enforcement.
- Attempt start/submit state transitions.
- Time-window and duration enforcement.
- Answer persistence model for autosave.
- Submission-time grading pipeline.

## 3.4 Proctoring Module

- Real-time websocket channel per exam attempt.
- Event normalization to canonical violation types.
- Snapshot ingestion via base64 image payload.
- Violation event persistence with severity and detail metadata.
- Event listing, pagination, and counting APIs.
- Violation taxonomy and guideline distribution endpoint.

## 3.5 Code Execution Module

- Judge0 asynchronous submission integration.
- Language metadata retrieval.
- Polling and status mapping from Judge0 status IDs.
- Execution output capture and persistence.
- Ownership-aware retrieval APIs.

## 3.6 Plagiarism Module

- Exam-level code submission collection.
- Tokenization pipeline with Python-aware and generic fallback modes.
- Similarity computation using combined token metrics.
- Pairwise comparison and threshold-based flagging.
- Detailed pair metadata including token counts and method details.
- Stable API serialization path to avoid async ORM lazy-load runtime failures.

## 3.7 Risk Scoring Module

- Event aggregation across attempt timeline.
- Configurable per-violation weights.
- Diminishing returns scoring for repeated events.
- Bounded score normalization to [0, 1].
- Risk level classification (low, medium, high, critical).
- Upserted risk snapshots for repeat computations.

## 3.8 Reporting and Analytics Module

- Tenant-level KPI dashboard.
- Exam-level analytics aggregation.
- Question-level and candidate-level performance analytics.
- Streaming CSV export endpoints with row counts.

## 3.9 Reliability and Operations Module

- Rate limiting for sensitive/high-frequency routes.
- Structured request logging middleware.
- Health + readiness probes (DB, Redis, Judge0 checks).
- Metrics endpoint for Prometheus scraping.
- Container health checks and restart-ready stack orchestration.

---

## 4. Final State Summary

- Core QA defects previously identified have been remediated.
- Plagiarism API serialization path is stabilized for both trigger and report retrieval flows.
- Candidate preflight gating behavior is intentional and security-aligned.
- Mixed exam architecture is preserved as a stronger and more extensible design choice.
- Platform is demo-ready for academic evaluation and technical viva presentation.
