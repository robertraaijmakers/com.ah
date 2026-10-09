from datetime import datetime, date
from decimal import Decimal
from typing import Any
from sqlalchemy import String, Text, Integer, Boolean, Numeric, JSON, ForeignKey, DateTime, Date, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class MealPlan(Base):
    __tablename__ = "meal_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    start_date: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(Integer)
    budget_eur: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    meat_days: Mapped[int | None] = mapped_column(Integer)

    plan_days: Mapped[list["MealPlanDay"]] = relationship(
        back_populates="plan",
        order_by="MealPlanDay.date",
        cascade="all, delete-orphan",
    )
    shopping_lists: Mapped[list["ShoppingList"]] = relationship(back_populates="plan", cascade="all, delete-orphan")


class MealPlanDay(Base):
    __tablename__ = "meal_plan_days"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("meal_plans.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    meal_id: Mapped[int | None] = mapped_column(ForeignKey("meals.id"), nullable=True)
    persons: Mapped[list[int]] = mapped_column(JSON, default=list)  # [family_member_id, ...]
    portions: Mapped[int] = mapped_column(Integer, default=4)
    is_leftovers: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)

    plan: Mapped["MealPlan"] = relationship(back_populates="plan_days")
    meal: Mapped["Meal | None"] = relationship()  # type: ignore[name-defined]


class ShoppingList(Base):
    __tablename__ = "shopping_lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("meal_plans.id"), index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    total_estimated: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))

    plan: Mapped["MealPlan"] = relationship(back_populates="shopping_lists")
    items: Mapped[list["ShoppingListItem"]] = relationship(
        back_populates="shopping_list",
        cascade="all, delete-orphan",
    )


class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    shopping_list_id: Mapped[int] = mapped_column(ForeignKey("shopping_lists.id"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    ingredient_name: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3))
    unit: Mapped[str] = mapped_column(String(30))
    estimated_price: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    from_pantry_quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    is_bonus: Mapped[bool] = mapped_column(Boolean, default=False)
    is_checked: Mapped[bool] = mapped_column(Boolean, default=False)
    reasoning: Mapped[str | None] = mapped_column(Text)

    shopping_list: Mapped["ShoppingList"] = relationship(back_populates="items")
    product: Mapped["Product | None"] = relationship()  # type: ignore[name-defined]
