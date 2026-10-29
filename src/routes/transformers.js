const express = require('express');
const router = express.Router();
const dataStore = require('../services/dataStore');

/**
 * GET /api/v1/transformers
 * List distribution transformers with optional filtering
 */
router.get('/', (req, res, next) => {
  try {
    const { feederCode, minCapacity, maxCapacity } = req.query;
    const transformers = dataStore.queryTransformers({
      feederCode,
      minCapacity,
      maxCapacity
    });

    return res.json({
      total: transformers.length,
      data: transformers
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/transformers/:code
 * Get transformer details and all attached meters
 */
router.get('/:code', (req, res, next) => {
  try {
    const code = req.params.code;
    const transformer = dataStore.getTransformer(code);
    if (!transformer) {
      return res.status(404).json({
        error: `Transformer with code "${code}" not found`
      });
    }

    return res.json({ data: transformer });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
