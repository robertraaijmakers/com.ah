"""Add external_product_id and match_confidence to order_items

Revision ID: 003
Revises: 002
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade():
    # Raw product ID / EAN from the receipt (for re-matching without re-scraping)
    op.add_column(
        "order_items",
        sa.Column("external_product_id", sa.String(50), nullable=True),
    )
    # How confident is the product_id match: 'exact' | 'fuzzy' | 'none'
    op.add_column(
        "order_items",
        sa.Column("match_confidence", sa.String(10), nullable=False, server_default="none"),
    )
    op.create_index("ix_order_items_external_product_id", "order_items", ["external_product_id"])


def downgrade():
    op.drop_index("ix_order_items_external_product_id", "order_items")
    op.drop_column("order_items", "match_confidence")
    op.drop_column("order_items", "external_product_id")
