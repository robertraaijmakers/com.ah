"""Add product_group_name to products for variant grouping

Revision ID: 004
Revises: 003
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"


def upgrade():
    op.add_column("products", sa.Column("product_group_name", sa.String(500), nullable=True))
    op.create_index("ix_products_product_group_name", "products", ["product_group_name"])


def downgrade():
    op.drop_index("ix_products_product_group_name", "products")
    op.drop_column("products", "product_group_name")
