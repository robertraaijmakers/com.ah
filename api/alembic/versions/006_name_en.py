"""Add name_en to products for bilingual search

Revision ID: 006
Revises: 005
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"


def upgrade():
    op.add_column("products", sa.Column("name_en", sa.String(500), nullable=True))
    op.create_index("ix_products_name_en", "products", ["name_en"])


def downgrade():
    op.drop_index("ix_products_name_en", "products")
    op.drop_column("products", "name_en")
