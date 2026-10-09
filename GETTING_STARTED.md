# Getting Started

## Prerequisites

- [OrbStack](https://orbstack.dev) (recommended) or Docker Desktop for Mac
- [Homebrew](https://brew.sh)
- Node.js 22+ (for local frontend dev, optional)

---

## 1. Install Ollama (runs natively on macOS for full M4 performance)

```bash
brew install ollama
ollama serve &            # start in background (or add to Login Items)
ollama pull qwen2.5:14b   # ~9GB download, one-time
```

---

## 2. Configure environment

```bash
cp .env.example .env
# Edit .env — change DB_PASSWORD to something secure
```

---

## 3. Start services

```bash
docker compose up -d
```

Services:
- Frontend: http://localhost:3000 (or http://<mac-ip>:3000 from other devices)
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

The scraper container will automatically run an initial product scrape on first start (when the DB is empty). This takes 10–30 minutes.

---

## 4. Connect your AH account (for order history + authenticated scraping)

1. Go to http://localhost:3000/settings
2. Follow the "Albert Heijn Koppeling" setup steps:
   - Click the AH Login link
   - Log in with your AH account
   - Copy the `appie://login-exit?code=...` URL from your browser's address bar
   - Paste it in the app
3. Tokens are stored in `secrets/ah_tokens.json` and auto-refresh

> **Anonymous scraping** (product catalog + prices) works without login. Authentication is only needed for order history.

---

## 5. First use

1. **Family** → Add your family members with dietary restrictions
2. **Recepten** → Add a few meals with ingredients
3. **Plannen** → Generate a week plan
4. **Boodschappen** → Generate shopping list from the plan
5. Click "Gekocht ✓" on each item → auto-added to pantry

---

## Local network access

All services bind to `0.0.0.0`. Find your Mac's IP:

```bash
ipconfig getifaddr en0   # WiFi
ipconfig getifaddr en1   # Ethernet
```

Access from phone/tablet: `http://192.168.x.x:3000`

---

## Development

```bash
# API (with hot reload)
cd api && pip install -r requirements.txt
DATABASE_URL=postgresql+asyncpg://comah:changeme@localhost:5432/comah uvicorn main:app --reload

# Frontend (with hot reload)
cd frontend && npm install && npm run dev
```

---

## Ollama model

Default `qwen2.5:14b` (~9GB) is the right choice for 24GB RAM. The larger `qwen2.5:32b` (~20GB) is too tight and not recommended.

---

## Scraper schedule (default)

| Job | Schedule | Description |
|-----|----------|-------------|
| Products | Daily 06:00 | Full catalog + prices |
| Bonus | Thursday 08:00 | Weekly bonus items |
| Orders | Monday 07:00 | Order history (requires auth) |

Override in `.env`:
```
PRODUCTS_CRON=0 6 * * *
BONUS_CRON=0 8 * * 4
ORDERS_CRON=0 7 * * 1
```
