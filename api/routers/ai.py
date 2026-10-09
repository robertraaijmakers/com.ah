from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from database import get_db
from models import MealPlan, MealPlanDay, Meal, FamilyMember
from services import ollama

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: str  # user | assistant
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@router.get("/status")
async def ollama_status():
    available = await ollama.is_available()
    return {"available": available, "model": ollama.OLLAMA_MODEL, "url": ollama.OLLAMA_URL}


@router.post("/chat")
async def chat(body: ChatRequest):
    if not await ollama.is_available():
        raise HTTPException(503, "Ollama not available — run: ollama serve")

    async def stream():
        async for chunk in ollama.chat_stream([m.model_dump() for m in body.messages]):
            yield chunk

    return StreamingResponse(stream(), media_type="text/plain")


@router.post("/explain-plan/{plan_id}")
async def explain_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    if not await ollama.is_available():
        raise HTTPException(503, "Ollama not available")

    result = await db.execute(
        select(MealPlan)
        .options(selectinload(MealPlan.plan_days).selectinload(MealPlanDay.meal))
        .where(MealPlan.id == plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found")

    days_text = "\n".join(
        f"- {d.date}: {d.meal.name if d.meal else 'geen maaltijd'}"
        + (" (restjes)" if d.is_leftovers else "")
        for d in plan.plan_days
    )

    prompt = (
        f"Hier is een weekmenu voor {plan.days} dagen, start {plan.start_date}:\n"
        f"{days_text}\n\n"
        "Geef een korte, vriendelijke uitleg waarom dit een goed plan is. "
        "Noem variatie, voeding en eventuele bonus producten."
    )

    async def stream():
        async for chunk in ollama.chat_stream([{"role": "user", "content": prompt}]):
            yield chunk

    return StreamingResponse(stream(), media_type="text/plain")
