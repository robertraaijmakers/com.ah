"""Add ingredients column to products

Revision ID: 015
Revises: 014
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("products", sa.Column("ingredients", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("products", "ingredients")
