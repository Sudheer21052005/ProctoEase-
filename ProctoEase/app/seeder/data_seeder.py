"""Production-like relational data seeder for ProctoEase.

Run:
  python -m app.seeder.data_seeder
  python -m app.seeder.data_seeder --reset
"""

from __future__ import annotations

import argparse
import asyncio
import random
import shutil
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.tenant import Tenant
from app.schemas.answer import AnswerSubmit
from app.schemas.exam import ExamCreate, ExamUpdate
from app.schemas.proctoring import ProctoringEventCreate
from app.schemas.question import QuestionCreate
from app.schemas.tenant import TenantCreate
from app.schemas.user import UserRegister
from app.services import (
    answer_service,
    attempt_service,
    exam_service,
    proctoring_service,
    question_service,
    risk_engine,
    tenant_service,
    user_service,
)

SEED_MARKER_EMAIL = "seed-admin"
DEMO_PASSWORD = "DemoPass@123"

PLACEHOLDER_JPEG_DATA_URL = "data:image/jpeg;base64,/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAVEAEBAAAAAAAAAAAAAAAAAAAABP/aAAwDAQACEAMQAAAB1gD/xAAWEAEBAQAAAAAAAAAAAAAAAAABABH/2gAIAQEAAT8Ain//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/2Q=="
SAMPLE_IMAGE_DIR = Path("app/seeder/sample_images")
UPLOADS_SAMPLE_DIR = Path("uploads/proctoring/seeder_samples")

TENANT_BLUEPRINTS = [
    {
        "name": "TechCorp Solutions",
        "slug": "techcorp",
        "recruiters": [
            ("Aarav Mehta", "aarav.mehta@techcorp.com"),
            ("Nisha Kapoor", "nisha.kapoor@techcorp.com"),
        ],
    },
    {
        "name": "InnoSoft Labs",
        "slug": "innosoft",
        "recruiters": [
            ("Rohan Iyer", "rohan.iyer@innosoft.com"),
            ("Priya Shah", "priya.shah@innosoft.com"),
        ],
    },
    {
        "name": "HireFlow Systems",
        "slug": "hireflow",
        "recruiters": [
            ("Kabir Arora", "kabir.arora@hireflow.com"),
        ],
    },
]

EXAM_TEMPLATES = [
    ("Backend Python Assessment", "APIs, async behavior, and data correctness"),
    ("Frontend React Challenge", "State, rendering behavior, and debugging"),
    ("SQL and Data Modeling", "Query design, joins, and indexing"),
    ("Algorithmic Coding Test", "Problem solving under constraints"),
]

FIRST_NAMES = [
    "Aditi", "Rahul", "Neha", "Vikram", "Ananya", "Karan", "Sanya", "Ishaan",
    "Meera", "Arjun", "Ritika", "Dev", "Pooja", "Ravi", "Sneha", "Yash",
    "Tanya", "Manav", "Simran", "Harsh",
]
LAST_NAMES = [
    "Sharma", "Patel", "Reddy", "Khanna", "Verma", "Bose", "Jain", "Nair", "Gupta", "Singh",
]


@dataclass
class SeedSummary:
    tenants_created: int = 0
    users_created: int = 0
    exams_created: int = 0
    attempts_created: int = 0
    violations_generated: int = 0
    snapshots_stored: int = 0


def _log(message: str) -> None:
    print(f"[Seeder] {message}")


def _capture_credential_sample(samples: dict[str, list[str]], role: str, email: str, limit: int = 5) -> None:
    bucket = samples.setdefault(role, [])
    if email not in bucket and len(bucket) < limit:
        bucket.append(email)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _set_tenant_context(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))


def _candidate_email(tenant_slug: str, idx: int, first: str, last: str) -> str:
    return f"{first.lower()}.{last.lower()}.{idx:02d}@{tenant_slug}.demo"


