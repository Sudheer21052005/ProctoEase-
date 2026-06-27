# ProctoEase Frontend — Final Walkthrough

## All 5 Phases + Mock Data Layer Complete ✅

---

### Phase 1 — Foundation + Auth
Types, Zod schemas, Axios with JWT interceptors, auth store, layout components, public pages.

### Phase 2 — Dashboards + Exam CRUD
Live dashboards, ExamCard, exam create wizard, exam list with search/filter, exam detail page.

### Phase 3 — Exam Taking Flow
Exam store, timer, question navigation, question display (4 types), preflight check, exam screen, completion page.

### Phase 4 — Proctoring Features
Tab switch detection, fullscreen enforcement, keyboard blocking, webcam monitor, violation tracker, auto-submit.

### Phase 5 — Polish
Skeletons, 404 page, ErrorBoundary, SEO meta tags, Google Fonts, favicon, production build.

---

## Mock Data Layer

Enabled via `VITE_MOCK_API=true` in [.env](file:///c:/Users/Dell/OneDrive/Desktop/ProctoEase%20Mini%20Project/ProctoEase/.env). Intercepts all Axios requests and returns realistic dummy data.

### Demo Credentials

| Role | Email | Password |
|:---|:---|:---|
| **Candidate** | `candidate@demo.com` | any |
| **Recruiter** | `recruiter@demo.com` | any |
| **Admin** | `admin@demo.com` | any |

### Demo Data
- **3 users**: Alice Johnson (candidate), Bob Smith (recruiter), Charlie Admin
- **5 exams**: JS Fundamentals, Python DS, SQL, React Advanced, System Design
- **3 attempts**: 1 submitted, 1 in progress, 1 evaluated

### Verified Flows

````carousel
![Candidate dashboard — 4 exams, stats, exam cards with Start/Resume](file:///C:/Users/Dell/.gemini/antigravity/brain/7f2fe85b-b32a-41b4-9541-8f7b24ab2ad5/candidate_dashboard_mock_data_1773900940672.png)
<!-- slide -->
![Recruiter dashboard — 5 total exams, 4 published, 1 draft, exam table](file:///C:/Users/Dell/.gemini/antigravity/brain/7f2fe85b-b32a-41b4-9541-8f7b24ab2ad5/recruiter_dashboard_1773901036391.png)
<!-- slide -->
![Exam list — search, filter, status badges, View links](file:///C:/Users/Dell/.gemini/antigravity/brain/7f2fe85b-b32a-41b4-9541-8f7b24ab2ad5/recruiter_exams_list_1773901047146.png)
<!-- slide -->
![404 page](file:///C:/Users/Dell/.gemini/antigravity/brain/7f2fe85b-b32a-41b4-9541-8f7b24ab2ad5/error_404_page_1773900442222.png)
````

### To disable mock data
Set `VITE_MOCK_API=false` in [.env](file:///c:/Users/Dell/OneDrive/Desktop/ProctoEase%20Mini%20Project/ProctoEase/.env) and restart the dev server to use the real backend.
