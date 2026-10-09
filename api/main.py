from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import products, family, meals, pantry, plans, shopping, advice, ai, scraper, analytics

app = FastAPI(title="com.ah API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # LAN use only — restrict if exposed to internet
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router)
app.include_router(family.router)
app.include_router(meals.router)
app.include_router(pantry.router)
app.include_router(plans.router)
app.include_router(shopping.router)
app.include_router(advice.router)
app.include_router(ai.router)
app.include_router(scraper.router)
app.include_router(analytics.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
