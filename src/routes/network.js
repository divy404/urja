const express = require('express');
const router = express.Router();
const dataStore = require('../services/dataStore');

/**
 * GET /api/v1/network/hierarchy
 * Returns the fully reconstructed utility network hierarchy tree
 */
router.get('/hierarchy', (req, res, next) => {
  try {
    const hierarchy = dataStore.getNetworkHierarchy();
    return res.json({
      description: 'Distribution network hierarchical structure (Zone -> Circle -> Division -> Subdivision -> Substation -> Feeder -> DT -> Meters)',
      data: hierarchy
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
