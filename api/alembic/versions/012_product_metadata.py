"""Product metadata: hq_id, gln, shop_type, nutriscore, nix18, availability, active flag

Revision ID: 012
Revises: 011
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("products", sa.Column("hq_id", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("gln", sa.String(20), nullable=True))
    op.add_column("products", sa.Column("shop_type", sa.String(20), nullable=True))
    op.add_column("products", sa.Column("nutriscore_letter", sa.String(1), nullable=True))
    op.add_column("products", sa.Column("nix18", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("products", sa.Column("available_online", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("products", sa.Column("available_in_store", sa.Boolean(), nullable=True))
    op.add_column("products", sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("products", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("products", sa.Column("details_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("products", sa.Column("dietary_flags", sa.JSON(), nullable=True))
    op.create_index("ix_products_is_active", "products", ["is_active"])
    op.create_index("ix_products_hq_id", "products", ["hq_id"])


def downgrade():
    op.drop_index("ix_products_hq_id", table_name="products")
    op.drop_index("ix_products_is_active", table_name="products")
    op.drop_column("products", "dietary_flags")
    op.drop_column("products", "details_scraped_at")
    op.drop_column("products", "last_seen_at")
    op.drop_column("products", "is_active")
    op.drop_column("products", "available_in_store")
    op.drop_column("products", "available_online")
    op.drop_column("products", "nix18")
    op.drop_column("products", "nutriscore_letter")
    op.drop_column("products", "shop_type")
    op.drop_column("products", "gln")
    op.drop_column("products", "hq_id")
