import os
import json
import requests

BASE_URL = os.getenv("PROCTOEASE_API_BASE", "http://localhost:8000/api/v1")
TENANT_SLUG = os.getenv("PROCTOEASE_TENANT_SLUG", "demo-corp")

USERS = {
    "recruiter": {
        "email": os.getenv("PROCTOEASE_RECRUITER_EMAIL", "recruiter1@demo.com"),
        "password": os.getenv("PROCTOEASE_RECRUITER_PASSWORD", "Recruiter@123"),
    },
    "candidate": {
        "email": os.getenv("PROCTOEASE_CANDIDATE_EMAIL", "candidate11_cheater@demo.com"),
        "password": os.getenv("PROCTOEASE_CANDIDATE_PASSWORD", "Test@123"),
    },
}

REPORT = {
    "base_url": BASE_URL,
    "checks": {},
    "notes": [],
    "errors": [],
}


def login(email: str, password: str) -> str:
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={
            "email": email,
            "password": password,
            "tenant_slug": TENANT_SLUG,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def first_exam_id(token: str) -> str | None:
    resp = requests.get(f"{BASE_URL}/exams", headers=auth_headers(token), timeout=10)
    resp.raise_for_status()
    exams = resp.json()
    return exams[0]["id"] if exams else None


def first_attempt_id_for_exam(token: str, exam_id: str) -> str | None:
    resp = requests.get(
        f"{BASE_URL}/exams/{exam_id}/attempts",
        headers=auth_headers(token),
        timeout=10,
    )
    resp.raise_for_status()
    attempts = resp.json()
    return attempts[0]["id"] if attempts else None


def run() -> int:
    try:
        recruiter_token = login(USERS["recruiter"]["email"], USERS["recruiter"]["password"])
        candidate_token = login(USERS["candidate"]["email"], USERS["candidate"]["password"])

        exam_id = first_exam_id(recruiter_token)
        if not exam_id:
            REPORT["notes"].append("No exams available; cannot run security checks")
            with open("qa_security_report.json", "w", encoding="utf-8") as f:
                json.dump(REPORT, f, indent=2)
            return 1

        attempt_id = first_attempt_id_for_exam(recruiter_token, exam_id)
        if not attempt_id:
            REPORT["notes"].append("No attempts available for first exam; cannot run security checks")
            with open("qa_security_report.json", "w", encoding="utf-8") as f:
                json.dump(REPORT, f, indent=2)
            return 1

        # 1) Candidate must not read another candidate's answers
        answers_resp = requests.get(
            f"{BASE_URL}/attempts/{attempt_id}/answers",
            headers=auth_headers(candidate_token),
            timeout=10,
        )
        REPORT["checks"]["candidate_blocked_from_foreign_answers"] = answers_resp.status_code in (403, 404)

        # 2) Candidate must not read recruiter proctoring count
        count_resp = requests.get(
            f"{BASE_URL}/attempts/{attempt_id}/events/count",
            headers=auth_headers(candidate_token),
            timeout=10,
        )
        REPORT["checks"]["candidate_blocked_from_proctoring_counts"] = count_resp.status_code == 403

        # 3) Candidate must not list recruiter exam attempts
        attempts_resp = requests.get(
            f"{BASE_URL}/exams/{exam_id}/attempts",
            headers=auth_headers(candidate_token),
            timeout=10,
        )
        REPORT["checks"]["candidate_blocked_from_exam_attempts"] = attempts_resp.status_code == 403

        # 4) Recruiter can access these resources
        recruiter_answers = requests.get(
            f"{BASE_URL}/attempts/{attempt_id}/answers",
            headers=auth_headers(recruiter_token),
            timeout=10,
        )
        REPORT["checks"]["recruiter_can_view_answers"] = recruiter_answers.status_code == 200

        recruiter_counts = requests.get(
            f"{BASE_URL}/attempts/{attempt_id}/events/count",
            headers=auth_headers(recruiter_token),
            timeout=10,
        )
        REPORT["checks"]["recruiter_can_view_proctoring_counts"] = recruiter_counts.status_code == 200

    except Exception as exc:
        REPORT["errors"].append(str(exc))

    with open("qa_security_report.json", "w", encoding="utf-8") as f:
        json.dump(REPORT, f, indent=2)

    all_ok = all(REPORT["checks"].values()) if REPORT["checks"] else False
    return 0 if all_ok else 2


if __name__ == "__main__":
    raise SystemExit(run())
