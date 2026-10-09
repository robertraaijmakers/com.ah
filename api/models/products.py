from datetime import datetime, date
from decimal import Decimal
from typing import Any
from sqlalchemy import String, Text, Numeric, Boolean, Integer, Date, DateTime, JSON, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base



class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    base_url: Mapped[str] = mapped_column(String(255))
    scraper_class: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    products: Mapped[list["Product"]] = relationship(back_populates="store")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("store_id", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(500))
    brand: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(200))
    sub_category: Mapped[str | None] = mapped_column(String(200))
    image_url: Mapped[str | None] = mapped_column(Text)
    barcode: Mapped[str | None] = mapped_column(String(50))
    unit_type: Mapped[str] = mapped_column(String(20))  # weight | volume | pieces
    shelf_life_days: Mapped[int | None] = mapped_column(Integer)
    product_group_name: Mapped[str | None] = mapped_column(String(500), index=True)
    group_override: Mapped[bool] = mapped_column(Boolean, default=False)
    product_type_group: Mapped[str | None] = mapped_column(String(200), index=True)
    type_group_override: Mapped[bool] = mapped_column(Boolean, default=False)
    name_en: Mapped[str | None] = mapped_column(String(500), index=True)
    bundle_child_external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # AH-specific identifiers
    hq_id: Mapped[int | None] = mapped_column(Integer, index=True)
    gln: Mapped[str | None] = mapped_column(String(20))

    # Channel availability
    shop_type: Mapped[str | None] = mapped_column(String(20))   # AH, AHH, Gall, etc.
    available_online: Mapped[bool] = mapped_column(Boolean, default=True)
    available_in_store: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Product attributes from search
    nutriscore_letter: Mapped[str | None] = mapped_column(String(1))
    nix18: Mapped[bool] = mapped_column(Boolean, default=False)
    dietary_flags: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ingredients: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lifecycle
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details_scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details_scrape_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    store: Mapped["Store"] = relationship(back_populates="products")
    snapshots: Mapped[list["ProductSnapshot"]] = relationship(
        back_populates="product",
        order_by="ProductSnapshot.scraped_at.desc()",
    )

    @property
    def latest_snapshot(self) -> "ProductSnapshot | None":
        return self.snapshots[0] if self.snapshots else None


class ProductSnapshot(Base):
    __tablename__ = "product_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    price: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    is_bonus: Mapped[bool] = mapped_column(Boolean, default=False)
    bonus_price: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    bonus_until: Mapped[date | None] = mapped_column(Date)

    price_per_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    price_per_litre: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    price_per_100g: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    price_per_100ml: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    price_per_piece: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))

    weight_g: Mapped[int | None] = mapped_column(Integer)
    volume_ml: Mapped[int | None] = mapped_column(Integer)
    pieces: Mapped[int | None] = mapped_column(Integer)

    nutrition: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    product: Mapped["Product"] = relationship(back_populates="snapshots")

    @property
    def effective_price(self) -> Decimal:
        return self.bonus_price if self.is_bonus and self.bonus_price else self.price