def _question_payloads(exam_title: str) -> list[QuestionCreate]:
    base = [
        QuestionCreate(
            question_text=f"{exam_title}: Which option best reflects production-safe logging?",
            question_type="mcq",
            options=[
                {"label": "A", "text": "Log only stack traces"},
                {"label": "B", "text": "Structured logs with request context"},
                {"label": "C", "text": "Print statements in loops"},
                {"label": "D", "text": "Disable logs in staging"},
            ],
            correct_answer="B",
            points=2,
            order_index=0,
        ),
        QuestionCreate(
            question_text="Which approach minimizes race conditions in async workflows?",
            question_type="mcq",
            options=[
                {"label": "A", "text": "Ignore retries"},
                {"label": "B", "text": "Use idempotency keys and transactions"},
                {"label": "C", "text": "Increase timeout only"},
                {"label": "D", "text": "Disable validation"},
            ],
            correct_answer="B",
            points=2,
            order_index=1,
        ),
        QuestionCreate(
            question_text=(
                "Coding: Implement a function that validates exam time windows. "
                "Your solution reads input from standard input (stdin) and writes the answer (true/false) to standard output (stdout). "
                "Each test case is run separately with its own stdin."
            ),
            question_type="code",
            options=None,
            correct_answer={
                "difficulty": "medium",
                "test_cases": [
                    {"input": "2026-04-10T10:00Z,2026-04-10T12:00Z,2026-04-10T11:00Z", "expected": True},
                    {"input": "2026-04-10T10:00Z,2026-04-10T12:00Z,2026-04-10T13:00Z", "expected": False},
                ],
            },
            points=5,
            order_index=2,
        ),
        QuestionCreate(
            question_text=(
                "Coding: Detect suspicious activity bursts from event timestamps. "
                "Your solution reads input from standard input (stdin) and writes the answer (true/false) to standard output (stdout). "
                "Each test case is run separately with its own stdin."
            ),
            question_type="code",
            options=None,
            correct_answer={
                "difficulty": "hard",
                "test_cases": [
                    {"input": "[1,2,4,7,10,12]", "expected": True},
                    {"input": "[1,20,40]", "expected": False},
                ],
            },
            points=6,
            order_index=3,
        ),
        QuestionCreate(
            question_text="Right-click should generally be blocked in exam mode.",
            question_type="true_false",
            options=[
                {"label": "A", "text": "True"},
                {"label": "B", "text": "False"},
            ],
            correct_answer="A",
            points=1,
            order_index=4,
        ),
        QuestionCreate(
            question_text="Periodic proctoring checkpoints primarily help with timeline continuity.",
            question_type="true_false",
            options=[
                {"label": "A", "text": "True"},
                {"label": "B", "text": "False"},
            ],
            correct_answer="A",
            points=1,
            order_index=5,
        ),
    ]
    return base


def _build_profile_sequence(total_candidates: int) -> list[str]:
    # Controlled distribution: Low 30%, Medium 30%, High 25%, Critical 15%.
    low = int(total_candidates * 0.30)
    medium = int(total_candidates * 0.30)
    high = int(total_candidates * 0.25)
    critical = total_candidates - (low + medium + high)

    profiles: list[str] = (
        ["clean"] * low
        + ["suspicious"] * medium
        + ["high_risk"] * high
        + ["critical"] * critical
    )
    random.shuffle(profiles)
    return profiles


def _profile_events(profile: str) -> list[tuple[str, int]]:
    if profile == "clean":
        return [
            ("periodic_check", 1),
            ("tab_switch", 1),
        ]
    if profile == "suspicious":
        return [
            ("tab_switch", 2),
            ("fullscreen_exit", 1),
            ("keyboard_block", 1),
            ("right_click", 1),
            ("periodic_check", 1),
        ]
    if profile == "high_risk":
        return [
            ("tab_switch", 2),
            ("fullscreen_exit", 2),
            ("inactivity", 1),
            ("copy_paste", 2),
            ("bulk_paste_detected", 2),
            ("rapid_tab_switching", 2),
            ("impossible_answer_speed", 2),
            ("periodic_check", 1),
        ]
    return [
        ("no_face", 3),
        ("multiple_faces", 3),
        ("face_inconsistency", 2),
        ("browser_devtools", 2),
        ("copy_paste", 2),
        ("rapid_tab_switching", 2),
        ("suspicious_activity_burst", 3),
        ("bulk_paste_detected", 2),
        ("impossible_answer_speed", 2),
        ("audio_anomaly", 2),
        ("inactivity", 1),
        ("periodic_check", 1),
    ]


def _prepare_sample_images() -> list[str]:
    if not SAMPLE_IMAGE_DIR.exists():
        return []

    UPLOADS_SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []

    for src in sorted(SAMPLE_IMAGE_DIR.glob("*")):
        if src.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        dst = UPLOADS_SAMPLE_DIR / src.name
        shutil.copyfile(src, dst)
        paths.append(str(dst.as_posix()))

    return paths


