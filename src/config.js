const path = require('path');
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  portalBaseUrl: process.env.PORTAL_BASE_URL || 'https://urja-ops.flockenergy.tech',
  portalUsername: process.env.PORTAL_USERNAME || 'operator@urja.local',
  portalPassword: process.env.PORTAL_PASSWORD || 'urja-ops-2026',
  dataDir: path.resolve(__dirname, '..'),
  cacheTtlMs: parseInt(process.env.CACHE_TTL_MS || '300000', 10), // 5 minutes default
  autoSyncOnStart: process.env.AUTO_SYNC !== 'false',
};
