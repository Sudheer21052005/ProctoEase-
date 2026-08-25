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