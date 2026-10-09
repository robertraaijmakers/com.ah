"""Add member_type to family_members

Revision ID: 007
Revises: 006
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"


def upgrade():
    op.add_column(
        "family_members",
        sa.Column("member_type", sa.String(20), nullable=False, server_default="member"),
    )


def downgrade():
    op.drop_column("family_members", "member_type")
