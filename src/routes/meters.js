const express = require('express');
const router = express.Router();
const dataStore = require('../services/dataStore');

/**
 * GET /api/v1/meters/nearby
 * Spatial search: find meters within a given radius (km) of a coordinates point
 */
router.get('/nearby', (req, res, next) => {
  try {
    const { lat, lng, radiusKm = 5, limit = 20 } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing required query parameters: "lat" and "lng"'
      });
    }

    const meters = dataStore.getNearbyMeters(lat, lng, radiusKm, limit);
    return res.json({
      query: { latitude: Number(lat), longitude: Number(lng), radiusKm: Number(radiusKm) },
      totalFound: meters.length,
      data: meters
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/meters
 * List and filter meters with pagination
 */
router.get('/', (req, res, next) => {
  try {
    const { q, make, phase, status, dtCode, page = 1, limit = 20 } = req.query;
    const result = dataStore.queryMeters({
      query: q,
      make,
      phase,
      status,
      dtCode,
      page,
      limit
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/meters/:id
 * Retrieve meter details, nameplate, hierarchy and geo coordinates
 */
router.get('/:id', async (req, res, next) => {
  try {
    const meterId = req.params.id;
    const meter = await dataStore.getMeter(meterId);
    if (!meter) {
      return res.status(404).json({
        error: `Meter with ID "${meterId}" not found`
      });
    }
    return res.json({ data: meter });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/meters/:id/readings
 * Fetch live 30-minute interval energy consumption readings with caching
 */
router.get('/:id/readings', async (req, res, next) => {
  try {
    const meterId = req.params.id;
    const forceRefresh = req.query.fresh === 'true';

    // Verify meter exists or check live
    const meter = await dataStore.getMeter(meterId);
    if (!meter) {
      return res.status(404).json({
        error: `Meter with ID "${meterId}" not found`
      });
    }

    const result = await dataStore.getMeterReadings(meterId, forceRefresh);
    if (!result) {
      return res.status(404).json({
        error: `No consumption readings found for meter "${meterId}"`
      });
    }

    return res.json({
      meterId,
      cached: result.cached,
      stale: result.stale || false,
      retrievedAt: result.timestamp,
      summary: result.data.summary,
      readings: result.data.readings
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
