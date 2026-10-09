# com.ah — Grocery & Meal Planning System

## Vision

Personal grocery intelligence platform: scrape AH product data, plan meals for your family, optimize shopping with local AI, track nutrition — all running locally in Docker, zero cloud costs.

---

## Decisions Made

| Topic | Decision |
|-------|----------|
| Multi-store | AH-only now; other stores later |
| Auth | Full credentials stored in `secrets/` on machine; fully automatic re-auth |
| Pantry | Yes, minimal-effort (one-click from shopping list; no manual expiry) |
| Recipes | Manual input; rating per family member; one nutrition score per recipe |
| AI | Local Ollama — no cloud cost, no API keys |
| Infra | Docker Compose on M4 Mac Mini; network-accessible on LAN |
| Hardware | **M4 Mac Mini, 24GB RAM** |
| Ollama model | **`qwen2.5:14b`** — fits well (~9GB); `qwen2.5:32b` (~20GB) too tight for 24GB |
| Secrets | Stored in `secrets/` on machine (gitignored, not in container image) |
| Synology DS415+ | Not needed — M4 Mac Mini handles full stack |

---

## Infrastructure: M4 Mac Mini on Local Network

**Docker runtime:** Use [OrbStack](https://orbstack.dev) instead of Docker Desktop — faster on Apple Silicon, lower memory overhead, better networking.

**Local network access:** All services bind to `0.0.0.0`. Access from any device on LAN via Mac's local IP (e.g. `192.168.1.x`):
- Frontend: `http://192.168.1.x:3000`
- API: `http://192.168.1.x:8000`

No reverse proxy needed for personal LAN use. Optionally add Caddy later for hostname + HTTPS (e.g. `comah.local`).

**Always-on:** Set Mac Mini to never sleep (System Settings → Energy → Prevent sleeping). OrbStack starts on login.

**Secrets mount:** `./secrets/` is bind-mounted into the scraper container — credentials never baked into image.

---

## Architecture

```
com.ah/
├── scraper/              # Python — AH API client, scheduled jobs
├── api/                  # Python FastAPI — business logic, AI integration
├── frontend/             # Next.js 15 — UI
├── db/
│   └── migrations/       # Alembic SQL migrations
├── ollama/
│   └── Modelfile         # Ollama model config + system prompt tuning
├── secrets/              # gitignored — AH tokens, any local secrets
├── .env.example
└── docker-compose.yml
```

### Docker Compose Services

```yaml
services:
  db:        # PostgreSQL 16 (port 5432)
  api:       # FastAPI (port 8000)
  frontend:  # Next.js (port 3000)
  scraper:   # Python APScheduler — scrape jobs
```

**Ollama runs natively on macOS** (not in Docker) — critical for Apple Silicon GPU/ANE performance. Containers reach it via `host.docker.internal:11434`.

Setup once: `brew install ollama && ollama serve && ollama pull qwen2.5:14b`

---

## AI Strategy: Hybrid Rule Engine + Local LLM

**Core logic is deterministic (rule engine):**
- Filter meals by dietary restrictions
- Enforce meat-day quota
- Avoid meals cooked in last N days
- Prefer bonus-priced ingredients
- Select cheapest package size per ingredient
- Subtract pantry stock from shopping quantities

**Local LLM (Ollama) adds:**
- Natural language meal plan explanation ("Here's why I picked these meals…")
- Substitution suggestions ("No minced beef? Try lentils for vegetarian week")
- Buy advice narrative ("Eggs are 30% below average, good time to stock up")
- Nutrition commentary per week's plan

This split means the system works even if Ollama is slow or degraded — core planning still runs, LLM is additive.

**Ollama model:** `qwen2.5:14b` on M4 24GB (~9GB model memory). OS + Docker use ~6-8GB, so ~15GB free — plenty of headroom. `qwen2.5:32b` (~20GB) is too tight and not recommended. Config in `.env`: `OLLAMA_MODEL=qwen2.5:14b`.

**Ollama in Docker on Mac:** Run Ollama natively on macOS (not in Docker) for full GPU/ANE access — Docker on Mac can't pass through Apple Neural Engine. The `ollama` service in Docker Compose uses `host.docker.internal:11434` to reach the native Ollama process. Models pulled once, persisted in `~/.ollama/`.

**Ollama integration:** Python `ollama` library, streaming responses to frontend via Server-Sent Events.

---

## Database Schema

```sql
-- Stores
stores (id, name, base_url, scraper_class, active)

-- Products
products (
  id, store_id, external_id, name, brand, category,
  image_url, barcode,
  unit_type  -- 'weight' | 'volume' | 'pieces'
)

-- Product snapshots (price history over time)
product_snapshots (
  id, product_id, scraped_at,
  price,
  is_bonus, bonus_price, bonus_until,
  price_per_kg, price_per_litre,
  price_per_100g, price_per_100ml, price_per_piece,
  weight_g, volume_ml, pieces,
  nutrition_json,   -- {energy_kcal, protein_g, fat_g, carbs_g, fiber_g, salt_g, sugar_g}
  shelf_life_days   -- category default, manual override stored on products table
)

-- Family
family_members (
  id, name, birth_date,
  dietary_restrictions_json  -- {no_nuts: true, vegetarian: true, lactose_free: false, ...}
)

-- Pantry (minimal: product + rough quantity)
pantry_items (
  id, product_id,
  quantity, unit,      -- e.g. 6 "pieces" or 0.5 "kg"
  added_at,
  expires_at           -- nullable, from shelf_life_days if not set manually
)

-- Recipes / Meals
meals (
  id, name, description, source_url,
  portions_default,
  prep_minutes, cook_minutes,
  tags_json,           -- ["vegetarian", "quick", "pasta", "comfort"]
  nutrition_score,     -- 1-5, your subjective "how healthy is this" score
  makes_leftovers      -- bool: next day lunch covered by this meal
)

meal_ingredients (
  id, meal_id,
  ingredient_name,     -- free text: "minced beef"
  product_id,          -- nullable, confirmed product link
  quantity, unit,      -- 400, "g"
  optional,            -- bool
  substitute_notes     -- "or lentils for vegetarian"
)

-- Ratings per family member
meal_ratings (
  id, meal_id, family_member_id,
  rating,      -- 1-5
  cooked_at,
  notes
)

-- Meal Plans
meal_plans (id, name, created_at, start_date, days, budget_eur)
meal_plan_days (
  id, plan_id, date,
  meal_id,
  persons_json,        -- [family_member_id, ...]
  portions,
  is_leftovers         -- true = lunch from previous night's dinner
)

-- Shopping Lists
shopping_lists (id, plan_id, generated_at)
shopping_list_items (
  id, list_id,
  product_id,
  quantity, unit,
  estimated_price,
  from_pantry_quantity,  -- how much we're taking from pantry (reduces buy qty)
  is_bonus,
  reasoning              -- short rule explanation
)

-- Orders (future: AH order history import)
orders (id, store_id, order_date, total_price, raw_json)
order_items (id, order_id, product_id, quantity, price_paid)

-- Buy advice
buy_advice (
  id, product_id,
  advice_type,         -- 'on_sale' | 'frequently_bought' | 'low_stock'
  current_price, avg_price_90d, savings_pct,
  generated_at, expires_at,
  dismissed
)
```

---

## AH Authentication

```
secrets/
  ah_tokens.json    # gitignored
```

```json
{
  "username": "user@example.com",
  "password": "...",
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "2025-01-01T00:00:00Z"
}
```

Flow:
1. Scraper checks `expires_at` before each run
2. If expired → try refresh_token → update tokens file
3. If refresh fails → set `auth_status: "expired"` in DB → UI shows banner
4. UI banner: "AH session expired → [Re-authenticate]" → simple login form → stores new tokens
5. Scraper can also be triggered manually from UI with "Scrape now" button

---

## Pantry — Minimal Effort Design

**Add:** Click "Mark as bought" on shopping list item → auto-adds to pantry with default quantity from product + category shelf-life as expiry.

**Use/remove:** When generating a shopping list, system shows "In pantry: 6 eggs" → deducts from buy list. One-click "Used" to remove from pantry manually if needed.

**No barcode scanning, no daily logging.** Pantry state drifts a bit — that's acceptable. System treats pantry as advisory, not authoritative.

---

## Frontend Pages

1. **Dashboard** — this week's plan overview, expiring pantry items, buy advice cards
2. **Products** — search AH catalog, price history sparklines, nutrition info
3. **Pantry** — current stock, quick-add, expiring items highlighted
4. **Family** — member profiles + dietary restrictions
5. **Meals** — recipe library, add/edit, rating history per member
6. **Plan** — create plan (days, persons, meat days, budget) → Generate → edit day by day
7. **Shopping List** — grouped by store section, pantry deductions shown, mark bought
8. **Advice** — stockpile recommendations, price trends
9. **Settings** — scraper schedule, AH auth status, Ollama model config

---

## API Routers

| Router | Key Endpoints |
|--------|--------------|
| `/products` | `GET /search`, `GET /{id}`, `GET /{id}/history` |
| `/pantry` | `GET /`, `POST /`, `DELETE /{id}`, `POST /consume` |
| `/family` | CRUD + `GET /{id}/nutrition-summary` |
| `/meals` | CRUD + `GET /{id}/ratings`, `POST /{id}/rate` |
| `/plans` | `POST /`, `POST /{id}/generate`, `GET /{id}`, `PATCH /{id}/days/{day}` |
| `/shopping` | `POST /generate/{plan_id}`, `POST /{id}/mark-bought` |
| `/advice` | `GET /`, `POST /{id}/dismiss` |
| `/ai` | `POST /chat` (streaming SSE), `POST /explain-plan` |
| `/scraper` | `POST /trigger`, `GET /status`, `POST /auth` |

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Scraper | Python 3.12 + httpx | AH API client; async |
| API | FastAPI + Pydantic v2 | Fast, typed, SQLAlchemy 2.0 async |
| AI | Ollama native on macOS + `ollama` Python lib | Full Apple Silicon GPU/ANE; Docker can't passthrough ANE |
| DB | PostgreSQL 16 | Price history; no pgvector needed yet |
| Migrations | Alembic | Standard |
| Scheduler | APScheduler (in scraper container) | Simple cron-like |
| Frontend | Next.js 15 + TailwindCSS + shadcn/ui | Fast iteration, nice components |
| Infra | Docker Compose | Local, self-contained |

---

## Build Phases

### Phase 1 — Data Foundation
- Docker Compose setup (db, api, scraper, frontend skeleton)
- AH API client + product scraper
- DB schema + migrations
- Product search UI

### Phase 2 — Family, Meals, Pantry
- Family member CRUD + restrictions
- Recipe library (add, ingredients, tags, nutrition_score)
- Pantry minimal UI
- Rating system per family member

### Phase 3 — Planning + Shopping
- Meal plan creation
- Rule-engine plan generator (restrictions, meat days, variety)
- Shopping list generator (pantry subtraction, bonus preference, package optimization)

### Phase 4 — Local AI Layer
- Ollama service in Docker Compose
- LLM explanations on plan + shopping list
- Buy advice narrative
- Streaming chat interface

### Phase 5 — Learning + Order History
- Meal history → influences next plan (recency, ratings)
- AH order history import
- Buy advice engine (price trend analysis)
- Nutrition tracking per family member

### Phase 6 — Multi-Store (future)
- Second store scraper
- Product matching (pgvector added here)
- Cross-store price comparison

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AH API changes | Scraper isolated; easy to update |
| Ollama too slow on hardware | Rule engine works standalone; LLM is additive |
| Ollama model quality poor | Swap model in config; prompt engineering |
| Pantry state drifts | Advisory only; shopping list shows pantry assumptions explicitly |
| Recipe → product link missing | Works without link (ingredient name only); link confirmed lazily by user |
| Auth token expires mid-scrape | Scraper catches 401 → retries after refresh → marks failed if still 401 |
