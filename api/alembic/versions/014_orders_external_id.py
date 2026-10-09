"""Add external_id to orders for efficient deduplication

Revision ID: 014
Revises: 013
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("external_id", sa.String(100), nullable=True))
    # Partial unique index: prevents duplicate imports per store, allows NULL
    op.create_index(
        "uq_orders_store_external",
        "orders",
        ["store_id", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_orders_store_external", table_name="orders")
    op.drop_column("orders", "external_id")
