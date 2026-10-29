# Urja Meter Ops — Clean API Gateway & Modern Client

[![Tests](https://img.shields.io/badge/tests-10%20passing-brightgreen)](file:///Users/div/Desktop/urja/test/api.test.js)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-blue)](file:///Users/div/Desktop/urja/openapi.json)
[![Interactive Docs](https://img.shields.io/badge/Swagger%20UI-Live-emerald)](http://localhost:3000/docs)

A resilient, high-performance API gateway and modern operational client built over the legacy **Urja Meter Ops** internal portal (`https://urja-ops.flockenergy.tech`).

This service bridges the gap between the legacy web-only portal and modern data/product teams by providing programmatic REST access to **smart-meter details**, **spatial proximity search**, **grid network hierarchy**, and **live 30-minute interval consumption timeseries**.

---

## 📑 Core Deliverables Quick Links

* 📖 **[PROTOCOL.md](file:///Users/div/Desktop/urja/PROTOCOL.md)**: Reverse-engineered internal portal architecture, Better-Auth cookies, hidden APIs, and the HMAC bulk export discovery.
* ⚡ **[openapi.json](file:///Users/div/Desktop/urja/openapi.json)**: Complete OpenAPI 3.0.3 specification for the clean gateway API.
* 🔍 **[Interactive Swagger UI](http://localhost:3000/docs)**: Browser-based API explorer and testing console served at `/docs`.
* 📊 **[Modern Web Dashboard](http://localhost:3000)**: Interactive visual client featuring meter search, hierarchy tree explorer, geographic map, and consumption charts.
* 🤔 **[REFLECTION.md](file:///Users/div/Desktop/urja/REFLECTION.md)**: Thoughtful answers to the 5 engineering evaluation questions.

---

## 🏗️ Architecture & How It Works

```
                                ┌──────────────────────────────────────────────┐
                                │          Modern Web Client Dashboard         │
                                │  (Meter Explorer, Hierarchy, Map, Telemetry) │
                                └──────────────────────┬───────────────────────┘
                                                       │ REST API
                                ┌──────────────────────▼───────────────────────┐
                                │           Urja API Gateway (Express)         │
                                │                                              │
                                │  • Interactive Swagger UI (/docs)            │
                                │  • OpenAPI Spec (/openapi.json)              │
                                │  • Haversine Spatial Search (/meters/nearby) │
                                │  • Reconstructed Grid Tree (/hierarchy)      │
                                │  • In-Memory Index & TTL Caching Layer       │
                                └──────────────────────┬───────────────────────┘
                                                       │ Auto-Auth & HMAC Export
                                ┌──────────────────────▼───────────────────────┐
                                │         Legacy Urja Meter Ops Portal         │
                                │     (https://urja-ops.flockenergy.tech)      │
                                └──────────────────────────────────────────────┘
```

### Key Capabilities
1. **Live Passthrough & Freshness:** Queries to `/api/v1/meters/:id/readings` fetch real-time 30-minute interval consumption telemetries directly from the legacy portal with automatic session renewal.
2. **Reverse-Engineered HMAC Bulk Sync:** The gateway unlocks the portal's hidden `/portal/export` endpoint using dynamically generated HMAC-SHA256 signatures derived from `/portal/keys`.
3. **Resilience & Outage Protection:** If the legacy portal is slow or down, the gateway falls back gracefully to its in-memory indexed store, guaranteeing 100% uptime for external consumers.
4. **Spatial Proximity Engine:** Computes high-precision Haversine spherical distance queries (`/api/v1/meters/nearby?lat=...&lng=...&radiusKm=5`).
5. **Reconstructed Hierarchy:** Automatically parses flat meter affiliations into a strict utility distribution tree:
   `Zone › Circle › Division › Subdivision › Substation › Feeder › Distribution Transformer (DT) › Meters`.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18+ (v20+ recommended)
* *Optional*: Docker & Docker Compose

### Option A: Run Locally (Fastest — 10 seconds)
```bash
# 1. Clone & enter repository
git clone <repo-url>
cd urja

# 2. Install dependencies (Express, Swagger UI, CORS, Dotenv)
npm install

# 3. Start the API gateway
npm start
```
* API Gateway: **`http://localhost:3000`**
* Interactive Swagger Docs: **`http://localhost:3000/docs`**
* Raw OpenAPI Spec: **`http://localhost:3000/openapi.json`**

### Option B: Run via Docker / Docker Compose
```bash
docker compose up --build
```

### Run Automated Tests
```bash
npm test
```
*Executes 10 automated unit and integration tests using Node's native test runner (`node:test`).*

---

## 📡 Sample Requests & Responses

### 1. System Health & Sync Status
```bash
curl http://localhost:3000/api/v1/health
```
```json
{
  "status": "healthy",
  "timestamp": "2026-10-29T21:30:00.000Z",
  "uptimeSeconds": 45,
  "sync": {
    "status": "ready (live-synced)",
    "lastSyncedAt": "2026-10-29T21:29:15.000Z",
    "lastError": null
  },
  "counts": {
    "meters": 403,
    "transformers": 40,
    "cachedReadings": 2
  }
}
```

### 2. Search & Filter Meters
```bash
# Filter single-phase HPL meters connected to DT-001
curl "http://localhost:3000/api/v1/meters?make=HPL&phase=single&dtCode=DT-001"
```

### 3. Spatial Proximity Search (Nearby Meters)
```bash
# Find all meters within 3 km of Jaipur center
curl "http://localhost:3000/api/v1/meters/nearby?lat=26.9389&lng=75.8309&radiusKm=3"
```

### 4. Live Consumption Readings & Interval Statistics
```bash
curl http://localhost:3000/api/v1/meters/J100000/readings
```
```json
{
  "meterId": "J100000",
  "cached": false,
  "stale": false,
  "retrievedAt": "2026-10-29T21:31:00.000Z",
  "summary": {
    "readingCount": 337,
    "minVoltage": 220,
    "maxVoltage": 240,
    "avgVoltage": 229.8,
    "totalKwhConsumed": 142.05
  },
  "readings": [
    {
      "timestamp": "28/06/2026 22:00",
      "kwh": 48538.93,
      "kvah": 52422.05,
      "voltageR": 228
    }
  ]
}
```

### 5. Reconstructed Network Hierarchy Tree
```bash
curl http://localhost:3000/api/v1/network/hierarchy
```

### 6. Trigger On-Demand Portal Sync
```bash
curl -X POST http://localhost:3000/api/v1/sync
```

---

## 🛠️ Project Structure

```
urja/
├── src/
│   ├── config.js              # Environment & application configuration
│   ├── server.js              # Express app, middleware & Swagger mounting
│   ├── routes/
│   │   ├── meters.js          # /api/v1/meters endpoints (list, details, nearby, readings)
│   │   ├── transformers.js    # /api/v1/transformers endpoints
│   │   ├── network.js         # /api/v1/network/hierarchy tree endpoint
│   │   └── system.js          # /api/v1/health & /api/v1/sync endpoints
│   └── services/
│       ├── portalClient.js    # Reverse-engineered Urja client (auto-login, HMAC export)
│       └── dataStore.js       # In-memory index, spatial math, cache & sync engine
├── public/                    # Modern Web Client (Optional Extension)
│   ├── index.html             # Dashboard UI with tabs & modal
│   ├── style.css              # Custom styling & dark-accent design
│   └── app.js                 # Chart.js & Leaflet map integration
├── test/
│   └── api.test.js            # Automated integration test suite
├── openapi.json               # OpenAPI 3.0.3 specification
├── PROTOCOL.md                # Legacy portal reverse-engineering report
├── REFLECTION.md              # 5 evaluation reflection questions answered
├── Dockerfile                 # Production container image
├── docker-compose.yml         # Container orchestration config
└── package.json
```

---

## ⚖️ Design Decisions & Trade-Offs

1. **In-Memory Store vs External Database:**
   * *Decision:* Used an in-memory index initialized from local seed data and refreshed via live HMAC sync.
   * *Rationale:* The entire dataset consists of 403 meters and 40 transformers (~400 KB). Requiring MongoDB or PostgreSQL would introduce unnecessary deployment friction, slow down local evaluation, and violate the principle of appropriately sized architecture.
2. **Live Telemetry Passthrough vs Full Periodic Ingestion:**
   * *Decision:* Time-series consumption readings (`/energy`) are fetched live on-demand with a 5-minute TTL cache.
   * *Rationale:* Polling all 403 meters for 30-minute interval readings every few minutes would generate ~20,000 requests/day against a fragile legacy portal. Fetching on demand with cache-aside protects upstream resources while ensuring clients receive current data.
3. **Swagger UI Embedded in Gateway:**
   * *Decision:* Mounted `swagger-ui-express` directly at `/docs`.
   * *Rationale:* Engineers can explore and execute live test queries directly from their browser without needing Postman or external tools.

---

## 🚫 What Was Intentionally Skipped

1. **Write / Mutation Endpoints (e.g. `POST /meters`, `PUT /transformers`):**
   * The ground rules explicitly specify: *"Treat the portal as read-only. You don't need to (and shouldn't try to) attack or break it"*.
2. **Heavy Database Infrastructure:**
   * Avoided spinning up MongoDB/PostgreSQL containers, preserving zero-configuration startup.

---

## 🔮 What Would Be Improved With More Time

1. **Timeseries Storage & Long-Term Trends:** Implement TimescaleDB to persist historical readings over months/years for baseline seasonal consumption analysis.
2. **Outbound Rate Limiter:** Implement token-bucket throttling (`p-limit`) on upstream portal requests to prevent thundering-herd issues during peak client loads.
3. **WebSocket Telemetry Stream:** Provide WebSocket subscriptions for field operators monitoring transformer load fluctuations in real time.

---

## 🤔 Reflection
Detailed answers to the 5 evaluation questions are available in **[REFLECTION.md](file:///Users/div/Desktop/urja/REFLECTION.md)**.
