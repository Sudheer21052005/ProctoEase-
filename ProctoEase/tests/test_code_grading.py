import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import uuid4
from datetime import datetime, timezone

from app.services.answer_service import grade_code_question, _canonicalize_stdout_to_bool, _build_answers_response
from app.models.attempt import ExamAttempt
from app.models.question import Question, QuestionType
from app.models.code_submission import CodeSubmission, SubmissionStatus


@pytest.fixture
def sample_question():
    q = Question(
        id=uuid4(),
        exam_id=uuid4(),
        question_text="Test code question",
        question_type=QuestionType.CODE.value,
        correct_answer={
            "difficulty": "easy",
            "test_cases": [
                {"input": "1", "expected": True},
                {"input": "0", "expected": False},
            ],
        },
        points=10,
        order_index=0,
        is_active=True,
    )
    return q


@pytest.fixture
def sample_attempt():
    a = ExamAttempt(
        id=uuid4(),
        exam_id=uuid4(),
        candidate_id=uuid4(),
        tenant_id=uuid4(),
        status="started",
        is_active=True,
        started_at=datetime.now(timezone.utc),
        answers={},
    )
    return a


@pytest.fixture
def sample_submission(sample_attempt, sample_question):
    sub = CodeSubmission(
        id=uuid4(),
        attempt_id=sample_attempt.id,
        question_id=sample_question.id,
        tenant_id=sample_attempt.tenant_id,
        language_id=71,
        language_name="Python 3",
        source_code="print('true')",
        stdin="",
        status=SubmissionStatus.QUEUED.value,
        judge0_token="token123",
        created_at=datetime.now(timezone.utc),
    )
    return sub


@pytest.mark.asyncio
async def test_canonicalize_stdout_to_bool():
    assert await _canonicalize_stdout_to_bool("true") is True
    assert await _canonicalize_stdout_to_bool("True") is True
    assert await _canonicalize_stdout_to_bool("1") is True
    assert await _canonicalize_stdout_to_bool("yes") is True
    assert await _canonicalize_stdout_to_bool("t") is True
    assert await _canonicalize_stdout_to_bool("false") is False
    assert await _canonicalize_stdout_to_bool("False") is False
    assert await _canonicalize_stdout_to_bool("0") is False
    assert await _canonicalize_stdout_to_bool("no") is False
    assert await _canonicalize_stdout_to_bool("f") is False
    assert await _canonicalize_stdout_to_bool("maybe") is None


@pytest.mark.asyncio
async def test_grade_code_question_all_pass(sample_attempt, sample_question, sample_submission, monkeypatch):
    async def fake_execute(self, stmt):
        class Result:
            def scalars(self):
                class Scalars:
                    def first(self_inner):
                        return sample_submission
                return Scalars()
        return Result()

    # Mock _execute_single_test_case to return correct stdout per stdin
    async def mock_execute(source_code, language_id, stdin):
        if stdin == "1":
            return {"stdout": "true\n", "status": {"id": 3}}
        elif stdin == "0":
            return {"stdout": "false\n", "status": {"id": 3}}
        return {"stdout": "", "status": {"id": 3}}

    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    class MockDB:
        async def execute(self, stmt):
            return await fake_execute(None, stmt)
        async def flush(self):
            pass

    db = MockDB()
    is_correct, points = await grade_code_question(db, sample_attempt, sample_question, sample_attempt.tenant_id)
    assert is_correct is True
    assert points == 10


@pytest.mark.asyncio
async def test_grade_code_question_partial_pass(sample_attempt, sample_question, sample_submission, monkeypatch):
    async def mock_execute(source_code, language_id, stdin):
        # First case pass, second fail
        if stdin == "1":
            return {"stdout": "true\n", "status": {"id": 3}}
        else:
            return {"stdout": "true\n", "status": {"id": 3}}  # wrong expected false
    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    class MockDB:
        async def execute(self, stmt):
            class Result:
                def scalars(self):
                    class Scalars:
                        def first(self_inner):
                            return sample_submission
                    return Scalars()
            return Result()
        async def flush(self):
            pass

    db = MockDB()
    is_correct, points = await grade_code_question(db, sample_attempt, sample_question, sample_attempt.tenant_id)
    assert is_correct is False
    assert points == 5  # proportional 10 * 1/2 =5


