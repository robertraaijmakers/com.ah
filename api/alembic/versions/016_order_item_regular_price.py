"""Add regular_price to order_items for bonus savings tracking

Revision ID: 016
Revises: 015
Create Date: 2026-09-07
"""
from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("order_items", sa.Column("regular_price", sa.Numeric(8, 2), nullable=True))


def downgrade():
    op.drop_column("order_items", "regular_price")
