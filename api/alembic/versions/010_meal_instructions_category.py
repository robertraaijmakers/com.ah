"""Add instructions and category to meals

Revision ID: 010
Revises: 009
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meals", sa.Column("instructions", sa.Text(), nullable=True))
    op.add_column("meals", sa.Column("category", sa.String(100), nullable=True))
    op.create_index("ix_meals_category", "meals", ["category"])


def downgrade() -> None:
    op.drop_index("ix_meals_category", "meals")
    op.drop_column("meals", "category")
    op.drop_column("meals", "instructions")