@pytest.mark.asyncio
async def test_grade_code_question_compile_error(sample_attempt, sample_question, sample_submission, monkeypatch):
    async def mock_execute(source_code, language_id, stdin):
        return {"stdout": "", "stderr": "compile error", "status": {"id": 6}}  # compilation error
    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    class MockDB:
        async def execute(self, stmt):
            class Result:
                def scalars(self):
                    class Scalars:
                        def first(self_inner):
                            return sample_submission
                    return Scalars()
            return Result()
        async def flush(self):
            pass

    db = MockDB()
    is_correct, points = await grade_code_question(db, sample_attempt, sample_question, sample_attempt.tenant_id)
    assert is_correct is False
    assert points == 0


@pytest.mark.asyncio
async def test_grade_code_question_no_test_cases(sample_attempt, sample_question, monkeypatch):
    sample_question.correct_answer = {"difficulty": "easy", "test_cases": []}
    class MockDB:
        async def execute(self, stmt):
            class Result:
                def scalars(self):
                    class Scalars:
                        def first(self_inner):
                            return None
                    return Scalars()
            return Result()
        async def flush(self):
            pass
    db = MockDB()
    is_correct, points = await grade_code_question(db, sample_attempt, sample_question, sample_attempt.tenant_id)
    assert is_correct is None
    assert points == 0


@pytest.mark.asyncio
async def test_grade_code_question_no_submission(sample_attempt, sample_question, monkeypatch):
    class MockDB:
        async def execute(self, stmt):
            class Result:
                def scalars(self):
                    class Scalars:
                        def first(self_inner):
                            return None
                    return Scalars()
            return Result()
        async def flush(self):
            pass
    db = MockDB()
    is_correct, points = await grade_code_question(db, sample_attempt, sample_question, sample_attempt.tenant_id)
    assert is_correct is None
    assert points == 0


@pytest.mark.asyncio
async def test_grade_code_question_multiple_submissions_uses_latest(sample_attempt, sample_question, monkeypatch):
    old_sub = CodeSubmission(
        id=uuid4(),
        attempt_id=sample_attempt.id,
        question_id=sample_question.id,
        tenant_id=sample_attempt.tenant_id,
        language_id=71,
        language_name="Python 3",
        source_code="print('false')",
        stdin="",
        status=SubmissionStatus.QUEUED.value,
        judge0_token="old",
        created_at=datetime(2024,1,1, tzinfo=timezone.utc),
    )
    new_sub = CodeSubmission(
        id=uuid4(),
        attempt_id=sample_attempt.id,
        question_id=sample_question.id,
        tenant_id=sample_attempt.tenant_id,
        language_id=71,
        language_name="Python 3",
        source_code="print('true')",
        stdin="",
        status=SubmissionStatus.QUEUED.value,
        judge0_token="new",
        created_at=datetime.now(timezone.utc),
    )
    async def mock_execute(source_code, language_id, stdin):
        if stdin == "1":
            return {"stdout": "true\n", "status": {"id": 3}}
        elif stdin == "0":
            return {"stdout": "false\n", "status": {"id": 3}}
        return {"stdout": "", "status": {"id": 3}}
    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    class MockDB:
        async def execute(self, stmt):
            class Result:
                def scalars(self):
                    class Scalars:
                        def first(self_inner):
                            return new_sub
                    return Scalars()
            return Result()
        async def flush(self):
            pass
    db = MockDB()
    is_correct, points = await grade_code_question(db, sample_attempt, sample_question, sample_attempt.tenant_id)
    assert is_correct is True
    assert points == 10


def test_extract_public_cases_only():
    # Simulate the logic used in list_questions for candidates
    test_cases = [
        {"input": "1", "expected": True, "is_public": True},
        {"input": "2", "expected": False},  # no is_public -> hidden
        {"input": "3", "expected": True, "is_public": False},
        {"input": "4", "expected": False, "is_public": True},
    ]
    public_cases = [
        {"input": tc.get("input"), "expected": tc.get("expected")}
        for tc in test_cases if tc.get("is_public")
    ]
    assert len(public_cases) == 2
    assert public_cases[0]["input"] == "1"
    assert public_cases[1]["input"] == "4"
    # Ensure hidden cases not present
    inputs = {tc["input"] for tc in public_cases}
    assert "2" not in inputs
    assert "3" not in inputs


