"""
Re-export all models so Alembic can discover them from a single import.
"""

from app.models.base import Base                                          # noqa: F401
from app.models.tenant import Tenant                                      # noqa: F401
from app.models.user import User, UserRole                                # noqa: F401
from app.models.exam import Exam                                          # noqa: F401
from app.models.attempt import ExamAttempt, AttemptStatus                  # noqa: F401
from app.models.proctoring_event import ProctoringEvent, EventType         # noqa: F401
from app.models.question import Question, QuestionType                     # noqa: F401
from app.models.code_submission import CodeSubmission, SubmissionStatus     # noqa: F401
from app.models.plagiarism_report import PlagiarismReport, PlagiarismPair, ReportStatus  # noqa: F401
from app.models.risk_score import RiskScore                                # noqa: F401

