let currentPage = 1;
let currentLimit = 15;
let debounceTimer = null;
let mapInstance = null;
let mapMarkers = [];
let chartInstance = null;

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');

  const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick')?.includes(tabId));
  if (btn) btn.classList.add('active');

  if (tabId === 'mapTab') {
    setTimeout(() => {
      if (!mapInstance) initMap();
      else mapInstance.invalidateSize();
    }, 100);
  } else if (tabId === 'hierarchyTab') {
    loadHierarchy();
  } else if (tabId === 'transformersTab') {
    loadTransformers();
  }
}

async function loadHealth() {
  try {
    const res = await fetch('/api/v1/health');
    const health = await res.json();
    
    document.getElementById('gatewayStatus').innerText = `Synced (${health.sync.status})`;
    document.getElementById('totalMeters').innerText = health.counts.meters;
    document.getElementById('totalTransformers').innerText = health.counts.transformers;

    const mRes = await fetch('/api/v1/meters?limit=100');
    const mData = await mRes.json();
    const installed = mData.data.filter(m => m.installStatus === 'Installed').length;
    const faulty = mData.data.filter(m => m.installStatus === 'Faulty').length;
    const decommissioned = mData.data.filter(m => m.installStatus === 'Decommissioned').length;

    const rate = Math.round((installed / (installed + faulty + decommissioned || 1)) * 100);
    document.getElementById('installedRate').innerText = `${rate}%`;
    document.getElementById('installedCount').innerText = `${installed} in active operation`;
    document.getElementById('issueCount').innerText = `${faulty + decommissioned} units`;
  } catch (err) {
    document.getElementById('gatewayStatus').innerText = 'Gateway offline';
  }
}

function debounceSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    loadMeters(1);
  }, 300);
}

