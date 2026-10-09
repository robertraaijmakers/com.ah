"""Add product_type_group and type_group_override columns

Revision ID: 008
Revises: 007
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("product_type_group", sa.String(200), nullable=True))
    op.add_column("products", sa.Column("type_group_override", sa.Boolean(), nullable=False, server_default="false"))
    op.create_index("ix_products_product_type_group", "products", ["product_type_group"])
    # Backfill from sub_category for existing rows
    op.execute("UPDATE products SET product_type_group = sub_category WHERE product_type_group IS NULL AND sub_category IS NOT NULL")


def downgrade() -> None:
    op.drop_index("ix_products_product_type_group", "products")
    op.drop_column("products", "type_group_override")
    op.drop_column("products", "product_type_group")
