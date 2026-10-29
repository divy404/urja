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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/docs') && !req.path.startsWith('/public')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Load OpenAPI spec for Swagger UI
const openApiPath = path.join(__dirname, '..', 'openapi.json');
let openApiSpec = {};
if (fs.existsSync(openApiPath)) {
  openApiSpec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
}

app.get('/openapi.json', (req, res) => res.json(openApiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'Urja Meter Ops API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true
  }
}));

// Serve frontend assets if folder exists
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Mount versioned API routes
app.use('/api/v1', systemRouter);
app.use('/api/v1/meters', metersRouter);
app.use('/api/v1/transformers', transformersRouter);
app.use('/api/v1/network', networkRouter);

// Fallback route
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
    health: '/api/v1/health'
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    docs: '/docs'
  });
});

app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

async function start(port = config.port) {
  await dataStore.init();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`Server listening on http://localhost:${actualPort}`);
      console.log(`Swagger docs available at http://localhost:${actualPort}/docs`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
