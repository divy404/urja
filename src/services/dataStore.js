const fs = require('fs');
const path = require('path');
const config = require('../config');
const portalClient = require('./portalClient');

/**
 * Haversine formula to compute distance in km between two geo points
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class DataStore {
  constructor() {
    this.meters = new Map();              // meterId -> Meter
    this.transformers = new Map();        // code -> Transformer
    this.metersByDt = new Map();          // dtCode -> Set of meterIds
    this.readingsCache = new Map();       // meterId -> { timestamp, data }
    this.lastSyncedAt = null;
    this.syncStatus = 'uninitialized';
    this.syncError = null;
  }

  /**
   * Initialize data store from local disk seed, then optionally trigger background live sync
   */
  async init() {
    this.loadFromLocalFiles();
    if (config.autoSyncOnStart) {
      this.syncFromPortal().catch(err => {
        console.warn('[DataStore] Initial live sync failed, using cached seed data:', err.message);
      });
    }
  }

  /**
   * Load seed files from project folder
   */
  loadFromLocalFiles() {
    try {
      const exportPath = path.join(config.dataDir, 'meter-export.json');
      const dtPath = path.join(config.dataDir, 'all_transformers.json');

      if (fs.existsSync(dtPath)) {
        const dtData = JSON.parse(fs.readFileSync(dtPath, 'utf8'));
        const dts = dtData.data || dtData;
        for (const dt of dts) {
          this.transformers.set(dt.code, {
            code: dt.code,
            name: dt.name,
            feederCode: dt.feederCode,
            capacityKva: Number(dt.capacityKva)
          });
        }
      }

      if (fs.existsSync(exportPath)) {
        const metersData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
        for (const item of metersData) {
          this.indexMeter(item);
        }
      }

      this.lastSyncedAt = new Date();
      this.syncStatus = 'ready (local-seed)';
      console.log(`[DataStore] Loaded ${this.meters.size} meters and ${this.transformers.size} transformers from seed files.`);
    } catch (err) {
      console.error('[DataStore] Failed to load local files:', err);
    }
  }

  /**
   * Helper to index a meter object into the store
   */
  indexMeter(raw) {
    const meterId = raw.meterId;
    const dtCode = raw.dtCode || raw.hierarchy?.dt?.code || null;

    const meter = {
      meterId: raw.meterId,
      serialNo: raw.serialNo,
      make: raw.make,
      phaseType: raw.phaseType,
      installStatus: raw.installStatus,
      installType: raw.installType || 'Unknown',
      build: raw.build || 'standard',
      dtCode: dtCode,
      hierarchy: raw.hierarchy || null,
      location: raw.geo ? {
        latitude: Number(raw.geo.lat ?? raw.geo.latitude),
        longitude: Number(raw.geo.lng ?? raw.geo.longitude)
      } : null,
      lastUpdated: new Date().toISOString()
    };

    this.meters.set(meterId, meter);

    if (dtCode) {
      if (!this.metersByDt.has(dtCode)) {
        this.metersByDt.set(dtCode, new Set());
      }
      this.metersByDt.get(dtCode).add(meterId);
    }

    return meter;
  }

  /**
   * Live sync with the legacy Urja portal
   */
  async syncFromPortal() {
    this.syncStatus = 'syncing';
    try {
      console.log('[DataStore] Starting live sync from Urja portal...');
      
      // 1. Fetch Transformers
      const dts = await portalClient.fetchTransformers();
      for (const dt of dts) {
        this.transformers.set(dt.code, {
          code: dt.code,
          name: dt.name,
          feederCode: dt.feederCode,
          capacityKva: Number(dt.capacityKva)
        });
      }

      // 2. Fetch full export via HMAC signature
      const metersData = await portalClient.fetchBulkExport();
      for (const item of metersData) {
        this.indexMeter(item);
      }

      this.lastSyncedAt = new Date();
      this.syncStatus = 'ready (live-synced)';
      this.syncError = null;
      console.log(`[DataStore] Live sync complete. Indexed ${this.meters.size} meters, ${this.transformers.size} transformers.`);
      return {
        success: true,
        metersCount: this.meters.size,
        transformersCount: this.transformers.size,
        syncedAt: this.lastSyncedAt
      };
    } catch (err) {
      this.syncStatus = 'error';
      this.syncError = err.message;
      console.error('[DataStore] Live sync error:', err.message);
      throw err;
    }
  }

  /**
   * Query meters with filtering and pagination
   */
  queryMeters({ query, make, phase, status, dtCode, page = 1, limit = 20 }) {
    let results = Array.from(this.meters.values());

    if (query) {
      const q = query.toLowerCase().trim();
      results = results.filter(m =>
        m.meterId.toLowerCase().includes(q) ||
        m.serialNo.toLowerCase().includes(q) ||
        (m.dtCode && m.dtCode.toLowerCase().includes(q))
      );
    }

    if (make) {
      results = results.filter(m => m.make.toLowerCase() === make.toLowerCase());
    }

    if (phase) {
      results = results.filter(m => m.phaseType.toLowerCase() === phase.toLowerCase());
    }

    if (status) {
      results = results.filter(m => m.installStatus.toLowerCase() === status.toLowerCase());
    }

    if (dtCode) {
      results = results.filter(m => m.dtCode === dtCode);
    }

    const total = results.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const totalPages = Math.ceil(total / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginated = results.slice(offset, offset + limitNum);

    return {
      data: paginated,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    };
  }

  /**
   * Get single meter by ID (with on-demand live lookup if not in store)
   */
  async getMeter(meterId) {
    let meter = this.meters.get(meterId);
    if (!meter) {
      // Try on-demand portal fetch
      try {
        const search = await portalClient.searchMeters(meterId);
        const match = (search.data || []).find(m => m.meterId === meterId);
        if (match) {
          const geo = await portalClient.fetchMeterGeo(meterId);
          meter = this.indexMeter({ ...match, geo: geo ? { lat: geo.latitude, lng: geo.longitude } : null });
        }
      } catch (e) {
        // portal unreachable or not found
      }
    }
    return meter || null;
  }

  /**
   * Get or fetch live energy readings with caching
   */
  async getMeterReadings(meterId, forceRefresh = false) {
    const cached = this.readingsCache.get(meterId);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp < config.cacheTtlMs)) {
      return { data: cached.data, cached: true, timestamp: new Date(cached.timestamp).toISOString() };
    }

    try {
      const readings = await portalClient.fetchMeterReadings(meterId);
      if (!readings) return null;

      // Clean, validate and compute summary statistics
      const cleaned = readings.map(r => ({
        timestamp: r.timestamp,
        kwh: parseFloat(r.kwh) || 0,
        kvah: parseFloat(r.kvah) || 0,
        voltageR: parseFloat(r.voltR) || 0
      }));

      // Calculate summary
      const summary = {
        readingCount: cleaned.length,
        minVoltage: cleaned.length ? Math.min(...cleaned.map(r => r.voltageR)) : 0,
        maxVoltage: cleaned.length ? Math.max(...cleaned.map(r => r.voltageR)) : 0,
        avgVoltage: cleaned.length ? +(cleaned.reduce((acc, r) => acc + r.voltageR, 0) / cleaned.length).toFixed(1) : 0,
        totalKwhConsumed: cleaned.length >= 2 ? +(cleaned[cleaned.length - 1].kwh - cleaned[0].kwh).toFixed(2) : 0
      };

      const result = { summary, readings: cleaned };
      this.readingsCache.set(meterId, { timestamp: Date.now(), data: result });
      return { data: result, cached: false, timestamp: new Date().toISOString() };
    } catch (err) {
      // If cached data exists even if stale, return it on portal error
      if (cached) {
        return { data: cached.data, cached: true, stale: true, timestamp: new Date(cached.timestamp).toISOString() };
      }
      throw err;
    }
  }

  /**
   * Query nearby meters within a radius (km)
   */
  getNearbyMeters(lat, lng, radiusKm = 5, limit = 20) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radius = parseFloat(radiusKm);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
      throw new Error('Valid lat, lng, and radiusKm are required numbers');
    }

    const matches = [];
    for (const meter of this.meters.values()) {
      if (meter.location && meter.location.latitude && meter.location.longitude) {
        const dist = haversineKm(latitude, longitude, meter.location.latitude, meter.location.longitude);
        if (dist <= radius) {
          matches.push({
            ...meter,
            distanceKm: +dist.toFixed(3)
          });
        }
      }
    }

    matches.sort((a, b) => a.distanceKm - b.distanceKm);
    return matches.slice(0, parseInt(limit, 10));
  }

  /**
   * Query transformers
   */
  queryTransformers({ feederCode, minCapacity, maxCapacity }) {
    let results = Array.from(this.transformers.values());

    if (feederCode) {
      results = results.filter(t => t.feederCode.toLowerCase() === feederCode.toLowerCase());
    }

    if (minCapacity) {
      results = results.filter(t => t.capacityKva >= Number(minCapacity));
    }

    if (maxCapacity) {
      results = results.filter(t => t.capacityKva <= Number(maxCapacity));
    }

    return results.map(t => {
      const meterCount = this.metersByDt.get(t.code)?.size || 0;
      return {
        ...t,
        meterCount
      };
    });
  }

  /**
   * Get single transformer with its attached meters
   */
  getTransformer(code) {
    const t = this.transformers.get(code);
    if (!t) return null;

    const meterIds = Array.from(this.metersByDt.get(code) || []);
    const meters = meterIds.map(id => this.meters.get(id)).filter(Boolean);

    return {
      ...t,
      meterCount: meters.length,
      meters: meters.map(m => ({
        meterId: m.meterId,
        serialNo: m.serialNo,
        make: m.make,
        phaseType: m.phaseType,
        installStatus: m.installStatus
      }))
    };
  }

  /**
   * Reconstruct full hierarchical tree
   */
  getNetworkHierarchy() {
    const tree = { name: 'Distribution Network', type: 'root', children: {} };

    for (const meter of this.meters.values()) {
      if (!meter.hierarchy) continue;
      const h = meter.hierarchy;

      const zoneName = h.zone?.name || 'Unassigned Zone';
      const circleName = h.circle?.name || 'Unassigned Circle';
      const divisionName = h.division?.name || 'Unassigned Division';
      const subDivName = h.subdivision?.name || 'Unassigned SubDiv';
      const substationName = h.substation?.name || 'Unassigned Substation';
      const feederName = h.feeder?.name || 'Unassigned Feeder';
      const dtName = h.dt?.name || meter.dtCode || 'Unassigned DT';

      // Build tree path
      if (!tree.children[zoneName]) tree.children[zoneName] = { name: zoneName, code: h.zone?.code, type: 'zone', children: {} };
      const zNode = tree.children[zoneName];

      if (!zNode.children[circleName]) zNode.children[circleName] = { name: circleName, code: h.circle?.code, type: 'circle', children: {} };
      const cNode = zNode.children[circleName];

      if (!cNode.children[divisionName]) cNode.children[divisionName] = { name: divisionName, code: h.division?.code, type: 'division', children: {} };
      const dNode = cNode.children[divisionName];

      if (!dNode.children[subDivName]) dNode.children[subDivName] = { name: subDivName, code: h.subdivision?.code, type: 'subdivision', children: {} };
      const sdNode = dNode.children[subDivName];

      if (!sdNode.children[substationName]) sdNode.children[substationName] = { name: substationName, code: h.substation?.code, type: 'substation', children: {} };
      const ssNode = sdNode.children[substationName];

      if (!ssNode.children[feederName]) ssNode.children[feederName] = { name: feederName, code: h.feeder?.code, type: 'feeder', children: {} };
      const fNode = ssNode.children[feederName];

      if (!fNode.children[dtName]) fNode.children[dtName] = { name: dtName, code: h.dt?.code, type: 'dt', meters: [] };
      const dtNode = fNode.children[dtName];

      dtNode.meters.push({
        meterId: meter.meterId,
        serialNo: meter.serialNo,
        status: meter.installStatus,
        phase: meter.phaseType
      });
    }

    // Helper to format dictionary children into clean arrays
    function formatNode(node) {
      if (node.meters) {
        return {
          name: node.name,
          code: node.code,
          type: node.type,
          meterCount: node.meters.length,
          meters: node.meters
        };
      }
      return {
        name: node.name,
        code: node.code,
        type: node.type,
        children: Object.values(node.children || {}).map(formatNode)
      };
    }

    return Object.values(tree.children).map(formatNode);
  }
}

module.exports = new DataStore();
