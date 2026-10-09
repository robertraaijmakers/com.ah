from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Text, Numeric, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class BuyAdvice(Base):
    __tablename__ = "buy_advice"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    advice_type: Mapped[str] = mapped_column(String(30))  # on_sale | frequently_bought | low_stock
    current_price: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    avg_price_90d: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    savings_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    message: Mapped[str | None] = mapped_column(Text)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)

    product: Mapped["Product"] = relationship()  # type: ignore[name-defined]
