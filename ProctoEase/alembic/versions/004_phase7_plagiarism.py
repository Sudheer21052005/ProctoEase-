"""Phase 7 — plagiarism_reports + plagiarism_pairs tables with RLS.

Revision ID: 004
Revises: 003
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Plagiarism Reports ──
    op.create_table(
        "plagiarism_reports",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("exam_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("total_pairs", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("flagged_pairs", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("threshold", sa.Float(), nullable=False, server_default=sa.text("0.8")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_plagiarism_reports_tenant_id", "plagiarism_reports", ["tenant_id"])
    op.create_index("ix_plagiarism_reports_exam_id", "plagiarism_reports", ["exam_id"])

    # ── Plagiarism Pairs ──
    op.create_table(
        "plagiarism_pairs",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("report_id", sa.Uuid(), nullable=False),
        sa.Column("submission_a_id", sa.Uuid(), nullable=False),
        sa.Column("submission_b_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_a_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_b_id", sa.Uuid(), nullable=False),
        sa.Column("similarity_score", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("is_flagged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("matching_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens_a", sa.Integer(), nullable=True),
        sa.Column("total_tokens_b", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_id"], ["plagiarism_reports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["submission_a_id"], ["code_submissions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["submission_b_id"], ["code_submissions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_a_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["candidate_b_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_plagiarism_pairs_tenant_id", "plagiarism_pairs", ["tenant_id"])
    op.create_index("ix_plagiarism_pairs_report_id", "plagiarism_pairs", ["report_id"])

    # ── RLS ──
    op.execute("ALTER TABLE plagiarism_reports ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE plagiarism_reports FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_plag_reports ON plagiarism_reports
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    op.execute("ALTER TABLE plagiarism_pairs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE plagiarism_pairs FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_plag_pairs ON plagiarism_pairs
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_plag_pairs ON plagiarism_pairs")
    op.execute("ALTER TABLE plagiarism_pairs DISABLE ROW LEVEL SECURITY")
    op.drop_table("plagiarism_pairs")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_plag_reports ON plagiarism_reports")
    op.execute("ALTER TABLE plagiarism_reports DISABLE ROW LEVEL SECURITY")
    op.drop_table("plagiarism_reports")
