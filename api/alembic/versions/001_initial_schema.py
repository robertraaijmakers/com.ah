"""initial schema

Revision ID: 001
Revises:
Create Date: 2025-01-01 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stores",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("base_url", sa.String(255), nullable=False),
        sa.Column("scraper_class", sa.String(100), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("store_id", sa.Integer, sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("external_id", sa.String(100), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("brand", sa.String(200)),
        sa.Column("category", sa.String(200)),
        sa.Column("sub_category", sa.String(200)),
        sa.Column("image_url", sa.Text),
        sa.Column("barcode", sa.String(50)),
        sa.Column("unit_type", sa.String(20), nullable=False),
        sa.Column("shelf_life_days", sa.Integer),
        sa.UniqueConstraint("store_id", "external_id", name="uq_product_store_external"),
    )
    op.create_index("ix_products_store_id", "products", ["store_id"])
    op.create_index("ix_products_external_id", "products", ["external_id"])

    op.create_table(
        "product_snapshots",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("scraped_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("price", sa.Numeric(8, 2), nullable=False),
        sa.Column("is_bonus", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("bonus_price", sa.Numeric(8, 2)),
        sa.Column("bonus_until", sa.Date),
        sa.Column("price_per_kg", sa.Numeric(10, 4)),
        sa.Column("price_per_litre", sa.Numeric(10, 4)),
        sa.Column("price_per_100g", sa.Numeric(10, 4)),
        sa.Column("price_per_100ml", sa.Numeric(10, 4)),
        sa.Column("price_per_piece", sa.Numeric(10, 4)),
        sa.Column("weight_g", sa.Integer),
        sa.Column("volume_ml", sa.Integer),
        sa.Column("pieces", sa.Integer),
        sa.Column("nutrition", sa.JSON),
    )
    op.create_index("ix_product_snapshots_product_id", "product_snapshots", ["product_id"])
    op.create_index("ix_product_snapshots_scraped_at", "product_snapshots", ["scraped_at"])

    op.create_table(
        "family_members",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("birth_date", sa.Date),
        sa.Column("dietary_restrictions", sa.JSON, nullable=False, server_default="{}"),
    )

    op.create_table(
        "meals",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("source_url", sa.Text),
        sa.Column("portions_default", sa.Integer, nullable=False, server_default="4"),
        sa.Column("prep_minutes", sa.Integer),
        sa.Column("cook_minutes", sa.Integer),
        sa.Column("tags", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("nutrition_score", sa.Integer),
        sa.Column("makes_leftovers", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("estimated_price", sa.Numeric(8, 2)),
    )

    op.create_table(
        "meal_ingredients",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("meal_id", sa.Integer, sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("ingredient_name", sa.String(300), nullable=False),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id")),
        sa.Column("quantity", sa.Numeric(10, 3)),
        sa.Column("unit", sa.String(30)),
        sa.Column("optional", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("substitute_notes", sa.Text),
    )
    op.create_index("ix_meal_ingredients_meal_id", "meal_ingredients", ["meal_id"])

    op.create_table(
        "meal_ratings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("meal_id", sa.Integer, sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("family_member_id", sa.Integer, sa.ForeignKey("family_members.id"), nullable=False),
        sa.Column("rating", sa.Integer, nullable=False),
        sa.Column("cooked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("notes", sa.Text),
    )
    op.create_index("ix_meal_ratings_meal_id", "meal_ratings", ["meal_id"])

    op.create_table(
        "meal_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("meal_id", sa.Integer, sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("cooked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("persons", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("portions", sa.Integer, nullable=False, server_default="4"),
        sa.Column("notes", sa.Text),
    )
    op.create_index("ix_meal_history_meal_id", "meal_history", ["meal_id"])

    op.create_table(
        "pantry_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("unit", sa.String(30), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.Date),
    )
    op.create_index("ix_pantry_items_product_id", "pantry_items", ["product_id"])

    op.create_table(
        "meal_plans",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("days", sa.Integer, nullable=False),
        sa.Column("budget_eur", sa.Numeric(8, 2)),
        sa.Column("meat_days", sa.Integer),
    )

    op.create_table(
        "meal_plan_days",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("plan_id", sa.Integer, sa.ForeignKey("meal_plans.id"), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("meal_id", sa.Integer, sa.ForeignKey("meals.id")),
        sa.Column("persons", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("portions", sa.Integer, nullable=False, server_default="4"),
        sa.Column("is_leftovers", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("notes", sa.Text),
    )
    op.create_index("ix_meal_plan_days_plan_id", "meal_plan_days", ["plan_id"])

    op.create_table(
        "shopping_lists",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("plan_id", sa.Integer, sa.ForeignKey("meal_plans.id"), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("total_estimated", sa.Numeric(8, 2)),
    )
    op.create_index("ix_shopping_lists_plan_id", "shopping_lists", ["plan_id"])

    op.create_table(
        "shopping_list_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("shopping_list_id", sa.Integer, sa.ForeignKey("shopping_lists.id"), nullable=False),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id")),
        sa.Column("ingredient_name", sa.String(300), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("unit", sa.String(30), nullable=False),
        sa.Column("estimated_price", sa.Numeric(8, 2)),
        sa.Column("from_pantry_quantity", sa.Numeric(10, 3), nullable=False, server_default="0"),
        sa.Column("is_bonus", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_checked", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("reasoning", sa.Text),
    )
    op.create_index("ix_shopping_list_items_list_id", "shopping_list_items", ["shopping_list_id"])

    op.create_table(
        "buy_advice",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("advice_type", sa.String(30), nullable=False),
        sa.Column("current_price", sa.Numeric(8, 2), nullable=False),
        sa.Column("avg_price_90d", sa.Numeric(8, 2)),
        sa.Column("savings_pct", sa.Numeric(5, 2)),
        sa.Column("message", sa.Text),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("dismissed", sa.Boolean, nullable=False, server_default="false"),
    )
    op.create_index("ix_buy_advice_product_id", "buy_advice", ["product_id"])

    op.create_table(
        "orders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("store_id", sa.Integer, sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("order_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_price", sa.Numeric(8, 2)),
        sa.Column("raw_json", sa.JSON),
    )
    op.create_index("ix_orders_store_id", "orders", ["store_id"])

    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id")),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("price_paid", sa.Numeric(8, 2)),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])

    # Seed AH store
    op.execute(
        "INSERT INTO stores (name, base_url, scraper_class, active) "
        "VALUES ('Albert Heijn', 'https://api.ah.nl', 'AHScraper', true)"
    )


def downgrade() -> None:
    op.drop_table("buy_advice")
    op.drop_table("shopping_list_items")
    op.drop_table("shopping_lists")
    op.drop_table("meal_plan_days")
    op.drop_table("meal_plans")
    op.drop_table("pantry_items")
    op.drop_table("meal_history")
    op.drop_table("meal_ratings")
    op.drop_table("meal_ingredients")
    op.drop_table("meals")
    op.drop_table("family_members")
    op.drop_table("product_snapshots")
    op.drop_table("products")
    op.drop_table("stores")
