"""Add skip_linking to meal_ingredients

Revision ID: 011
Revises: 010
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("meal_ingredients", sa.Column("skip_linking", sa.Boolean(), nullable=False, server_default="false"))


def downgrade():
    op.drop_column("meal_ingredients", "skip_linking")