@pytest.mark.asyncio
async def test_build_answers_response_includes_graded_code():
    # Create an attempt with a graded code answer in attempt.answers
    attempt = ExamAttempt(
        id=uuid4(),
        exam_id=uuid4(),
        candidate_id=uuid4(),
        tenant_id=uuid4(),
        status="submitted",
        is_active=True,
        started_at=datetime.now(timezone.utc),
        submitted_at=datetime.now(timezone.utc),
        answers={
            str(uuid4()): {
                "question_id": str(uuid4()),
                "selected_option_ids": None,
                "text_answer": "print('true')",
                "is_correct": True,
                "points_earned": 5,
            }
        },
    )
    # Mock db to return a question list for max_score calculation
    class MockDB:
        async def execute(self, stmt):
            class Result:
                def scalars(self):
                    class Scalars:
                        def all(self_inner):
                            # one question worth 5 points
                            q = Question(
                                id=attempt.answers[list(attempt.answers.keys())[0]]["question_id"],
                                exam_id=attempt.exam_id,
                                question_text="code q",
                                question_type=QuestionType.CODE.value,
                                correct_answer={},
                                points=5,
                                order_index=0,
                                is_active=True,
                            )
                            return [q]
                    return Scalars()
            return Result()
    db = MockDB()
    resp = await _build_answers_response(db, attempt, attempt.tenant_id)
    assert len(resp.answers) == 1
    ans = resp.answers[0]
    assert ans.is_correct is True
    assert ans.points_earned == 5
    assert resp.total_score == 5
    assert resp.max_score == 5


# ---- Run endpoint tests ----

@pytest.mark.asyncio
async def test_run_endpoint_all_pass(monkeypatch):
    from app.core.limiter import limiter
    limiter.enabled = False
    from app.api.v1.code import run_code_public
    from app.models.attempt import ExamAttempt
    from app.models.question import Question, QuestionType
    from uuid import uuid4
    from datetime import datetime, timezone

    attempt_id = uuid4()
    question_id = uuid4()
    tenant_id = uuid4()
    candidate_id = uuid4()

    attempt = ExamAttempt(
        id=attempt_id,
        exam_id=uuid4(),
        candidate_id=candidate_id,
        tenant_id=tenant_id,
        status="started",
        is_active=True,
        started_at=datetime.now(timezone.utc),
        answers={},
    )
    question = Question(
        id=question_id,
        exam_id=attempt.exam_id,
        question_text="code q",
        question_type=QuestionType.CODE.value,
        correct_answer={
            "test_cases": [
                {"input": "1", "expected": True, "is_public": True},
                {"input": "0", "expected": False, "is_public": True},
            ]
        },
        points=10,
        order_index=0,
        is_active=True,
    )

    class MockDB:
        def __init__(self):
            self.flushed = False
        async def execute(self, stmt):
            # Determine which select: first for attempt, second for question
            # We'll inspect statement to decide (simple: check if it's selecting ExamAttempt or Question)
            from sqlalchemy import inspect
            # crude: if 'exam_attempts' in str(stmt):
            if "exam_attempts" in str(stmt).lower():
                class Result:
                    def scalar_one_or_none(self_inner):
                        return attempt
                return Result()
            else:
                class Result:
                    def scalar_one_or_none(self_inner):
                        return question
                return Result()
        async def flush(self):
            self.flushed = True

    db = MockDB()

    # Mock _execute_single_test_case
    async def mock_execute(source_code, language_id, stdin):
        if stdin == "1":
            return {"stdout": "true\n", "status": {"id": 3}}
        elif stdin == "0":
            return {"stdout": "false\n", "status": {"id": 3}}
        return {"stdout": "", "status": {"id": 3}}

    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    # Mock current user
    class MockUser:
        def __init__(self, uid, tid):
            self.id = uid
            self.tenant_id = tid
            self.role = "candidate"

    user = MockUser(candidate_id, tenant_id)

    # Prepare request payload
    from app.schemas.code_submission import CodeRunRequest
    payload = CodeRunRequest(source_code="print('true')", language_id=71, question_id=question_id)

    # Call endpoint function directly
    resp = await run_code_public(request=None, attempt_id=attempt_id, payload=payload, user=user, db=db)

    assert len(resp.cases) == 2
    for case in resp.cases:
        assert case.passed is True
        assert case.actual.strip().lower() in ("true", "false")
    # Ensure no DB flush (no persistence)
    assert db.flushed is False


