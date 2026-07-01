# 🛡️ ProctoEase - AI-Powered Multi-Tenant Online Examination & Proctoring Platform

ProctoEase is a production-grade, multi-tenant SaaS online assessment platform designed to conduct secure academic and recruitment evaluations. It integrates mixed-format exams (MCQs + coding challenges), sandboxed code execution, real-time proctoring telemetry over WebSockets, AST-based plagiarism checking, and composite risk scoring into a single unified workspace.

> [!NOTE]
> This project is currently in active development. Features, database schemas, and AI models will continue to evolve.

---

## 🚀 Key Features

### 🏢 Multi-Tenant SaaS Isolation
- **Strict Tenant Context**: Express middleware extracts organization scopes via path slugs or headers to prevent cross-tenant data leakage.
- **Role-Based Access Control (RBAC)**: Distinct workspace dashboards for **Admins**, **Recruiters**, and **Candidates**.

### 📝 Hybrid Exam Engine
- **Mixed Questions**: Supports MCQs, multi-select questions, and full programming challenges in a single unified exam window.
- **Flexible Ingestion**: Ingest exam content manually, via JSON payloads, or by parsing PDF structures.
- **Auto-Grading**: Automatic MCQ grading instantly triggers upon candidate exam submission.

### 👁️‍🗨️ Real-Time Proctoring & Client Security
- **Telemetry Pipe**: Asynchronous WebSocket connection persists exam session telemetry directly from the candidate browser.
- **Client-Side Integrity Guards**:
  - Enforced fullscreen mode with re-entry prompts.
  - Tab switch and focus loss detection.
  - Right-click, context menu, and copy/paste blocking.
  - Developer tools heuristic detection.
  - Inactivity monitoring.
- **Webcam Monitoring**: Captures periodic snapshots and detects face anomalies (no-face, multiple-faces, transition anomalies).

### 💻 Sandboxed Code Execution
- **Judge0 CE Integration**: Offloads untrusted candidate code execution to an isolated worker sandbox.
- **Resource Constraints**: Strict limits configured on execution memory (128 MB), CPU time, and thread count.
- **Detailed Metrics**: Captures compile logs, stdout, stderr, run time, and memory footprint.

### 🔍 Plagiarism & Code Analysis
- **Token-Based Comparisons**: Tokenizes programming submissions (Python AST parsing + generic fallback tokenizer) to compare token-structure similarity.
- **Flagging Rules**: Generatespairwise plagiarism reports listing matching tokens, similarity scores, and flagged candidate pairs.

### 📈 composite Risk Scoring Engine
- **Algorithmic Weighting**: Evaluates different proctoring violation types with custom risk weights.
- **Diminishing Returns**: Prevents scoring over-amplification on repeated minor events (e.g. continuous fast tab switches).
- **Categorization**: Normalizes final attempts to a `[0, 1]` risk score and groups candidates into **Low**, **Medium**, **High**, or **Critical** risk categories.

---

## 📐 System Architecture

```
                    ┌────────────────────────┐
                    │  React SPA Front-End   │
                    │   (Tailwind v4, Vite)  │
                    └───────────┬────────────┘
                                │
                 HTTP REST      │    WebSocket Telemetry
             ┌──────────────────┼─────────────────┐
             ▼                  │                 ▼
┌────────────────────────┐      │       ┌────────────────────────┐
│      FastAPI App       │◄─────┘       │  WebSocket Connection   │
│   (Uvicorn, Asyncio)   │              │     (Proctoring)       │
└────────────┬───────────┘              └───────────┬────────────┘
             │                                      │
     ┌───────┴───────┬──────────────┐               │
     ▼               ▼              ▼               ▼
┌──────────┐   ┌──────────┐   ┌───────────┐   ┌───────────┐
│ PostgreSQL│  │  Redis   │   │  Judge0   │   │  Storage  │
│  (Data)  │   │ (Limits) │   │ (Sandbox) │   │(Snapshots)│
└──────────┘   └──────────┘   └───────────┘   └───────────┘
```

