"""Phase D — human recruiter review & decision on exam attempts.

Adds nullable decision columns to ``exam_attempts``:
  - recruiter_decision  String(20)  NULL until first review (rendered PENDING)
  - recruiter_notes     Text        free-form evidence notes
  - reviewed_by         UUID FK users.id ON DELETE SET NULL
  - reviewed_at         timestamptz

The system recommendation stays derived-at-read-time (Phase B service) and is
deliberately NOT persisted as a column: a recruiter decision must never
overwrite it.

Revision ID: 007
Revises: 006
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exam_attempts",
        sa.Column("recruiter_decision", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "exam_attempts",
        sa.Column("recruiter_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "exam_attempts",
        sa.Column(
            "reviewed_by",
            sa.Uuid(),
            nullable=True,
        ),
    )
    op.add_column(
        "exam_attempts",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_exam_attempts_reviewed_by_users",
        "exam_attempts",
        "users",
        ["reviewed_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_exam_attempts_reviewed_by_users", "exam_attempts", type_="foreignkey"
    )
    op.drop_column("exam_attempts", "reviewed_at")
    op.drop_column("exam_attempts", "reviewed_by")
    op.drop_column("exam_attempts", "recruiter_notes")
    op.drop_column("exam_attempts", "recruiter_decision")
