const express = require('express');
const router = express.Router();
const dataStore = require('../services/dataStore');

/**
 * GET /api/v1/health
 * Service health, cache freshness, and memory statistics
 */
router.get('/health', (req, res) => {
  return res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    sync: {
      status: dataStore.syncStatus,
      lastSyncedAt: dataStore.lastSyncedAt,
      lastError: dataStore.syncError
    },
    counts: {
      meters: dataStore.meters.size,
      transformers: dataStore.transformers.size,
      cachedReadings: dataStore.readingsCache.size
    }
  });
});

/**
 * POST /api/v1/sync
 * Manually trigger live sync from the legacy Urja portal
 */
router.post('/sync', async (req, res, next) => {
  try {
    const result = await dataStore.syncFromPortal();
    return res.json({
      message: 'Live sync completed successfully',
      result
    });
  } catch (err) {
    return res.status(502).json({
      error: 'Failed to sync with legacy portal',
      details: err.message
    });
  }
});

module.exports = router;