async function loadMeters(page = 1) {
  currentPage = page;
  const search = document.getElementById('meterSearch')?.value || '';
  const make = document.getElementById('filterMake')?.value || '';
  const phase = document.getElementById('filterPhase')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';

  const params = new URLSearchParams({
    page: currentPage,
    limit: currentLimit,
    ...(search && { q: search }),
    ...(make && { make }),
    ...(phase && { phase }),
    ...(status && { status })
  });

  const tbody = document.getElementById('metersTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Loading meters...</td></tr>';

  try {
    const res = await fetch(`/api/v1/meters?${params.toString()}`);
    const data = await res.json();

    if (!data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No meters found matching filters.</td></tr>';
      document.getElementById('paginationFooter').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.data.map(m => `
      <tr>
        <td><span class="meter-link" onclick="openMeterDetails('${m.meterId}')">${m.meterId}</span></td>
        <td style="font-family: var(--font-mono);">${m.serialNo}</td>
        <td><strong>${m.make}</strong></td>
        <td>${m.phaseType === 'single' ? 'Single Phase (1P)' : 'Three Phase (3P)'}</td>
        <td>
          <span class="badge-status status-${m.installStatus.toLowerCase()}">${m.installStatus}</span>
        </td>
        <td><code>${m.dtCode || 'N/A'}</code></td>
        <td>
          <button class="btn btn-secondary" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; color: #1e293b;" onclick="openMeterDetails('${m.meterId}')">
            View Readings
          </button>
        </td>
      </tr>
    `).join('');

    renderPagination(data.pagination);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-rose">Error loading meters: ${err.message}</td></tr>`;
  }
}

function renderPagination(pg) {
  const footer = document.getElementById('paginationFooter');
  if (!pg || pg.totalPages <= 1) {
    footer.innerHTML = `<span>Showing ${pg.total} meters</span>`;
    return;
  }

  footer.innerHTML = `
    <div>Showing page <strong>${pg.page}</strong> of <strong>${pg.totalPages}</strong> (${pg.total} meters)</div>
    <div style="display: flex; gap: 0.5rem;">
      <button class="btn btn-secondary" style="color: #1e293b;" ${!pg.hasPrev ? 'disabled style="opacity: 0.5"' : ''} onclick="loadMeters(${pg.page - 1})">Previous</button>
      <button class="btn btn-secondary" style="color: #1e293b;" ${!pg.hasNext ? 'disabled style="opacity: 0.5"' : ''} onclick="loadMeters(${pg.page + 1})">Next</button>
    </div>
  `;
}

async function openMeterDetails(meterId) {
  const modal = document.getElementById('meterModal');
  modal.classList.add('open');
  document.getElementById('modalMeterId').innerText = `Meter ${meterId}`;
  document.getElementById('modalSerial').innerText = 'Loading metadata and telemetry...';
  document.getElementById('modalNameplate').innerHTML = 'Loading nameplate...';
  document.getElementById('consumptionSummary').innerHTML = '';

  try {
    const res = await fetch(`/api/v1/meters/${meterId}`);
    const { data: meter } = await res.json();

    document.getElementById('modalSerial').innerText = `Serial: ${meter.serialNo} • Make: ${meter.make} • Status: ${meter.installStatus}`;

    document.getElementById('modalNameplate').innerHTML = `
      <div class="np-item"><dt>Phase Type</dt><dd>${meter.phaseType}</dd></div>
      <div class="np-item"><dt>Installation Type</dt><dd>${meter.installType}</dd></div>
      <div class="np-item"><dt>DT Code</dt><dd>${meter.dtCode || 'N/A'}</dd></div>
      <div class="np-item"><dt>Zone / Circle</dt><dd>${meter.hierarchy?.zone?.name || 'N/A'}</dd></div>
      <div class="np-item"><dt>Coordinates</dt><dd>${meter.location ? `${meter.location.latitude.toFixed(4)}, ${meter.location.longitude.toFixed(4)}` : 'N/A'}</dd></div>
    `;

    const rRes = await fetch(`/api/v1/meters/${meterId}/readings`);
    if (!rRes.ok) {
      document.getElementById('consumptionSummary').innerHTML = '<div class="text-muted">No telemetry readings available for this meter.</div>';
      return;
    }

    const readingsData = await rRes.json();
    renderChart(readingsData.readings);

    const s = readingsData.summary;
    document.getElementById('consumptionSummary').innerHTML = `
      <div class="summary-tile"><div class="summary-tile-label">30m Readings</div><div class="summary-tile-val">${s.readingCount}</div></div>
      <div class="summary-tile"><div class="summary-tile-label">Total kWh Consumed</div><div class="summary-tile-val">${s.totalKwhConsumed}</div></div>
      <div class="summary-tile"><div class="summary-tile-label">Avg Voltage (V)</div><div class="summary-tile-val">${s.avgVoltage} V</div></div>
      <div class="summary-tile"><div class="summary-tile-label">Voltage Range</div><div class="summary-tile-val">${s.minVoltage} - ${s.maxVoltage} V</div></div>
    `;
  } catch (err) {
    document.getElementById('modalSerial').innerText = `Error: ${err.message}`;
  }
}

function renderChart(readings) {
  const ctx = document.getElementById('consumptionChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const sample = readings.slice(-48);
  const labels = sample.map(r => r.timestamp.split(' ')[1] || r.timestamp);
  const kwhData = sample.map(r => r.kwh);
  const voltData = sample.map(r => r.voltageR);

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Cumulative Energy (kWh)',
          data: kwhData,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          fill: true,
          tension: 0.3,
          yAxisID: 'y'
        },
        {
          label: 'R-Phase Voltage (V)',
          data: voltData,
          borderColor: '#10b981',
          borderDash: [5, 5],
          tension: 0.2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Energy (kWh)' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Voltage (V)' },
          min: 200,
          max: 260
        }
      }
    }
  });
}

function closeModal() {
  document.getElementById('meterModal').classList.remove('open');
}

function closeModalOnBg(e) {
  if (e.target.id === 'meterModal') closeModal();
}

