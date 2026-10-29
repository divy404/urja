# Urja Meter Ops — Legacy Portal Protocol & Architecture (`PROTOCOL.md`)

This document details the internal architecture, security mechanisms, API routes, data structures, and idiosyncrasies of the legacy **Urja Meter Ops** portal (`https://urja-ops.flockenergy.tech`), as reverse-engineered during exploration.

---

## 1. System Overview & Technology Stack

The legacy portal is built as a **SvelteKit** server-side rendered application with client-side hydration:
* **Frontend Framework:** SvelteKit (Vite bundle with code-split chunks under `/_app/immutable/`).
* **Authentication Library:** [Better-Auth](https://www.better-auth.com/) session layer storing HTTP-only, secure lax cookies (`__Secure-better-auth.session_token`).
* **Host Infrastructure:** Hosted behind an Azure/Cloud proxy (`40.81.245.103:443`) running HTTP/2 with strict CSRF protection.

---

## 2. Authentication & Session Protocol

### Login Flow
* **Endpoint:** `POST /login`
* **Content-Type:** `application/x-www-form-urlencoded`
* **Payload:** `email=operator@urja.local&password=urja-ops-2026`
* **Mandatory Headers:**
  * `Origin: https://urja-ops.flockenergy.tech`
  * `Referer: https://urja-ops.flockenergy.tech/login`
  * `x-sveltekit-action: true`
* **Security Behavior:**
  * If the `Origin` or `Referer` header is missing, the server responds with:
    `HTTP 403 Forbidden: Cross-site POST form submissions are forbidden`.
  * On valid credentials, the server returns `HTTP 200` with JSON:
    ```json
    { "type": "redirect", "status": 303, "location": "/meters" }
    ```
  * Sets cookie: `__Secure-better-auth.session_token=<token>; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`.
* **Session Lifetime:** 3600 seconds (1 hour). Clients must either refresh their session or re-authenticate proactively after ~50 minutes.

---

## 3. Discovered Internal Endpoints & Data Model

While the portal appears to be a traditional web application to human users, inspecting network traffic and JavaScript bundles (`nodes/4.*.js`, `nodes/6.*.js`) uncovers several internal JSON endpoints:

### A. Paginated Meters Search
* **Endpoint:** `GET /portal/meters/search?q={query}&page={page}`
* **Headers:** Cookie session token required.
* **Response:**
  ```json
  {
    "total": 403,
    "data": [
      {
        "meterId": "J100000",
        "serialNo": "SE33962",
        "make": "HPL",
        "phaseType": "single",
        "installStatus": "Decommissioned",
        "dtCode": "DT-001"
      }
    ]
  }
  ```

### B. Distribution Transformers (DTs)
* **Endpoint:** `GET /portal/dts?page={page}`
* **Response:** Returns paginated list of distribution transformers with `code`, `name`, `feederCode`, and `capacityKva`.

### C. Live Meter Telemetry: Geographic Coordinates
* **Endpoint:** `GET /portal/meters/{meterId}/geo`
* **Response:**
  ```json
  {
    "data": {
      "latitude": "26.938961002479868",
      "longitude": "75.83095696146852"
    }
  }
  ```

### D. Live Meter Telemetry: 30-Minute Consumption Timeseries
* **Endpoint:** `GET /portal/meters/{meterId}/energy`
* **Response:**
  ```json
  {
    "data": [
      {
        "timestamp": "28/06/2026 22:00",
        "kwh": "48538.93",
        "kvah": "52422.05",
        "voltR": "228"
      }
    ]
  }
  ```
  * Note: Timestamps are formatted as `DD/MM/YYYY HH:mm` in Indian Standard Time (IST).
  * Voltage is captured on phase R (`voltR`).

### E. Individual Meter Page Data (SvelteKit Data Node)
* **Endpoint:** `GET /meters/{meterId}/__data.json`
* **Response:** Returns serialized SvelteKit array containing nameplate parameters and network hierarchy strings (e.g. `Jaipur Zone 1 (Z-01) › Circle 1 (C-01) › ...`).

---

## 4. The Hidden Bulk Export: Cryptographic HMAC Signature

On the `/transformers` page, there is an *"Export all meters"* button. Decompiling `nodes/4.2Bgc2kUI.js` revealed the hidden bulk export mechanism designed to prevent unauthorized mass scraping:

1. **Secret Key Retrieval:**
   * The client first requests: `GET /portal/keys`
   * Response:
     ```json
     { "data": { "signingSecret": "I3dZPPf5CgTp7JyGNMI8i6z8LFR7TmSR" } }
     ```

2. **Signature Generation:**
   * A Unix timestamp (seconds) is recorded: `t = String(Math.floor(Date.now() / 1000))`
   * A newline-delimited payload is constructed:
     ```
     METHOD\nPATH\nQUERY\nTIMESTAMP
     ```
     Example:
     ```
     GET
     /portal/export
     page=1
     1793287680
     ```
   * An **HMAC-SHA256** hash is generated using `signingSecret` over the payload and hex-encoded.

3. **Export Execution:**
   * The client sends: `GET /portal/export?page=1` with headers:
     * `x-timestamp: <t>`
     * `x-signature: <hex_signature>`
   * Response: HTTP 200 with all 403 meters in a single payload, complete with **nested hierarchy objects** (`zone`, `circle`, `division`, `subdivision`, `substation`, `feeder`, `dt`) and coordinates!

---

## 5. Quirks, Surprises & Gotchas

1. **CSRF Enforcement on Login:**
   * Standard headless scrapers that do not provide `Origin` and `Referer` headers will fail immediately with 403.
2. **Stringified Floats & Coordinates:**
   * In `/portal/meters/:id/geo`, latitudes and longitudes are returned as strings (`"26.93896..."`), not numeric floats. In addition, the export JSON nests them under `geo: { lat, lng }` rather than `latitude` / `longitude`.
3. **Indian Date Formatting:**
   * Timestamps in energy readings are `DD/MM/YYYY HH:mm`. Standard JavaScript `new Date()` parses this inconsistently across locales unless normalized.
4. **Session Lifetime:**
   * Session tokens expire after 60 minutes (`Max-Age=3600`). Any long-running API gateway must proactively refresh sessions before expiration to avoid dropping incoming queries.
5. **HMAC Timestamp Window:**
   * The HMAC signature header `x-timestamp` must match the server's clock within a reasonable tolerance (~30-60 seconds), requiring accurate NTP synchronization.
