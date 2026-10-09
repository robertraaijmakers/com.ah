from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from database import get_db
from models import FamilyMember

router = APIRouter(prefix="/family", tags=["family"])

VALID_TYPES = {"member", "regular_guest", "generic_guest"}


class FamilyMemberIn(BaseModel):
    name: str
    birth_date: date | None = None
    dietary_restrictions: dict = {}
    member_type: str = "member"


class FamilyMemberOut(BaseModel):
    id: int
    name: str
    birth_date: date | None
    dietary_restrictions: dict
    member_type: str

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[FamilyMemberOut])
async def list_members(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FamilyMember).order_by(FamilyMember.member_type, FamilyMember.name)
    )
    return result.scalars().all()


@router.post("/", response_model=FamilyMemberOut, status_code=201)
async def create_member(body: FamilyMemberIn, db: AsyncSession = Depends(get_db)):
    if body.member_type not in VALID_TYPES:
        raise HTTPException(400, f"member_type must be one of {sorted(VALID_TYPES)}")
    member = FamilyMember(**body.model_dump())
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.put("/{member_id}", response_model=FamilyMemberOut)
async def update_member(member_id: int, body: FamilyMemberIn, db: AsyncSession = Depends(get_db)):
    member = await db.get(FamilyMember, member_id)
    if not member:
        raise HTTPException(404, "Family member not found")
    if body.member_type not in VALID_TYPES:
        raise HTTPException(400, f"member_type must be one of {sorted(VALID_TYPES)}")
    for k, v in body.model_dump().items():
        setattr(member, k, v)
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{member_id}", status_code=204)
async def delete_member(member_id: int, db: AsyncSession = Depends(get_db)):
    member = await db.get(FamilyMember, member_id)
    if not member:
        raise HTTPException(404, "Family member not found")
    await db.delete(member)
    await db.commit()
