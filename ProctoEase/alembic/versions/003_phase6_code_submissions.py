"""Phase 6 — code_submissions table with RLS.

Revision ID: 003
Revises: 002
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "003"
down_revision = "002b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Code Submissions ──
    op.create_table(
        "code_submissions",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=True),
        sa.Column("language_id", sa.Integer(), nullable=False),
        sa.Column("language_name", sa.String(50), nullable=False),
        sa.Column("source_code", sa.Text(), nullable=False),
        sa.Column("stdin", sa.Text(), nullable=True),
        sa.Column("stdout", sa.Text(), nullable=True),
        sa.Column("stderr", sa.Text(), nullable=True),
        sa.Column("compile_output", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("time_sec", sa.Float(), nullable=True),
        sa.Column("memory_kb", sa.Integer(), nullable=True),
        sa.Column("judge0_token", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attempt_id"], ["exam_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_code_submissions_tenant_id", "code_submissions", ["tenant_id"])
    op.create_index("ix_code_submissions_attempt_id", "code_submissions", ["attempt_id"])
    op.create_index("ix_code_submissions_question_id", "code_submissions", ["question_id"])

    # ── RLS on code_submissions ──
    op.execute("ALTER TABLE code_submissions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE code_submissions FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_code_submissions ON code_submissions
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_code_submissions ON code_submissions")
    op.execute("ALTER TABLE code_submissions DISABLE ROW LEVEL SECURITY")
    op.drop_table("code_submissions")
