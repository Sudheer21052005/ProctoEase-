"""Phase 3 — exams + exam_attempts tables with RLS.

Revision ID: 002
Revises: 001
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "002"
down_revision = "001_phase1_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Exams ──
    op.create_table(
        "exams",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default=sa.text("60")),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_exams_tenant_id", "exams", ["tenant_id"])
    op.create_index("ix_exams_created_by", "exams", ["created_by"])

    # ── Exam Attempts ──
    op.create_table(
        "exam_attempts",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("exam_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'started'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("answers", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_exam_attempts_tenant_id", "exam_attempts", ["tenant_id"])
    op.create_index("ix_exam_attempts_exam_id", "exam_attempts", ["exam_id"])
    op.create_index("ix_exam_attempts_candidate_id", "exam_attempts", ["candidate_id"])

    # ── RLS on exams ──
    op.execute("ALTER TABLE exams ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE exams FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_exams ON exams
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    # ── RLS on exam_attempts ──
    op.execute("ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE exam_attempts FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_attempts ON exam_attempts
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_attempts ON exam_attempts")
    op.execute("ALTER TABLE exam_attempts DISABLE ROW LEVEL SECURITY")
    op.drop_table("exam_attempts")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_exams ON exams")
    op.execute("ALTER TABLE exams DISABLE ROW LEVEL SECURITY")
    op.drop_table("exams")
