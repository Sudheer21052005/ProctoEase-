# State Architecture (Phase 5)

## Boundaries

### Zustand (global client state)
- Auth/session state only:
  - access token
  - refresh token
  - auth flags (isAuthenticated, isHydrated)
- Active attempt tracking:
  - current examId
  - current attemptId
- Local UI-only state:
  - recruiter grading drafts (non-persistent to backend)
  - candidate in-progress answer draft session state and navigation state

### React Query (server state)
- Current user profile (`me`)
- Exams, questions, attempts, answers, analytics, risk, proctoring, plagiarism, code submissions
- All backend reads/writes and cache invalidation

## Current Stores
- `auth.store.ts`: session tokens + auth hydration
- `attempt.store.ts`: active attempt pointer
- `exam.store.ts`: candidate local exam draft state (answers, visited markers, current index)
- `ui.store.ts`: recruiter grading draft UI state
- `proctoring.store.ts`: candidate proctoring local runtime state

## Migration Rule
1. If state can be fetched from API and should refresh with network events, use React Query.
2. If state must survive route transitions without server fetch, use Zustand.
3. Do not duplicate backend entity records in Zustand if a query already owns them.
4. Keep minimal cross-domain coupling by exposing stores via hooks and actions only.

## Safe Migration Checklist
- Add new store first (no behavior change)
- Read from both old/new where needed for one transition step
- Switch write path to new store
- Remove old duplicated state fields
- Run diagnostics and smoke tests for route guards, dashboards, exam start/resume, and workspace review flows
