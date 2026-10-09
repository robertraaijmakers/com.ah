from datetime import date
from typing import Any
from sqlalchemy import String, Date, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base

MEMBER_TYPES = ("member", "regular_guest", "generic_guest")


class FamilyMember(Base):
    __tablename__ = "family_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    birth_date: Mapped[date | None] = mapped_column(Date)
    dietary_restrictions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    member_type: Mapped[str] = mapped_column(String(20), default="member")

    ratings: Mapped[list["MealRating"]] = relationship(back_populates="family_member")  # type: ignore[name-defined]
