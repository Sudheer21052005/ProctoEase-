"""Phase 12 — camera verification, snapshots, and exam time window fields.

Revision ID: 006
Revises: 005
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # exams: time window
    op.add_column("exams", sa.Column("start_time", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exams", sa.Column("end_time", sa.DateTime(timezone=True), nullable=True))

    # exam_attempts: verification and computed attempt end time
    op.add_column("exam_attempts", sa.Column("attempt_end_time", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exam_attempts", sa.Column("verification_image_url", sa.Text(), nullable=True))

    # proctoring_events: normalized snapshot URL field
    op.add_column("proctoring_events", sa.Column("snapshot_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("proctoring_events", "snapshot_url")
    op.drop_column("exam_attempts", "verification_image_url")
    op.drop_column("exam_attempts", "attempt_end_time")
    op.drop_column("exams", "end_time")
    op.drop_column("exams", "start_time")
