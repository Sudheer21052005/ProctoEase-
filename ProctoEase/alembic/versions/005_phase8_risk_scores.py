"""Phase 8 — risk_scores table with RLS.

Revision ID: 005
Revises: 004
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Risk Scores ──
    op.create_table(
        "risk_scores",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("overall_score", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("risk_level", sa.String(20), nullable=False, server_default=sa.text("'low'")),
        sa.Column("breakdown", sa.JSON(), nullable=True),
        sa.Column("event_counts", sa.JSON(), nullable=True),
        sa.Column("total_events", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attempt_id"], ["exam_attempts.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("attempt_id", name="uq_risk_score_attempt"),
    )
    op.create_index("ix_risk_scores_tenant_id", "risk_scores", ["tenant_id"])
    op.create_index("ix_risk_scores_attempt_id", "risk_scores", ["attempt_id"])

    # ── RLS ──
    op.execute("ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE risk_scores FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation_risk_scores ON risk_scores
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_risk_scores ON risk_scores")
    op.execute("ALTER TABLE risk_scores DISABLE ROW LEVEL SECURITY")
    op.drop_table("risk_scores")