---

## 🛠️ Technology Stack

### Front-End
- **Framework**: React 19 SPA (TypeScript)
- **Styling**: Tailwind CSS v4
- **State**: Zustand (Session & Client Proctoring stores)
- **Data Fetching**: TanStack React Query (Server-backed query caching)
- **Interactions**: Framer Motion
- **Libraries**: Monaco Editor (for coding challenges), TensorFlow.js & MediaPipe (ready for advanced client-side camera inference)

### Back-End
- **Framework**: FastAPI (Fully Asynchronous)
- **Asynchronous ORM**: SQLAlchemy 2.0 (Asyncpg driver)
- **Database**: PostgreSQL 16 (Relational persistence)
- **Fast Middleware Store**: Redis 7 (Rate limiting limits & Judge0 queue backplane)
- **Migrations**: Alembic
- **API Protection**: Slowapi (Redis-backed token-bucket rate limiter)
- **Observability**: Prometheus metrics instrumentor

---

## 📦 Getting Started

### 1) Prerequisites
- **Docker Desktop** installed and active.
- **Docker Compose v2** support.
- **Node.js 18+** (for local frontend development).

### 2) Environment Setup
Create a `.env` file in the `ProctoEase` directory using the provided `.env.example` as a template:

```bash
cd ProctoEase
cp .env.example .env
```

Ensure DB connection strings, Judge0 credentials, and security secret keys are defined.

### 3) Spin Up Backend Services (Docker Compose)
Build and launch all services (App, PostgreSQL, Redis, Judge0 server & worker, Judge0 DB) in background mode:

```bash
docker compose up -d --build
```

### 4) Verify Service Health
Check the application's liveness and readiness endpoints:

```bash
# Verify API is running
curl http://localhost:8000/health

# Verify DB, Redis, and Judge0 connectivity
curl http://localhost:8000/health/ready
```

Access the OpenAPI documentation at: `http://localhost:8000/docs`

### 5) Spin Up Frontend
Navigate to the frontend directory, install npm packages, and launch the Vite development server:

```bash
cd frontend
npm install
npm run dev
```

The app will start on: `http://localhost:5173`

---

## 🔑 Demo Credentials

All test accounts default to the password: `DemoPass@123`.

| Persona | Organization | Email Address |
| :--- | :--- | :--- |
| **Admin** | `techcorp` | `seed-admin.techcorp@demo.com` |
| **Recruiter** | `techcorp` | `aarav.mehta@techcorp.com` |
| **Candidate** | `techcorp` | `ishaan.sharma.10@techcorp.demo` |

### Suggested 3-Minute Evaluation Flow:
1. **Login as Recruiter** (`aarav.mehta@techcorp.com`) → View current exams, preview questions, or inspect attempt metrics.
2. **Logout & Login as Candidate** (`ishaan.sharma.10@techcorp.demo`) → Select an active exam, complete preflight webcam/audio checks, begin the exam, trigger violations (e.g. exit fullscreen, switch tabs), and submit answers.
3. **Login back as Recruiter** → Inspect candidate proctoring logs, compute attempt risk ratings, view execution stats for programming questions, and execute a plagiarism check.

---

## 🗺️ Development Roadmap

ProctoEase is evolving to include the following core enhancements:
- [ ] **Advanced Webcam Inference**: Integrate client-side TensorFlow.js object-detection models (detecting mobile phones, books, or extra faces) directly in the camera viewport.
- [ ] **Offline Attempt Resilience**: LocalStorage buffering of answer states to support candidate recovery on transient offline environments.
- [ ] **Dynamic Webhook Ingestors**: Support for pushing exam scores and risk status directly to LMS integrations (e.g., Canvas, Moodle).
- [ ] **Analytical Charting**: Rich canvas/graph visualizer for question-level difficulty ratios and candidate performance curves.

---
