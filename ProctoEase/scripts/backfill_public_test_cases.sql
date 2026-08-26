-- Backfill is_public onto the FIRST test case of every existing code question.
--
-- Why this exists: app/seeder/auto_seed.py skips seeding entirely when any
-- tenant/user row already exists, so the is_public flags added to
-- app/seeder/data_seeder.py never reach an already-populated database. Without
-- this backfill the candidate "Sample Test Cases" panel renders empty and
-- "Run Sample Tests" has nothing to run, which makes a working feature look
-- broken during a demo.
--
-- Safe to run repeatedly: additive and idempotent. jsonb_set only writes the
-- {test_cases,0,is_public} key; nothing is deleted and no other test case is
-- touched, so at least one case per question stays hidden (required so that
-- Submit demonstrates grading against public + hidden cases).
--
-- Run:
--   docker compose exec -T db sh -lc \
--     'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f -' \
--     < scripts/backfill_public_test_cases.sql
--
-- Revert:
--   UPDATE questions
--   SET correct_answer = correct_answer #- '{test_cases,0,is_public}'
--   WHERE question_type = 'code';

BEGIN;

UPDATE questions
SET correct_answer = jsonb_set(
        correct_answer,
        '{test_cases,0,is_public}',
        'true'::jsonb,
        true
    )
WHERE question_type = 'code'
  AND correct_answer ? 'test_cases'
  AND jsonb_typeof(correct_answer -> 'test_cases') = 'array'
  AND jsonb_array_length(correct_answer -> 'test_cases') > 1
  AND COALESCE(correct_answer -> 'test_cases' -> 0 -> 'is_public', 'null'::jsonb)
      IS DISTINCT FROM 'true'::jsonb;

COMMIT;

-- Verification: first_case_public and second_case_hidden should both equal
-- code_questions.
SELECT
    count(*)                                                                       AS code_questions,
    count(*) FILTER (WHERE correct_answer->'test_cases'->0->>'is_public' = 'true')  AS first_case_public,
    count(*) FILTER (WHERE correct_answer->'test_cases'->1->>'is_public' IS NULL)   AS second_case_hidden
FROM questions
WHERE question_type = 'code';
