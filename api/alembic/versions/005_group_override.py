"""Add group_override to products

Revision ID: 005
Revises: 004
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"


def upgrade():
    op.add_column("products", sa.Column("group_override", sa.Boolean(), nullable=False, server_default="false"))


def downgrade():
    op.drop_column("products", "group_override")