async def _get_or_create_tenant(db: AsyncSession, name: str, slug: str, summary: SeedSummary):
    tenant = await tenant_service.get_tenant_by_slug(db, slug)
    if tenant:
        return tenant

    tenant = await tenant_service.create_tenant(db, TenantCreate(name=name, slug=slug))
    summary.tenants_created += 1
    return tenant


async def _get_or_create_user(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    tenant_slug: str,
    *,
    email: str,
    full_name: str,
    role: str,
    summary: SeedSummary,
):
    existing = await user_service.get_user_by_email(db, email, tenant_id)
    if existing:
        return existing

    payload = UserRegister(
        email=email,
        password=DEMO_PASSWORD,
        full_name=full_name,
        role=role,
        tenant_slug=tenant_slug,
    )
    user = await user_service.register_user(db, payload, tenant_id)
    summary.users_created += 1
    return user


async def _seed_exams_and_questions(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    recruiter_id: uuid.UUID,
    summary: SeedSummary,
):
    exams = await exam_service.list_exams(db, tenant_id, published_only=False)
    exam_by_title = {e.title: e for e in exams}

    seeded_exams = []
    for idx, (title, desc) in enumerate(EXAM_TEMPLATES):
        # Mix active and expired windows.
        if idx % 2 == 0:
            start_time = _now() - timedelta(hours=4 + idx)
            end_time = _now() + timedelta(hours=8 + idx)
        else:
            start_time = _now() - timedelta(days=4 + idx)
            end_time = _now() - timedelta(days=2 + idx)

        exam = exam_by_title.get(title)
        if exam is None:
            exam = await exam_service.create_exam(
                db,
                ExamCreate(
                    title=title,
                    description=desc,
                    duration_minutes=60 + idx * 10,
                    start_time=start_time,
                    end_time=end_time,
                    is_published=True,
                ),
                tenant_id,
                recruiter_id,
            )
            summary.exams_created += 1
        else:
            exam = await exam_service.update_exam(
                db,
                exam.id,
                tenant_id,
                ExamUpdate(
                    description=desc,
                    duration_minutes=60 + idx * 10,
                    start_time=start_time,
                    end_time=end_time,
                    is_published=True,
                ),
            )

        existing_questions = await question_service.list_questions(db, exam.id, tenant_id)
        if not existing_questions:
            for q_payload in _question_payloads(title):
                await question_service.create_question(db, exam.id, tenant_id, q_payload)

        seeded_exams.append(exam)

    return seeded_exams


