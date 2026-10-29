const crypto = require('crypto');
const https = require('https');
const http = require('http');
const config = require('../config');

class UrjaPortalClient {
  constructor() {
    this.baseUrl = config.portalBaseUrl;
    this.username = config.portalUsername;
    this.password = config.portalPassword;
    this.sessionToken = null;
    this.sessionExpiry = 0;
  }

  /**
   * Internal generic HTTP request helper that handles cookies & redirects
   */
  request(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = {
        'User-Agent': 'Urja-API-Gateway/1.0',
        'Accept': 'application/json, text/plain, */*',
        ...(options.headers || {})
      };

      if (this.sessionToken) {
        headers['Cookie'] = `__Secure-better-auth.session_token=${this.sessionToken}`;
      }

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers
      };

      const req = client.request(reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          // Extract Set-Cookie if present
          const setCookieHeaders = res.headers['set-cookie'];
          if (setCookieHeaders) {
            for (const c of setCookieHeaders) {
              const match = c.match(/__Secure-better-auth\.session_token=([^;]+)/);
              if (match) {
                this.sessionToken = match[1];
                // Set expiry 50 minutes from now (Max-Age is 3600s = 60 mins)
                this.sessionExpiry = Date.now() + 50 * 60 * 1000;
              }
            }
          }

          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timed out'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Log into the Urja Meter Ops legacy portal
   */
  async login() {
    const postData = `email=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    const res = await this.request('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/login`,
        'x-sveltekit-action': 'true'
      },
      body: postData
    });

    if (!this.sessionToken) {
      throw new Error(`Authentication failed against ${this.baseUrl}: HTTP ${res.statusCode} - ${res.body}`);
    }

    return { success: true, sessionExpiry: this.sessionExpiry };
  }

  /**
   * Ensure an active, unexpired session is available
   */
  async ensureAuthenticated() {
    if (!this.sessionToken || Date.now() > this.sessionExpiry) {
      await this.login();
    }
  }

  /**
   * Fetch the bulk meter export using the portal's HMAC signature scheme
   */
  async fetchBulkExport() {
    await this.ensureAuthenticated();

    // 1. Get signing secret
    const keysRes = await this.request('/portal/keys');
    if (keysRes.statusCode !== 200) {
      throw new Error(`Failed to fetch signing secret: HTTP ${keysRes.statusCode}`);
    }
    const keysData = JSON.parse(keysRes.body);
    const secret = keysData.data?.signingSecret;
    if (!secret) {
      throw new Error('Signing secret not returned by /portal/keys');
    }

    // 2. Generate HMAC signature: SHA256 of "METHOD\nPATH\nQUERY\nTIMESTAMP"
    const method = 'GET';
    const path = '/portal/export';
    const query = 'page=1';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = [method, path, query, timestamp].join('\n');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // 3. Request bulk export with auth and HMAC headers
    const exportRes = await this.request(`${path}?${query}`, {
      headers: {
        'x-timestamp': timestamp,
        'x-signature': signature
      }
    });

    if (exportRes.statusCode !== 200) {
      throw new Error(`Bulk export request failed: HTTP ${exportRes.statusCode} - ${exportRes.body}`);
    }

    const exportData = JSON.parse(exportRes.body);
    return exportData.data || [];
  }

  /**
   * Fetch transformers list from /portal/dts
   */
  async fetchTransformers() {
    await this.ensureAuthenticated();
    let page = 1;
    let allDts = [];
    let hasMore = true;

    while (hasMore) {
      const res = await this.request(`/portal/dts?page=${page}`);
      if (res.statusCode !== 200) {
        throw new Error(`Failed to fetch transformers (page ${page}): HTTP ${res.statusCode}`);
      }
      const json = JSON.parse(res.body);
      const data = json.data || [];
      allDts.push(...data);
      if (allDts.length >= (json.total || 0) || data.length === 0) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return allDts;
  }

  /**
   * Fetch live 30-minute consumption readings for a meter
   */
  async fetchMeterReadings(meterId) {
    await this.ensureAuthenticated();
    const res = await this.request(`/portal/meters/${encodeURIComponent(meterId)}/energy`);
    if (res.statusCode === 404) return null;
    if (res.statusCode !== 200) {
      throw new Error(`Failed to fetch energy readings for ${meterId}: HTTP ${res.statusCode}`);
    }
    const json = JSON.parse(res.body);
    return json.data || [];
  }

  /**
   * Fetch live geo coordinates for a meter
   */
  async fetchMeterGeo(meterId) {
    await this.ensureAuthenticated();
    const res = await this.request(`/portal/meters/${encodeURIComponent(meterId)}/geo`);
    if (res.statusCode === 404) return null;
    if (res.statusCode !== 200) {
      throw new Error(`Failed to fetch geo for ${meterId}: HTTP ${res.statusCode}`);
    }
    const json = JSON.parse(res.body);
    return json.data || null;
  }

  /**
   * Query individual meter from portal search
   */
  async searchMeters(query = '', page = 1) {
    await this.ensureAuthenticated();
    const res = await this.request(`/portal/meters/search?q=${encodeURIComponent(query)}&page=${page}`);
    if (res.statusCode !== 200) {
      throw new Error(`Failed to search meters: HTTP ${res.statusCode}`);
    }
    return JSON.parse(res.body);
  }
}

module.exports = new UrjaPortalClient();
