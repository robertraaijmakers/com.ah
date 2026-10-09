"""Add details_scrape_error to products

Revision ID: 013
Revises: 012
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("products", sa.Column("details_scrape_error", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("products", "details_scrape_error")