@pytest.mark.asyncio
async def test_run_endpoint_partial_pass(monkeypatch):
    from app.core.limiter import limiter
    limiter.enabled = False
    from app.api.v1.code import run_code_public
    from app.models.attempt import ExamAttempt
    from app.models.question import Question, QuestionType
    from uuid import uuid4
    from datetime import datetime, timezone

    attempt_id = uuid4()
    question_id = uuid4()
    tenant_id = uuid4()
    candidate_id = uuid4()

    attempt = ExamAttempt(
        id=attempt_id,
        exam_id=uuid4(),
        candidate_id=candidate_id,
        tenant_id=tenant_id,
        status="started",
        is_active=True,
        started_at=datetime.now(timezone.utc),
        answers={},
    )
    question = Question(
        id=question_id,
        exam_id=attempt.exam_id,
        question_text="code q",
        question_type=QuestionType.CODE.value,
        correct_answer={
            "test_cases": [
                {"input": "1", "expected": True, "is_public": True},
                {"input": "0", "expected": False, "is_public": True},
            ]
        },
        points=10,
        order_index=0,
        is_active=True,
    )

    class MockDB:
        def __init__(self):
            self.flushed = False
        async def execute(self, stmt):
            if "exam_attempts" in str(stmt).lower():
                class Result:
                    def scalar_one_or_none(self_inner):
                        return attempt
                return Result()
            else:
                class Result:
                    def scalar_one_or_none(self_inner):
                        return question
                return Result()
        async def flush(self):
            self.flushed = True

    db = MockDB()

    async def mock_execute(source_code, language_id, stdin):
        if stdin == "1":
            return {"stdout": "true\n", "status": {"id": 3}}
        elif stdin == "0":
            return {"stdout": "true\n", "status": {"id": 3}}  # wrong
        return {"stdout": "", "status": {"id": 3}}

    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    class MockUser:
        def __init__(self, uid, tid):
            self.id = uid
            self.tenant_id = tid
            self.role = "candidate"

    user = MockUser(candidate_id, tenant_id)

    from app.schemas.code_submission import CodeRunRequest
    payload = CodeRunRequest(source_code="print('true')", language_id=71, question_id=question_id)

    resp = await run_code_public(request=None, attempt_id=attempt_id, payload=payload, user=user, db=db)

    assert len(resp.cases) == 2
    passed = [c.passed for c in resp.cases]
    assert passed == [True, False]
    assert db.flushed is False


@pytest.mark.asyncio
async def test_run_endpoint_ephemeral_no_submission_no_score_change(monkeypatch):
    from app.core.limiter import limiter
    limiter.enabled = False
    from app.api.v1.code import run_code_public
    from app.models.attempt import ExamAttempt
    from app.models.question import Question, QuestionType
    from uuid import uuid4
    from datetime import datetime, timezone

    attempt_id = uuid4()
    question_id = uuid4()
    tenant_id = uuid4()
    candidate_id = uuid4()

    attempt = ExamAttempt(
        id=attempt_id,
        exam_id=uuid4(),
        candidate_id=candidate_id,
        tenant_id=tenant_id,
        status="started",
        is_active=True,
        started_at=datetime.now(timezone.utc),
        answers={},
    )
    question = Question(
        id=question_id,
        exam_id=attempt.exam_id,
        question_text="code q",
        question_type=QuestionType.CODE.value,
        correct_answer={
            "test_cases": [
                {"input": "1", "expected": True, "is_public": True},
            ]
        },
        points=10,
        order_index=0,
        is_active=True,
    )

    class MockDB:
        def __init__(self):
            self.flushed = False
            self.added = []
        async def execute(self, stmt):
            if "exam_attempts" in str(stmt).lower():
                class Result:
                    def scalar_one_or_none(self_inner):
                        return attempt
                return Result()
            else:
                class Result:
                    def scalar_one_or_none(self_inner):
                        return question
                return Result()
        async def flush(self):
            self.flushed = True
        def add(self, obj):
            self.added.append(obj)

    db = MockDB()

    async def mock_execute(source_code, language_id, stdin):
        return {"stdout": "true\n", "status": {"id": 3}}

    from app.services import code_execution_service
    monkeypatch.setattr(code_execution_service, "_execute_single_test_case", mock_execute)

    class MockUser:
        def __init__(self, uid, tid):
            self.id = uid
            self.tenant_id = tid
            self.role = "candidate"

    user = MockUser(candidate_id, tenant_id)

    from app.schemas.code_submission import CodeRunRequest
    payload = CodeRunRequest(source_code="print('true')", language_id=71, question_id=question_id)

    # Capture original answers
    original_answers = dict(attempt.answers)

    resp = await run_code_public(request=None, attempt_id=attempt_id, payload=payload, user=user, db=db)

    # No CodeSubmission added (run endpoint doesn't use db.add)
    assert not any(isinstance(obj, __import__('app.models.code_submission', fromlist=['CodeSubmission']).CodeSubmission) for obj in db.added)
    # No flush
    assert db.flushed is False
    # Attempt answers unchanged
    assert attempt.answers == original_answers


