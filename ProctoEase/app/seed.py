import asyncio
import os
import uuid
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text

# Import models
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.exam import Exam
from app.models.question import Question, QuestionType
from app.models.attempt import ExamAttempt, AttemptStatus
from app.models.proctoring_event import ProctoringEvent, EventType
from app.models.code_submission import CodeSubmission, SubmissionStatus
from app.models.plagiarism_report import PlagiarismReport, PlagiarismPair, ReportStatus
from app.models.risk_score import RiskScore
from app.core.security import hash_password
from app.core.config import settings

DATABASE_URL = settings.DATABASE_URL
engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def clear_database():
    async with engine.begin() as conn:
        print("wiping old database schema...")
        await conn.run_sync(Base.metadata.drop_all)
        print("creating new database schema...")
        await conn.run_sync(Base.metadata.create_all)

async def seed_data():
    async with async_session() as session:
        # Create Tenant
        tenant = Tenant(name="DemoCorp", slug="demo-corp")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)

        # Create Admin
        admin = User(
            tenant_id=tenant.id,
            email="admin@proctoease.com",
            hashed_password=hash_password("Admin@12345"),
            full_name="Global Admin",
            role=UserRole.ADMIN
        )
        # Create Recruiters
        rec1 = User(
            tenant_id=tenant.id, email="recruiter1@demo.com",
            hashed_password=hash_password("Recruiter@123"), full_name="Recruiter One", role=UserRole.RECRUITER
        )
        rec2 = User(
            tenant_id=tenant.id, email="recruiter2@demo.com",
            hashed_password=hash_password("Recruiter@123"), full_name="Recruiter Two", role=UserRole.RECRUITER
        )
        session.add_all([admin, rec1, rec2])
        await session.commit()
        await session.refresh(admin)
        await session.refresh(rec1)

        # Write credentials file
        cred_text = f"""--- PROCTOEASE DEMO CREDENTIALS ---

Admin:
email: admin@proctoease.com
password: Admin@12345

Recruiters:
email: recruiter1@demo.com
password: Recruiter@123
email: recruiter2@demo.com
password: Recruiter@123

Candidates:
(All candidate passwords are 'Test@123')
"""
        # Create Exams
        exams_data = [
            ("Senior Python Engineer Assessment", "Python basics + edge cases", True),
            ("Frontend React Evaluation", "Hooks, VDOM, bug fixing", True),
            ("Aptitude + Integrity Test", "Logical reasoning", True),
            ("Data Structures & Algorithms Test", "Arrays, Linked Lists, Stack", True),
            ("SQL & Database Assessment", "Joins, Indexing", True),
            ("System Design Basics", "Scalability, LBs", True)
        ]
        
        exams = []
        for t, d, pub in exams_data:
            ex = Exam(tenant_id=tenant.id, title=t, description=d, is_published=pub, created_by=rec1.id)
            session.add(ex)
            exams.append(ex)
        await session.commit()
        
        for ex in exams:
            await session.refresh(ex)

        # Create Questions for Python Exam (Exam 1)
        q_py1 = Question(tenant_id=tenant.id, exam_id=exams[0].id, question_type=QuestionType.MCQ, question_text="Which of the following is mutable?", points=1, options=[{"id":"a","text":"Tuple"},{"id":"b","text":"List"},{"id":"c","text":"String"}], correct_answer={"option_ids": ["b"]})
        q_py2 = Question(tenant_id=tenant.id, exam_id=exams[0].id, question_type=QuestionType.CODE, question_text="Write a python function to reverse a string.", points=5)
        # For React Exam (Exam 2)
        q_re1 = Question(tenant_id=tenant.id, exam_id=exams[1].id, question_type=QuestionType.TRUE_FALSE, question_text="useEffect allows you to perform side effects in functional components.", points=1, options=[{"id":"t","text":"True"},{"id":"f","text":"False"}], correct_answer={"option_ids": ["t"]})
        q_re2 = Question(tenant_id=tenant.id, exam_id=exams[1].id, question_type=QuestionType.CODE, question_text="Fix this buggy useState hook component.", points=5)
        # For Aptitude Exam (Exam 3)
        q_ap1 = Question(tenant_id=tenant.id, exam_id=exams[2].id, question_type=QuestionType.MCQ, question_text="If 2x = 4, what is x?", points=1, options=[{"id":"a","text":"1"},{"id":"b","text":"2"},{"id":"c","text":"4"}], correct_answer={"option_ids": ["b"]})
        # For DSA Exam (Exam 4)
        q_dsa1 = Question(tenant_id=tenant.id, exam_id=exams[3].id, question_type=QuestionType.MCQ, question_text="Which data structure uses LIFO?", points=1, options=[{"id":"a","text":"Queue"},{"id":"b","text":"Stack"},{"id":"c","text":"Tree"}], correct_answer={"option_ids": ["b"]})
        q_dsa2 = Question(tenant_id=tenant.id, exam_id=exams[3].id, question_type=QuestionType.CODE, question_text="Implement a stack push operation.", points=5)
        # For SQL Exam (Exam 5)
        q_sql1 = Question(tenant_id=tenant.id, exam_id=exams[4].id, question_type=QuestionType.MCQ, question_text="Which keyword is used to sort the result-set?", points=1, options=[{"id":"1","text":"ORDER BY"},{"id":"2","text":"SORT BY"},{"id":"3","text":"GROUP BY"}], correct_answer={"option_ids": ["1"]})
        # For System Design (Exam 6)
        q_sd1 = Question(tenant_id=tenant.id, exam_id=exams[5].id, question_type=QuestionType.TRUE_FALSE, question_text="Vertical scaling means adding more servers.", points=1, options=[{"id":"t","text":"True"},{"id":"f","text":"False"}], correct_answer={"option_ids": ["f"]})
        
        session.add_all([q_py1, q_py2, q_re1, q_re2, q_ap1, q_dsa1, q_dsa2, q_sql1, q_sd1])
        await session.commit()

        # Generate 15 Candidates
        personas = ["Honest"]*5 + ["Suspicious"]*4 + ["Cheater"]*3 + ["Weak"]*3
        random.shuffle(personas)
        
        for i in range(15):
            persona = personas[i]
            email = f"candidate{i+1}_{persona.lower()}@demo.com"
            cred_text += f"{email}\n"
            c = User(tenant_id=tenant.id, email=email, hashed_password=hash_password("Test@123"), full_name=f"Candidate {i+1} ({persona})", role=UserRole.CANDIDATE)
            session.add(c)
            await session.commit()
            await session.refresh(c)

            # Assign 2 random exams
            c_exams = random.sample(exams, 2)
            
            for ex in c_exams:
                # Attempt
                started = datetime.now(timezone.utc) - timedelta(minutes=random.randint(10, 60))
                ended = started + timedelta(minutes=random.randint(15, 50))
                attempt = ExamAttempt(tenant_id=tenant.id, exam_id=ex.id, candidate_id=c.id, status=AttemptStatus.EVALUATED, started_at=started, submitted_at=ended)
                session.add(attempt)
                await session.commit()
                await session.refresh(attempt)

                # Generate Proctoring Events & Risk Base
                risk_score = 0.0
                events = []
                
                if persona == "Suspicious":
                    risk_score = 0.4
                    events.append(ProctoringEvent(tenant_id=tenant.id, attempt_id=attempt.id, event_type=EventType.TAB_SWITCH, severity=2, detail={"msg":"Switched tab"}))
                    events.append(ProctoringEvent(tenant_id=tenant.id, attempt_id=attempt.id, event_type=EventType.TAB_SWITCH, severity=2, detail={"msg":"Switched tab"}))
                elif persona == "Cheater":
                    risk_score = 0.95
                    events.append(ProctoringEvent(tenant_id=tenant.id, attempt_id=attempt.id, event_type=EventType.MULTIPLE_FACES, severity=3, detail={"count": 2}))
                    events.append(ProctoringEvent(tenant_id=tenant.id, attempt_id=attempt.id, event_type=EventType.TAB_SWITCH, severity=2, detail={"msg":"Switched tab"}))
                    events.append(ProctoringEvent(tenant_id=tenant.id, attempt_id=attempt.id, event_type=EventType.TAB_SWITCH, severity=2, detail={"msg":"Switched tab"}))
                    events.append(ProctoringEvent(tenant_id=tenant.id, attempt_id=attempt.id, event_type=EventType.NO_FACE, severity=3, detail={"msg":"Looks off screen"}))
                
                if events:
                    session.add_all(events)
                
                # Assign Risk
                risk_level = "low"
                if risk_score >= 0.8: risk_level = "critical"
                elif risk_score >= 0.5: risk_level = "high"
                elif risk_score >= 0.2: risk_level = "medium"
                
                r_score = RiskScore(tenant_id=tenant.id, attempt_id=attempt.id, overall_score=risk_score, risk_level=risk_level, event_counts={"violations": len(events)}, total_events=len(events))
                session.add(r_score)
                await session.commit()

        # Plagiarism Example
        # Grab two cheaters
        cheaters = await session.execute(text("SELECT id FROM users WHERE role='candidate' AND full_name LIKE '%Cheater%' LIMIT 2"))
        cheater_ids = [str(r[0]) for r in cheaters.fetchall()]
        
        if len(cheater_ids) == 2:
            sub1 = CodeSubmission(tenant_id=tenant.id, attempt_id=attempt.id, question_id=q_py2.id, language_id=71, language_name="python", source_code="ZGVmIHJldmVyc2Uocyk6CiAgICByZXR1cm4gclstMTo6MV0=", status=SubmissionStatus.ACCEPTED)
            sub2 = CodeSubmission(tenant_id=tenant.id, attempt_id=attempt.id, question_id=q_py2.id, language_id=71, language_name="python", source_code="ZGVmIHJldmVyc2Vfc3RyaW5nKHN0cik6CiAgICByZXR1cm4gc3RyWy0xOjoxXQ==", status=SubmissionStatus.ACCEPTED)
            session.add_all([sub1, sub2])
            await session.commit()
            
            await session.refresh(sub1)
            await session.refresh(sub2)
            
            plag_rep = PlagiarismReport(tenant_id=tenant.id, exam_id=exams[0].id, status=ReportStatus.COMPLETED, total_pairs=10, flagged_pairs=1, threshold=0.8)
            session.add(plag_rep)
            await session.commit()
            await session.refresh(plag_rep)
            
            plag_pair = PlagiarismPair(tenant_id=tenant.id, report_id=plag_rep.id, submission_a_id=sub1.id, submission_b_id=sub2.id, candidate_a_id=cheater_ids[0], candidate_b_id=cheater_ids[1], similarity_score=0.96, is_flagged=True)
            session.add(plag_pair)
            await session.commit()

        # Write txt
        with open("demo_credentials.txt", "w", encoding="utf-8") as f:
            f.write(cred_text)

async def main():
    await clear_database()
    await seed_data()
    print("Database ready")
    print("Seeding completed")

if __name__ == "__main__":
    asyncio.run(main())
