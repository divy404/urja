# Urja Meter Ops - API Service

An API service and operations dashboard built over the internal Urja Meter Ops legacy portal (`https://urja-ops.flockenergy.tech`).

This service sits in front of the web-only portal, providing clean programmatic access to smart meters, transformer mappings, grid hierarchy, spatial proximity queries, and live 30-minute interval consumption data.

---

## Deliverables & Documentation

- **PROTOCOL.md**: Technical breakdown of the legacy portal, session auth, internal endpoints, and reverse-engineered HMAC export scheme.
- **openapi.json**: OpenAPI 3.0.3 specification for the service.
- **Interactive Swagger UI**: Interactive API testing console served at `/docs`.
- **Operations Dashboard**: Web UI at `/` with meter search, hierarchy explorer, map, and telemetry graphs.
- **REFLECTION.md**: Answers to the five evaluation reflection questions.

---

## Architecture & System Design

```
                     +---------------------------------------+
                     |       Web Operations Dashboard        |
                     |  (Meter Search, Hierarchy, Map, Charts|
                     +-------------------+-------------------+
                                         | REST
                     +-------------------v-------------------+
                     |       Urja API Gateway (Express)      |
                     |                                       |
                     |  - OpenAPI 3.0 & Swagger UI (/docs)   |
                     |  - Spatial Haversine Search (/nearby) |
                     |  - Grid Hierarchy Builder (/hierarchy)|
                     |  - In-Memory Index & TTL Caching Layer|
                     +-------------------+-------------------+
                                         | Auto Session & HMAC Export
                     +-------------------v-------------------+
                     |      Urja Meter Ops Legacy Portal     |
                     |   (https://urja-ops.flockenergy.tech) |
                     +---------------------------------------+
```

### Key Highlights
- **Live Readings with Cache-Aside**: Requests for meter energy telemetry fetch live 30-minute interval data directly from the legacy portal's `/portal/meters/:id/energy` endpoint. Results are cached with a configurable TTL (5 minutes by default) to prevent unnecessary upstream load.
- **HMAC Bulk Synchronization**: The service reverse-engineers the portal's `/portal/export` endpoint by retrieving keys from `/portal/keys` and generating HMAC-SHA256 signatures, allowing complete synchronizations in a single request.
- **Zero-Config In-Memory Storage**: Given the dataset size (403 meters, 40 transformers, ~400 KB), data is indexed in memory and backed by local seed files. There is no external database setup required to run or test the project.
- **Resilience / Fallback**: If the upstream portal experiences intermittent downtime, the gateway seamlessly serves cached records.

---

## How to Install and Run

### Requirements
- Node.js v18 or higher (v20+ recommended)
- Optional: Docker and Docker Compose

### Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the service
npm start
```

The service will start on `http://localhost:3000`.
- Dashboard: `http://localhost:3000`
- Interactive Swagger UI: `http://localhost:3000/docs`
- Raw OpenAPI Spec: `http://localhost:3000/openapi.json`

### Running with Docker

```bash
docker compose up --build
```

### Running Tests

```bash
npm test
```
Runs 10 automated unit and integration tests using Node's built-in test runner. Tests bind to an ephemeral port to avoid port conflicts with running dev instances.

---

## Sample Requests

### 1. Health and Status
```bash
curl http://localhost:3000/api/v1/health
```

### 2. Search and Filter Meters
```bash
# Find single-phase HPL meters attached to DT-001
curl "http://localhost:3000/api/v1/meters?make=HPL&phase=single&dtCode=DT-001"
```

### 3. Spatial Proximity Query
```bash
# Find meters within 3 km of Jaipur coordinates
curl "http://localhost:3000/api/v1/meters/nearby?lat=26.9389&lng=75.8309&radiusKm=3"
```

### 4. Live Consumption Readings
```bash
curl http://localhost:3000/api/v1/meters/J100000/readings
```
Returns 30-minute interval readings along with computed interval metrics (min/max/average voltage, total kWh consumed).

### 5. Reconstructed Network Hierarchy
```bash
curl http://localhost:3000/api/v1/network/hierarchy
```

### 6. Trigger Live Sync
```bash
curl -X POST http://localhost:3000/api/v1/sync
```

---

## Assumptions

1. **Read-Heavy Workload**: The utility staff and data teams need reliable, quick read access to meter locations, health status, and telemetry. The portal itself is strictly read-only.
2. **Dataset Scale**: With 403 meters and 40 distribution transformers, holding the active records in memory provides sub-millisecond query responses without the operational overhead of managing database containers.
3. **Telemetry Window**: Energy readings operate on 30-minute intervals. A 5-minute cache TTL keeps telemetry fresh while preventing excessive upstream requests.

---

## Design Decisions & Trade-Offs

- **Node.js & Express**: Selected for minimal startup time, lightweight footprint, and straightforward HTTP proxying and crypto utilities.
- **In-Memory Store vs MongoDB / PostgreSQL**: Using an in-memory index loaded from disk seeds and refreshed via HMAC bulk sync keeps the project simple to run and test on any machine.
- **On-Demand Telemetry vs Full Periodic Scrapes**: Instead of continuously polling all 403 meters in the background (which could look like an attack or trigger rate-limiting on the legacy portal), we fetch readings on demand and cache them.
- **Embedded Swagger UI**: Serving Swagger directly at `/docs` allows immediate interactive testing in the browser without importing Postman collections.

---

## What Was Intentionally Skipped

- **Write / Mutation Operations**: The portal has no write functionality for meter provisioning, so write routes (POST/PUT/DELETE for meters) were omitted to reflect the read-only upstream system.
- **Heavy Database Infrastructure**: Kept the architecture lightweight and dependency-free rather than adding Redis or Postgres containers.

---

## What I'd Improve With More Time

- **Time-Series Storage**: Integrate TimescaleDB or ClickHouse for long-term historical storage across months/years if meter count grows into the hundreds of thousands.
- **Outbound Request Throttling**: Add a token-bucket queue for upstream portal requests to avoid bursting the legacy server under sudden high traffic spikes.
- **Alerting Engine**: Add background checks to flag voltage anomalies (outside 215V - 245V) or irregular consumption drops.

---

## Reflection

See **[REFLECTION.md](file:///Users/div/Desktop/urja/REFLECTION.md)** for detailed reflection answers.