async def _seed_attempts_and_behaviors(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    candidates,
    exams,
    summary: SeedSummary,
    risk_distribution: Counter,
    *,
    no_images: bool,
    sample_image_paths: list[str],
):
    for idx, candidate in enumerate(candidates):
        profile = candidate["profile"]
        user = candidate["user"]

        attempts = await attempt_service.list_my_attempts(db, user.id, tenant_id)
        existing_by_exam = {a.exam_id: a for a in attempts}

        exam_count = 1 if idx % 3 == 0 else 2
        selected_exams = random.sample(exams, k=min(exam_count, len(exams)))

        for ex in selected_exams:
            attempt = existing_by_exam.get(ex.id)
            if attempt is None:
                # Ensure the exam can be started now, then restore intended window after.
                original_start = ex.start_time
                original_end = ex.end_time
                ex.start_time = _now() - timedelta(hours=1)
                ex.end_time = _now() + timedelta(hours=4)

                attempt = await attempt_service.create_attempt(
                    db,
                    ex.id,
                    user.id,
                    tenant_id,
                    verification_image_base64=PLACEHOLDER_JPEG_DATA_URL,
                )
                if sample_image_paths and not no_images:
                    attempt.verification_image_url = random.choice(sample_image_paths)
                summary.attempts_created += 1

                ex.start_time = original_start
                ex.end_time = original_end

            # Time realism in the past 7 days.
            started_at = _now() - timedelta(
                days=random.randint(0, 6),
                hours=random.randint(0, 20),
                minutes=random.randint(0, 59),
            )
            attempt.started_at = started_at
            duration_minutes = max(15, ex.duration_minutes - random.randint(0, 20))
            attempt.attempt_end_time = started_at + timedelta(minutes=duration_minutes)

            questions = await question_service.list_questions(db, ex.id, tenant_id)
            if questions and attempt.status == "started" and (attempt.attempt_end_time is None or _now() <= attempt.attempt_end_time):
                partial_answers = []
                for q in questions[: max(2, len(questions) // 2)]:
                    if q.question_type in {"mcq", "true_false"} and q.options:
                        partial_answers.append(
                            AnswerSubmit(question_id=q.id, selected_option_ids=[q.options[0]["label"]])
                        )
                    elif q.question_type == "code":
                        partial_answers.append(
                            AnswerSubmit(question_id=q.id, text_answer="def solve():\n    return True")
                        )
                if partial_answers:
                    await answer_service.save_answers(db, attempt.id, user.id, tenant_id, partial_answers)

            existing_count = await proctoring_service.count_violations(db, attempt.id, tenant_id)
            if existing_count["total"] == 0:
                event_time = started_at + timedelta(minutes=2)
                for event_type, severity in _profile_events(profile):
                    payload = ProctoringEventCreate(
                        event_type=event_type,
                        severity=severity,
                        timestamp=event_time,
                        detail={
                            "seed_profile": profile,
                            "note": f"Generated {event_type} behavior",
                        },
                        snapshot_base64=(
                            PLACEHOLDER_JPEG_DATA_URL
                            if (not no_images and event_type in {"no_face", "multiple_faces", "periodic_check"})
                            else None
                        ),
                    )
                    event = await proctoring_service.record_event(db, attempt.id, tenant_id, payload)
                    event.created_at = event_time
                    if sample_image_paths and not no_images and event_type in {"no_face", "multiple_faces", "periodic_check"}:
                        sample_path = random.choice(sample_image_paths)
                        event.snapshot_url = sample_path
                        event.snapshot_path = sample_path
                    summary.violations_generated += 1
                    if event.snapshot_url:
                        summary.snapshots_stored += 1
                    event_time += timedelta(seconds=random.randint(15, 90))

            # Attempt outcomes: mix completed / expired / partial.
            if profile in {"clean", "suspicious"} and attempt.status == "started":
                submitted = await attempt_service.submit_attempt(db, attempt.id, user.id, tenant_id)
                submitted.submitted_at = min(submitted.attempt_end_time or _now(), started_at + timedelta(minutes=duration_minutes - 3))
            elif profile == "high_risk":
                if idx % 2 == 0 and attempt.status == "started":
                    attempt.attempt_end_time = _now() - timedelta(minutes=10)
                    submitted = await attempt_service.submit_attempt(db, attempt.id, user.id, tenant_id)
                    submitted.submitted_at = _now() - timedelta(minutes=5)
            else:
                if idx % 2 == 1 and attempt.status == "started":
                    attempt.attempt_end_time = _now() - timedelta(minutes=25)
                    submitted = await attempt_service.submit_attempt(db, attempt.id, user.id, tenant_id)
                    submitted.submitted_at = _now() - timedelta(minutes=20)

            risk = await risk_engine.compute_risk(db, attempt.id, tenant_id)
            risk_distribution[risk.risk_level] += 1


async def _write_credentials_file(lines: list[str]) -> None:
    target = Path("demo_credentials.txt")
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def _reset_demo_data(db: AsyncSession) -> int:
    slugs = [item["slug"] for item in TENANT_BLUEPRINTS]
    result = await db.execute(select(Tenant).where(Tenant.slug.in_(slugs)))
    tenants = list(result.scalars().all())
    if not tenants:
        return 0

    tenant_ids = [t.id for t in tenants]
    # Deleting tenants cascades to tenant-scoped relational data.
    await db.execute(delete(Tenant).where(Tenant.id.in_(tenant_ids)))
    await db.commit()
    return len(tenant_ids)


async def run(reset: bool = False, *, no_images: bool = False, fast: bool = False) -> None:
    random.seed(20260413)
    summary = SeedSummary()
    risk_distribution: Counter = Counter()
    credential_samples: dict[str, list[str]] = {"admin": [], "recruiter": [], "candidate": []}
    sample_image_paths = [] if no_images else _prepare_sample_images()
    tenant_plan = TENANT_BLUEPRINTS[:1] if fast else TENANT_BLUEPRINTS
    candidate_count = 10 if fast else 20

    async with async_session_factory() as db:
        if reset:
            removed = await _reset_demo_data(db)
            print(f"Reset completed. Removed demo tenants: {removed}")

        credentials_lines = [
            "--- PROCTOEASE PRODUCTION-LIKE DEMO CREDENTIALS ---",
            "All seeded users password: DemoPass@123",
            "",
        ]

        _log("Creating tenants...")
        for tenant_cfg in tenant_plan:
            tenant = await _get_or_create_tenant(
                db,
                tenant_cfg["name"],
                tenant_cfg["slug"],
                summary,
            )
            await db.commit()

            await _set_tenant_context(db, tenant.id)

            _log(f"Creating users for tenant={tenant.slug}...")
            admin_email = f"{SEED_MARKER_EMAIL}.{tenant.slug}@demo.com"
            admin_user = await _get_or_create_user(
                db,
                tenant.id,
                tenant.slug,
                email=admin_email,
                full_name=f"{tenant.name} Demo Admin",
                role="admin",
                summary=summary,
            )
            _capture_credential_sample(credential_samples, "admin", admin_user.email)

            recruiters = []
            for full_name, email in tenant_cfg["recruiters"]:
                user = await _get_or_create_user(
                    db,
                    tenant.id,
                    tenant.slug,
                    email=email,
                    full_name=full_name,
                    role="recruiter",
                    summary=summary,
                )
                recruiters.append(user)
                _capture_credential_sample(credential_samples, "recruiter", user.email)

            profiles = _build_profile_sequence(candidate_count)
            candidates = []
            for idx, profile in enumerate(profiles, start=1):
                first = random.choice(FIRST_NAMES)
                last = random.choice(LAST_NAMES)
                email = _candidate_email(tenant.slug, idx, first, last)
                candidate = await _get_or_create_user(
                    db,
                    tenant.id,
                    tenant.slug,
                    email=email,
                    full_name=f"{first} {last}",
                    role="candidate",
                    summary=summary,
                )
                candidates.append({"user": candidate, "profile": profile})
                _capture_credential_sample(credential_samples, "candidate", candidate.email)

            await db.commit()

            _log(f"Creating exams and questions for tenant={tenant.slug}...")
            exams = await _seed_exams_and_questions(
                db,
                tenant.id,
                recruiters[0].id if recruiters else admin_user.id,
                summary,
            )
            await db.commit()

            _log(f"Creating attempts for tenant={tenant.slug}...")
            _log(f"Generating proctoring events for tenant={tenant.slug}...")
            _log(f"Computing risk scores for tenant={tenant.slug}...")
            await _seed_attempts_and_behaviors(
                db,
                tenant.id,
                candidates,
                exams,
                summary,
                risk_distribution,
                no_images=no_images,
                sample_image_paths=sample_image_paths,
            )
            await db.commit()

            credentials_lines.append(f"Tenant: {tenant.name} ({tenant.slug})")
            credentials_lines.append(f"  Admin: {admin_email}")
            for _, rec_email in tenant_cfg["recruiters"]:
                credentials_lines.append(f"  Recruiter: {rec_email}")
            for c in candidates:
                credentials_lines.append(f"  Candidate: {c['user'].email} [{c['profile']}]")
            credentials_lines.append("")

        await _write_credentials_file(credentials_lines)

    print("\nSeeder Summary")
    print(f"tenants created: {summary.tenants_created}")
    print(f"users created: {summary.users_created}")
    print(f"exams created: {summary.exams_created}")
    print(f"attempts created: {summary.attempts_created}")
    print(f"violations generated: {summary.violations_generated}")
    print(f"snapshots stored: {summary.snapshots_stored}")
    print("risk distribution:")
    print(f"  low: {risk_distribution.get('low', 0)}")
    print(f"  medium: {risk_distribution.get('medium', 0)}")
    print(f"  high: {risk_distribution.get('high', 0)}")
    print(f"  critical: {risk_distribution.get('critical', 0)}")

    print("\n[Seeder] Demo Login Credentials:")
    print("Admin:")
    for email in credential_samples.get("admin", [])[:5]:
        print(f"  {email} / {DEMO_PASSWORD}")

    print("Recruiters:")
    for email in credential_samples.get("recruiter", [])[:5]:
        print(f"  {email} / {DEMO_PASSWORD}")

    print("Candidates:")
    for email in credential_samples.get("candidate", [])[:5]:
        print(f"  {email} / {DEMO_PASSWORD}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed realistic ProctoEase demo data")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete existing demo tenants (techcorp/innosoft/hireflow) before seeding",
    )
    parser.add_argument(
        "--no-images",
        action="store_true",
        help="Skip snapshot image generation/assignment for proctoring events",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Seed a minimal demo dataset quickly",
    )
    args = parser.parse_args()
    asyncio.run(run(reset=args.reset, no_images=args.no_images, fast=args.fast))


if __name__ == "__main__":
    main()
