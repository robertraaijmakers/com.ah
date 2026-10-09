from datetime import datetime
from decimal import Decimal
from typing import Any
from sqlalchemy import String, Text, Integer, Boolean, Numeric, JSON, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    category: Mapped[str | None] = mapped_column(String(100), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    portions_default: Mapped[int] = mapped_column(Integer, default=4)
    prep_minutes: Mapped[int | None] = mapped_column(Integer)
    cook_minutes: Mapped[int | None] = mapped_column(Integer)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    nutrition_score: Mapped[int | None] = mapped_column(Integer)  # 1-5 subjective health score
    makes_leftovers: Mapped[bool] = mapped_column(Boolean, default=False)
    estimated_price: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))

    ingredients: Mapped[list["MealIngredient"]] = relationship(back_populates="meal", cascade="all, delete-orphan")
    ratings: Mapped[list["MealRating"]] = relationship(back_populates="meal", cascade="all, delete-orphan")
    history: Mapped[list["MealHistory"]] = relationship(back_populates="meal")


class MealIngredient(Base):
    __tablename__ = "meal_ingredients"

    id: Mapped[int] = mapped_column(primary_key=True)
    meal_id: Mapped[int] = mapped_column(ForeignKey("meals.id"), index=True)
    ingredient_name: Mapped[str] = mapped_column(String(300))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    unit: Mapped[str | None] = mapped_column(String(30))  # g, ml, pieces, tl, el, ...
    optional: Mapped[bool] = mapped_column(Boolean, default=False)
    skip_linking: Mapped[bool] = mapped_column(Boolean, default=False)
    substitute_notes: Mapped[str | None] = mapped_column(Text)

    meal: Mapped["Meal"] = relationship(back_populates="ingredients")
    product: Mapped["Product | None"] = relationship()  # type: ignore[name-defined]


class MealRating(Base):
    __tablename__ = "meal_ratings"

    id: Mapped[int] = mapped_column(primary_key=True)
    meal_id: Mapped[int] = mapped_column(ForeignKey("meals.id"), index=True)
    family_member_id: Mapped[int] = mapped_column(ForeignKey("family_members.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)  # 1-5
    cooked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text)

    meal: Mapped["Meal"] = relationship(back_populates="ratings")
    family_member: Mapped["FamilyMember"] = relationship(back_populates="ratings")  # type: ignore[name-defined]


class MealHistory(Base):
    __tablename__ = "meal_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    meal_id: Mapped[int] = mapped_column(ForeignKey("meals.id"), index=True)
    cooked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    persons: Mapped[list[int]] = mapped_column(JSON, default=list)  # [family_member_id, ...]
    portions: Mapped[int] = mapped_column(Integer, default=4)
    notes: Mapped[str | None] = mapped_column(Text)

    meal: Mapped["Meal"] = relationship(back_populates="history")
