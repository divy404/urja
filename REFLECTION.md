# Reflection on Solution (`REFLECTION.md`)

### 1. What assumptions did you make?
* **Read-Heavy Nature of Utility Operations:** Assumed that the operations and data teams predominantly require fast, reliable read access to smart-meter telemetry and grid topology. The portal itself is read-only, so we treated it as an authoritative upstream source.
* **Dataset Size & Storage Choice:** With 403 meters and 40 distribution transformers (~400 KB total), spinning up an external database like MongoDB or PostgreSQL would introduce unnecessary deployment friction for the reviewer without performance benefits. We assumed an in-memory indexed store with local seed persistence is the most pragmatic, zero-dependency architecture for this scale.
* **Consumption Telemetry Volatility:** Assumed that smart-meter consumption readings update on 30-minute intervals. Therefore, caching meter readings for 5 minutes (`CACHE_TTL_MS=300000`) strikes the optimal balance between offloading the legacy portal and providing near-real-time updates.

---

### 2. Which part was the most difficult, and how did you get unstuck?
* **The "Export all meters" Protection Scheme:** 
  Initially, directly requesting `/portal/export` or `/meters/export` returned `404` or `403`. 
  To get unstuck, I inspected the browser's network tab and decompiled the SvelteKit frontend bundle (`nodes/4.2Bgc2kUI.js`). By searching for `/portal/export`, I discovered that the client first hits `/portal/keys` to receive a `signingSecret`, then computes an **HMAC-SHA256 signature** over the HTTP method, endpoint path, query parameters, and a Unix timestamp. Once I replicated this HMAC generation in Node.js, the bulk export returned all 403 meters with complete network hierarchy in a single request.

---

### 3. If you had another day, what would you improve?
* **Persistent Time-Series Storage:** If this service scaled to thousands of meters streaming readings every 15–30 minutes, I would introduce a time-series database (such as TimescaleDB or InfluxDB) to persist historical telemetry and enable long-term interval rollups and anomaly detection.
* **Automated Anomaly Detection & Alerts:** I would add background workers to monitor voltage deviations (flagging readings below 215V or above 245V) and unexpected consumption drops indicative of meter tampering or power outages.
* **WebSocket / Server-Sent Events (SSE):** Add real-time event streaming so operational monitoring dashboards receive live meter telemetry pushes as soon as fresh intervals are recorded.

---

### 4. What mistake did you make while solving this?
* **CSRF on Login Post:** During initial exploration via `curl`, I attempted a simple `POST /login` with username and password, which resulted in `HTTP 403 Forbidden: Cross-site POST form submissions are forbidden`. I initially suspected bot-detection or Captchas. 
  Inspecting the HTML form and request headers revealed two crucial oversights: the form input field was named `email` (not `username`), and SvelteKit's CSRF guard required explicit `Origin` and `Referer` headers matching the domain, alongside `x-sveltekit-action: true`. Once added, authentication succeeded immediately.

---

### 5. If you were reviewing your own submission, what would you criticise?
* **In-Memory Store at Scale:** For 403 meters, an in-memory Map is blazing fast (<2ms response times). However, if the utility expanded to 1,000,000 meters, holding full hierarchical structures and geographical data entirely in RAM across distributed Node processes would cause memory bloat. At that scale, I would replace the in-memory map with an indexed Postgres or Redis store with PostGIS for spatial queries.
* **Rate-Limiting Upstream Portal Calls:** Currently, if 100 concurrent requests ask for uncached meter readings for 100 different meters, the gateway fires 100 concurrent requests to `/portal/meters/:id/energy`. While the 5-minute cache mitigates repeated queries, adding an outbound concurrency queue (e.g. `p-limit` or Bottleneck) would ensure we never overwhelm the legacy portal under sudden spikes.
