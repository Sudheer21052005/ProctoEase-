"""Phase 5 — questions + proctoring_events tables with RLS.

Revision ID: 002b
Revises: 002
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "002b"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Questions ──
    op.create_table(
        "questions",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("exam_id", sa.Uuid(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_type", sa.String(20), nullable=False, server_default=sa.text("'mcq'")),
        sa.Column("options", postgresql.JSONB(), nullable=True),
        sa.Column("correct_answer", postgresql.JSONB(), nullable=True),
        sa.Column("points", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_questions_tenant_id", "questions", ["tenant_id"])
    op.create_index("ix_questions_exam_id", "questions", ["exam_id"])

    # ── Proctoring Events ──
    op.create_table(
        "proctoring_events",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=True),
        sa.Column("snapshot_path", sa.Text(), nullable=True),
        sa.Column("severity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attempt_id"], ["exam_attempts.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_proctoring_events_tenant_id", "proctoring_events", ["tenant_id"])
    op.create_index("ix_proctoring_events_attempt_id", "proctoring_events", ["attempt_id"])
    op.create_index("ix_proctoring_events_event_type", "proctoring_events", ["event_type"])

    # ── RLS on questions ──
    op.execute("ALTER TABLE questions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE questions FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_questions ON questions
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    # ── RLS on proctoring_events ──
    op.execute("ALTER TABLE proctoring_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE proctoring_events FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_proctoring ON proctoring_events
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_proctoring ON proctoring_events")
    op.execute("ALTER TABLE proctoring_events DISABLE ROW LEVEL SECURITY")
    op.drop_table("proctoring_events")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_questions ON questions")
    op.execute("ALTER TABLE questions DISABLE ROW LEVEL SECURITY")
    op.drop_table("questions")
