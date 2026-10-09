"""Add order_channel and ingredient_name to orders/order_items

Revision ID: 002
Revises: 001
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade():
    # order_channel: 'in_shop' | 'online' | 'unknown'
    op.add_column(
        "orders",
        sa.Column("order_channel", sa.String(20), nullable=False, server_default="in_shop"),
    )
    # ingredient_name: the raw product name from the receipt (for when product_id can't be matched)
    op.add_column(
        "order_items",
        sa.Column("ingredient_name", sa.String(500), nullable=True),
    )


def downgrade():
    op.drop_column("order_items", "ingredient_name")
    op.drop_column("orders", "order_channel")
