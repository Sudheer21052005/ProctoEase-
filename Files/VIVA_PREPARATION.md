# ProctoEase - Viva Preparation Guide

## 1. 2-Minute Opening Pitch

"ProctoEase is a multi-tenant AI-assisted online exam platform for secure and scalable technical assessments. It supports mixed-format exams (MCQ + coding), real-time proctoring, sandboxed code execution via Judge0, plagiarism analysis using token/AST-style normalization, and risk scoring based on proctoring events. The system is fully containerized and production-oriented with role-based security, health checks, and observability."

---

## 2. What, Why, How (Key Features)

## 2.1 Authentication and Multi-Tenancy

### What

A JWT-based auth layer with tenant-aware identity and role claims.

### Why

Academic and enterprise exam platforms must prevent cross-organization data leakage and enforce strict role boundaries.

### How

- Login accepts email, password, and tenant slug.
- Access token carries user ID, tenant ID, and role.
- Route dependencies enforce RBAC (candidate/recruiter/admin).
- Service-layer tenant filtering and ownership checks prevent unauthorized access.

## 2.2 WebSockets and Real-Time Proctoring

### What

A per-attempt websocket channel streams proctoring events from candidate browser to backend.

### Why

Real-time integrity monitoring is needed for high-stakes exams and cannot rely only on post-facto logs.

### How

- Candidate client opens websocket with token-auth query parameter.
- Client emits structured events (tab switch, fullscreen exit, etc.).
- Backend validates token and stores canonicalized events.
- Backend replies with acknowledgment and running violation count.
- Recruiter APIs expose timelines, counts, and paginated event views.

## 2.3 Plagiarism Detection (AST/Token Normalization)

### What

Exam-level code plagiarism analysis with pairwise similarity scoring and flagged pairs.

### Why

Raw string matching is weak against variable renaming and minor formatting changes.

### How

- All submissions for an exam are collected.
- Code is tokenized with normalization (identifiers/values generalized).
- Pair comparisons generate similarity score and matching token metadata.
- Reports store total pairs, flagged pairs, thresholds, and detailed pair records.
- Final reliability fix: response serialization returns plain dictionaries to avoid async ORM lazy-load runtime errors.

## 2.4 Risk Scoring Engine

### What

A composite score estimating cheating risk per attempt.

### Why

Proctoring events are noisy in isolation; decision support needs a normalized severity metric.

### How

- Events are grouped by type.
- Each type has configurable weight.
- Repeated same-type events use diminishing returns (log scaling).
- Aggregated raw score is normalized to a bounded value in [0,1].
- Final level mapped to low/medium/high/critical.

---

## 3. Expected Examiner Questions and Strong Answers

## 3.1 Architecture and Design

Q: Why did you choose FastAPI + async SQLAlchemy?
A: FastAPI gives high developer productivity with typed contracts and OpenAPI generation. Async SQLAlchemy with asyncpg helps under concurrent API + websocket workloads, especially for proctoring and polling-heavy operations.

Q: Why not monolithic synchronous Django?
A: The project needed native async handling for websocket proctoring and external service polling (Judge0). FastAPI provides simpler async-first composition for this requirement.

Q: Why maintain mixed exams instead of separating MCQ and coding tracks?
A: Mixed exams are more realistic for technical hiring and academia. The schema and API design intentionally support flexible question composition inside one exam, which improves extensibility and user workflow.

## 3.2 Security and Access Control

Q: How do you enforce tenant isolation?
A: Tenant ID is embedded in auth context, queries are tenant-scoped in services, and route guards plus ownership checks prevent cross-tenant or cross-candidate data access.

Q: How is admin self-registration prevented?
A: Registration endpoint allows only candidate/recruiter roles for self-registration. Admin accounts are provisioned through controlled administrative flow.

Q: How do you prevent abuse of sensitive endpoints?
A: Rate limiting is enabled on high-risk paths such as login, attempt creation, and code submission.

## 3.3 Proctoring and AI

Q: Is your face detection truly AI-based?
A: The deployed build uses browser-supported face detection APIs for lightweight real-time checks and event generation. The architecture is adapter-based and ready to plug TensorFlow/MediaPipe for stronger model-driven inference.

Q: What happens if websocket disconnects?
A: Proctoring logic continues locally on the client, and transient websocket errors are treated as non-fatal to preserve exam continuity.

Q: How do you avoid duplicate tab-switch events?
A: The client deduplicates visibilitychange and blur events in a short timing window and derives higher-order patterns (like rapid tab switching) separately.

## 3.4 Plagiarism and Reliability

Q: Explain the MissingGreenlet issue you fixed.
A: In async SQLAlchemy, returning ORM objects with unresolved lazy relationships during FastAPI response serialization can trigger MissingGreenlet. We solved it by explicitly serializing plagiarism report responses to plain dictionaries in both trigger and get-report flows.

Q: Why not keep lazy loading?
A: Lazy loading during response rendering is unsafe in this async context. Explicit serialization guarantees deterministic, non-blocking response construction.

Q: What if there are fewer than two submissions?
A: Report is created as completed with zero pairs, and still returned in the same response schema without runtime relationship access.

## 3.5 Code Execution and Safety

Q: Why use Judge0?
A: Judge0 isolates untrusted candidate code from the core application process and provides standardized execution results across languages.

Q: How do you track execution results?
A: We persist submission metadata and Judge0 token, then poll status and store stdout/stderr/compile output/time/memory in local records.

## 3.6 Reporting and Analytics

Q: What insights can recruiters see?
A: Tenant dashboard KPIs, per-exam analytics, question-level statistics, candidate performance, risk summaries, and CSV exports for audit and presentation.

Q: Why include pagination in analytics endpoints?
A: It keeps responses predictable and scalable for larger datasets while preserving total and page metadata.

---

## 4. Demo Flow for Viva (Recommended)

1. Login as recruiter and open exam workspace.
2. Show exam overview and mixed question structure.
3. Trigger plagiarism report and open detailed results.
4. Show proctoring events and risk computation for attempt.
5. Open reporting dashboard and export CSV.
6. Switch to candidate flow:
   - Preflight checks
   - Verification image capture
   - Begin exam
   - Demonstrate one or two violations
7. Return to recruiter view and show updated analytics.

---

## 5. Technical Deep-Dive Talking Points

- Why async APIs are useful in event-heavy proctoring systems.
- How role guards and ownership checks are applied at endpoint and service layers.
- Why normalized event taxonomies improve risk scoring consistency.
- Why plagiarism detection uses structural tokenization rather than naive string matching.
- How explicit serialization solved async lazy-loading response failures.
- How Dockerized services reduce environment drift during evaluation.

---

## 6. Common Mistakes to Avoid During Viva

- Do not claim full TensorFlow model deployment if current build uses browser face detection; position it as architecture-ready upgrade path.
- Do not describe plagiarism as "AI magic"; explain deterministic token-level comparison pipeline.
- Do not skip security narrative; always mention tenant isolation + RBAC + ownership checks.
- Do not overfocus on UI; emphasize backend integrity and architectural decisions.

---

## 7. One-Line Closing Statement

"ProctoEase demonstrates a complete, secure, and extensible assessment platform where real-time proctoring, coding evaluation, plagiarism detection, and risk analytics work together in a production-oriented architecture."
