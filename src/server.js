const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const dataStore = require('./services/dataStore');
const metersRouter = require('./routes/meters');
const transformersRouter = require('./routes/transformers');
const networkRouter = require('./routes/network');
const systemRouter = require('./routes/system');

const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/docs') && !req.path.startsWith('/public')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
});

// Load OpenAPI specification
const openApiPath = path.join(__dirname, '..', 'openapi.json');
let openApiSpec = {};
if (fs.existsSync(openApiPath)) {
  openApiSpec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
}

// Swagger UI & raw OpenAPI endpoint
app.get('/openapi.json', (req, res) => res.json(openApiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'Urja Meter Ops API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true
  }
}));

// Serve static frontend assets for the modern dashboard
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// API Routes
app.use('/api/v1', systemRouter);
app.use('/api/v1/meters', metersRouter);
app.use('/api/v1/transformers', transformersRouter);
app.use('/api/v1/network', networkRouter);

// Root fallback / information
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.json({
    service: 'Urja Meter Ops API Gateway',
    version: '1.0.0',
    documentation: '/docs',
    openapi: '/openapi.json',
    health: '/api/v1/health',
    endpoints: [
      'GET /api/v1/meters',
      'GET /api/v1/meters/:id',
      'GET /api/v1/meters/:id/readings',
      'GET /api/v1/meters/nearby?lat=...&lng=...',
      'GET /api/v1/transformers',
      'GET /api/v1/transformers/:code',
      'GET /api/v1/network/hierarchy',
      'POST /api/v1/sync'
    ]
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    docs: '/docs'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// Start Server & Initialize Storage
async function start() {
  await dataStore.init();
  const server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`🚀 Urja Meter Ops Gateway running on http://localhost:${config.port}`);
    console.log(`📖 Interactive Swagger Documentation: http://localhost:${config.port}/docs`);
    console.log(`📊 Modern Dashboard: http://localhost:${config.port}`);
    console.log(`⚡ Raw OpenAPI: http://localhost:${config.port}/openapi.json`);
    console.log(`====================================================`);
  });
  return server;
}

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