async function loadHierarchy() {
  const container = document.getElementById('hierarchyView');
  container.innerHTML = '<div class="text-center py-4 text-muted">Building tree...</div>';
  try {
    const res = await fetch('/api/v1/network/hierarchy');
    const { data } = await res.json();

    function renderNode(node) {
      if (node.meters) {
        return `
          <div class="tree-node">
            <div class="tree-header" onclick="this.nextElementSibling.classList.toggle('d-none')">
              <span class="tree-toggle">&gt;</span>
              <span class="tree-type-badge">${node.type}</span>
              <span>${node.name} (${node.code})</span>
              <span class="text-muted text-sm">- ${node.meterCount} meters attached</span>
            </div>
            <div class="d-none" style="margin-left: 1.5rem; margin-top: 0.25rem;">
              <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.5rem 0;">
                ${node.meters.map(m => `
                  <span class="meter-link" style="font-size: 0.75rem; background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px;" onclick="openMeterDetails('${m.meterId}')">
                    ${m.meterId} (${m.status})
                  </span>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="tree-node">
          <div class="tree-header" onclick="this.nextElementSibling.classList.toggle('d-none')">
            <span class="tree-toggle">v</span>
            <span class="tree-type-badge">${node.type}</span>
            <span>${node.name}</span>
          </div>
          <div style="margin-top: 0.25rem;">
            ${(node.children || []).map(renderNode).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = data.map(renderNode).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-rose">Failed to load hierarchy: ${err.message}</div>`;
  }
}

async function loadTransformers() {
  const tbody = document.getElementById('transformersTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Loading transformers...</td></tr>';
  try {
    const res = await fetch('/api/v1/transformers');
    const { data } = await res.json();
    tbody.innerHTML = data.map(t => `
      <tr>
        <td><code>${t.code}</code></td>
        <td><strong>${t.name}</strong></td>
        <td><code>${t.feederCode}</code></td>
        <td><span class="badge-status status-installed">${t.capacityKva} kVA</span></td>
        <td><strong>${t.meterCount}</strong> smart meters</td>
        <td><span class="text-emerald">Operational</span></td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-rose text-center">Failed to load transformers: ${err.message}</td></tr>`;
  }
}

async function initMap() {
  const jaipurCenter = [26.9124, 75.7873];
  mapInstance = L.map('meterMap').setView(jaipurCenter, 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'OpenStreetMap contributors'
  }).addTo(mapInstance);

  try {
    const res = await fetch('/api/v1/meters?limit=100');
    const { data } = await res.json();

    data.forEach(m => {
      if (m.location && m.location.latitude && m.location.longitude) {
        const color = m.installStatus === 'Installed' ? '#10b981' : (m.installStatus === 'Faulty' ? '#f43f5e' : '#64748b');
        const marker = L.circleMarker([m.location.latitude, m.location.longitude], {
          radius: 6,
          fillColor: color,
          color: '#fff',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.85
        }).addTo(mapInstance);

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 13px;">
            <strong style="color: #2563eb;">Meter ${m.meterId}</strong><br/>
            Serial: ${m.serialNo}<br/>
            Make: ${m.make}<br/>
            DT: ${m.dtCode}<br/>
            Status: <strong>${m.installStatus}</strong><br/><br/>
            <button onclick="openMeterDetails('${m.meterId}')" style="background: #2563eb; color: #fff; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">View Readings</button>
          </div>
        `);
        mapMarkers.push(marker);
      }
    });

    document.getElementById('mapFoundCount').innerText = `Plotted ${mapMarkers.length} geocoded meters across Jaipur utility region`;
  } catch (err) {
    console.error('Failed to plot meters:', err);
  }
}

async function searchNearby() {
  const radius = document.getElementById('radiusInput').value || 5;
  const jaipurLat = 26.9389;
  const jaipurLng = 75.8309;

  try {
    const res = await fetch(`/api/v1/meters/nearby?lat=${jaipurLat}&lng=${jaipurLng}&radiusKm=${radius}&limit=50`);
    const data = await res.json();
    alert(`Found ${data.totalFound} smart meters within ${radius} km radius of Jaipur grid center.`);
  } catch (err) {
    alert('Nearby search failed: ' + err.message);
  }
}

async function triggerSync() {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.innerText = 'Syncing...';
  try {
    const res = await fetch('/api/v1/sync', { method: 'POST' });
    const json = await res.json();
    alert(`Sync completed. ${json.result.metersCount} meters refreshed from portal.`);
    loadHealth();
    loadMeters(1);
  } catch (err) {
    alert('Sync error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = 'Sync Portal';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadHealth();
  loadMeters(1);
});