# ---- Integrity test: candidate question payload ----

@pytest.mark.asyncio
async def test_candidate_question_payload_integrity(monkeypatch):
    from app.core.limiter import limiter
    limiter.enabled = False
    from app.api.v1.questions import list_questions
    from app.models.question import Question, QuestionType
    from app.models.user import User, UserRole
    from uuid import uuid4
    from datetime import datetime, timezone

    exam_id = uuid4()
    tenant_id = uuid4()
    candidate_id = uuid4()

    # Two questions: one code with mixed public/hidden, one non-code
    code_q = Question(
        id=uuid4(),
        exam_id=exam_id,
        question_text="code q",
        question_type=QuestionType.CODE.value,
        correct_answer={
            "test_cases": [
                {"input": "pub1", "expected": True, "is_public": True},
                {"input": "hid1", "expected": False, "is_public": False},
                {"input": "pub2", "expected": True, "is_public": True},
            ]
        },
        points=5,
        order_index=0,
        is_active=True,
        tenant_id=tenant_id,
        created_at=datetime.now(timezone.utc),
    )
    mcq_q = Question(
        id=uuid4(),
        exam_id=exam_id,
        question_text="mcq q",
        question_type=QuestionType.MCQ.value,
        options=[{"label":"A","text":"opt"}],
        correct_answer="A",
        points=2,
        order_index=1,
        is_active=True,
        tenant_id=tenant_id,
        created_at=datetime.now(timezone.utc),
    )

    # Mock question_service.list_questions to return our questions
    import app.services.question_service as qs
    async def mock_list_questions(db, exam_id_arg, tenant_id_arg):
        assert exam_id_arg == exam_id
        assert tenant_id_arg == tenant_id
        return [code_q, mcq_q]
    monkeypatch.setattr(qs, "list_questions", mock_list_questions)

    # Mock current user candidate
    class MockUser:
        def __init__(self):
            self.id = candidate_id
            self.tenant_id = tenant_id
            self.role = UserRole.CANDIDATE
    user = MockUser()

    # Call the real endpoint function
    resp = await list_questions(exam_id=exam_id, user=user, db=None)

    # resp is list of QuestionReadCandidate (pydantic models)
    assert len(resp) == 2
    # Find code question in response
    code_resp = next(q for q in resp if q.question_type == "code")
    mcq_resp = next(q for q in resp if q.question_type == "mcq")

    # Serialize to dict (model_dump)
    code_dump = code_resp.model_dump()
    mcq_dump = mcq_resp.model_dump()

    # No correct_answer key anywhere
    assert "correct_answer" not in code_dump
    assert "correct_answer" not in mcq_dump

    # code question public_test_cases contains exactly two public cases
    assert "public_test_cases" in code_dump
    pub_cases = code_dump["public_test_cases"]
    assert isinstance(pub_cases, list)
    assert len(pub_cases) == 2
    inputs = {c["input"] for c in pub_cases}
    assert inputs == {"pub1", "pub2"}
    # hidden case input must not appear anywhere in dumped payload
    full_dump_str = str(code_dump) + str(mcq_dump)
    assert "hid1" not in full_dump_str

    # non-code question has no populated public_test_cases (should be None or empty)
    assert mcq_dump.get("public_test_cases") in (None, [])