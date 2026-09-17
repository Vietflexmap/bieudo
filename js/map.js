import { PMTiles, Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.4.1/+esm';
import { TEDP_STYLE, VIETNAM_BOUNDS, VIETNAM_CENTER, ANHMAP_SOURCES } from './config.js';
import { metricValue, getMetricStats, formatMetric, normalizeText } from './data.js';

const PALETTE = ['#dff3ff', '#bce6fb', '#8fd2f3', '#4fb6e7', '#1686c7'];
const BOUNDARY_SOURCE_ID = 'anhmap-boundary';
const BOUNDARY_LAYER = 'admin';

function valueClass(value, min, max) {
  if (!Number.isFinite(value) || max <= min) return 2;
  const t = (value - min) / (max - min);
  return Math.max(0, Math.min(4, Math.floor(t * 5)));
}

function bubbleRadius(value, min, max) {
  if (!Number.isFinite(value) || value <= 0) return 7;
  if (max <= min) return 15;
  const t = Math.sqrt(Math.max(0, (value - min) / (max - min)));
  return 7 + Math.min(1, t) * 17;
}

function toGeoJson(provinces, metric, selectedId = null) {
  const stats = getMetricStats(provinces, metric);
  return {
    type: 'FeatureCollection',
    features: provinces
      .filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .map(p => {
        const value = metricValue(p, metric);
        const cls = valueClass(value, stats.min, stats.max);
        return {
          type: 'Feature',
          id: p.id,
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: {
            id: p.id,
            name: p.name,
            type: p.type,
            value,
            valueText: formatMetric(value, metric),
            color: PALETTE[cls],
            radius: bubbleRadius(value, stats.min, stats.max),
            selected: p.id === selectedId ? 1 : 0
          }
        };
      })
  };
}

function decodeBase64(text) {
  const binary = atob(String(text || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

class MemorySource {
  constructor(bytes) {
    this.bytes = bytes;
    this.key = 'vietflex-anhmap.pmtiles';
  }
  getKey() { return this.key; }
  async getBytes(offset, length) {
    const view = this.bytes.subarray(offset, offset + length);
    return { data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) };
  }
}

async function fetchFirstOk(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      errors.push(`${url}: ${error?.message || error}`);
    }
  }
  throw new Error(errors.join(' | '));
}

function recordStrings(record = {}) {
  return [record.name, record.full_name, record.province, record.ten, record.label]
    .filter(Boolean)
    .map(normalizeText)
    .filter(Boolean);
}

export class StatisticsMap {
  constructor(containerId, callbacks = {}) {
    if (!window.maplibregl) throw new Error('MapLibre GL chưa tải được.');
    this.callbacks = callbacks;
    this.provinces = [];
    this.metric = 'population';
    this.selectedId = null;
    this.popup = null;
    this.hoverBoundaryId = null;
    this.selectedBoundaryId = null;
    this.boundaryRecords = [];
    this.boundaryById = new Map();
    this.boundaryProvinceRecords = [];
    this.protocol = null;
    this.boundaryReady = Promise.resolve(false);

    this.map = new window.maplibregl.Map({
      container: containerId,
      style: TEDP_STYLE,
      center: VIETNAM_CENTER,
      zoom: 4.65,
      minZoom: 3.5,
      maxZoom: 12,
      maxBounds: [[99.8, 6.3], [112.5, 25.2]],
      attributionControl: false,
      cooperativeGestures: false
    });

    this.map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new window.maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    this.ready = new Promise(resolve => {
      this.map.once('load', () => {
        this.installLayers();
        this.boundaryReady = this.installBoundary().catch(error => {
          console.warn('Không nạp được ranh giới AnhMap:', error);
          return false;
        });
        resolve();
      });
    });
  }

  installLayers() {
    this.map.addSource('province-stats', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    this.map.addLayer({
      id: 'province-halo',
      type: 'circle',
      source: 'province-stats',
      paint: {
        'circle-radius': ['+', ['get', 'radius'], ['case', ['==', ['get', 'selected'], 1], 7, 3]],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.13,
        'circle-blur': 0.35
      }
    });

    this.map.addLayer({
      id: 'province-bubbles',
      type: 'circle',
      source: 'province-stats',
      paint: {
        'circle-radius': ['+', ['get', 'radius'], ['case', ['==', ['get', 'selected'], 1], 2.5, 0]],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.72,
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#0b6ea8', 'rgba(255,255,255,.92)'],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.5, 1.2]
      }
    });

    this.map.on('mouseenter', 'province-bubbles', () => { this.map.getCanvas().style.cursor = 'pointer'; });
    this.map.on('click', 'province-bubbles', event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const province = this.provinces.find(p => p.id === feature.properties?.id);
      if (province) this.callbacks.onSelect?.(province, { fromMap: true });
    });

    this.map.on('mousemove', 'province-bubbles', event => {
      if (this.hoverBoundaryId != null) return;
      const feature = event.features?.[0];
      const province = feature && this.provinces.find(p => p.id === feature.properties?.id);
      if (province) {
        this.callbacks.onHover?.(province);
        this.showPopup(province, event.lngLat);
      }
    });
  }

  async installBoundary() {
    const html = await fetchFirstOk(ANHMAP_SOURCES);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pm = doc.getElementById('pmtilesData');
    const admin = doc.getElementById('adminData');
    if (!pm || !admin) throw new Error('AnhMap không chứa pmtilesData/adminData.');

    const payload = JSON.parse(admin.textContent || '{}');
    this.boundaryRecords = Array.isArray(payload.records) ? payload.records : [];
    this.boundaryProvinceRecords = this.boundaryRecords.filter(r => normalizeText(r.level) === 'province');
    this.boundaryById = new Map(this.boundaryRecords.map(r => [String(r.id), r]));

    const memory = new MemorySource(decodeBase64(pm.textContent));
    const archive = new PMTiles(memory);
    this.protocol = new Protocol();
    try { window.maplibregl.addProtocol('pmtiles', this.protocol.tile); } catch (_) {}
    this.protocol.add(archive);
    await archive.getHeader();

    this.map.addSource(BOUNDARY_SOURCE_ID, {
      type: 'vector',
      url: `pmtiles://${memory.getKey()}`,
      promoteId: 'id',
      attribution: 'Ranh giới: Vietflexmap/anhmap'
    });

    const provinceFilter = ['all', ['==', ['get', 'level'], 'province'], ['==', ['geometry-type'], 'Polygon']];

    this.map.addLayer({
      id: 'province-boundary-fill',
      type: 'fill',
      source: BOUNDARY_SOURCE_ID,
      'source-layer': BOUNDARY_LAYER,
      filter: provinceFilter,
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['coalesce', ['feature-state', 'metricNorm'], 0],
          0, '#eef8ff',
          0.35, '#cdeefe',
          0.7, '#86d0f2',
          1, '#2a9bd2'
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 0.42,
          ['boolean', ['feature-state', 'hover'], false], 0.34,
          0.10
        ]
      }
    }, 'province-halo');

    this.map.addLayer({
      id: 'province-boundary-line',
      type: 'line',
      source: BOUNDARY_SOURCE_ID,
      'source-layer': BOUNDARY_LAYER,
      filter: provinceFilter,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], '#075985',
          ['boolean', ['feature-state', 'hover'], false], '#0284c7',
          '#6b8da3'
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 2.8,
          ['boolean', ['feature-state', 'hover'], false], 2.5,
          0.75
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 1,
          ['boolean', ['feature-state', 'hover'], false], 1,
          0.46
        ]
      }
    }, 'province-halo');

    this.map.on('mousemove', 'province-boundary-fill', event => this.handleBoundaryMove(event));
    this.map.on('mouseleave', 'province-boundary-fill', () => this.clearBoundaryHover());
    this.map.on('click', 'province-boundary-fill', event => {
      const feature = event.features?.[0];
      const province = feature && this.provinceFromBoundaryFeature(feature);
      if (province) this.callbacks.onSelect?.(province, { fromMap: true });
    });

    this.syncBoundaryMetricStates();
    this.syncSelectedBoundary();
    return true;
  }

  boundaryRecordForProvince(province) {
    if (!province) return null;
    const names = [province.name, province.fullName].map(normalizeText).filter(Boolean);
    return this.boundaryProvinceRecords.find(record => {
      const values = recordStrings(record);
      return values.some(value => names.some(name => value === name || value.endsWith(` ${name}`) || name.endsWith(` ${value}`)));
    }) || null;
  }

  provinceFromBoundaryFeature(feature) {
    if (!feature) return null;
    const record = feature.id != null ? this.boundaryById.get(String(feature.id)) : null;
    const properties = feature.properties || {};
    const values = [
      properties.name, properties.full_name, properties.province, properties.ten,
      record?.name, record?.full_name, record?.province, record?.ten
    ].filter(Boolean).map(normalizeText);

    return this.provinces.find(province => {
      const names = [province.name, province.fullName].map(normalizeText);
      return values.some(value => names.some(name => value === name || value.endsWith(` ${name}`) || name.endsWith(` ${value}`)));
    }) || null;
  }

  setBoundaryState(id, patch) {
    if (id === null || id === undefined || !this.map.getSource(BOUNDARY_SOURCE_ID)) return;
    try {
      this.map.setFeatureState({ source: BOUNDARY_SOURCE_ID, sourceLayer: BOUNDARY_LAYER, id }, patch);
    } catch (_) {}
  }

  handleBoundaryMove(event) {
    const feature = event.features?.[0];
    if (!feature) return;
    const id = feature.id ?? feature.properties?.id;
    if (id == null) return;

    if (this.hoverBoundaryId !== id) {
      if (this.hoverBoundaryId != null) this.setBoundaryState(this.hoverBoundaryId, { hover: false });
      this.hoverBoundaryId = id;
      this.setBoundaryState(id, { hover: true });
    }

    const province = this.provinceFromBoundaryFeature(feature);
    this.map.getCanvas().style.cursor = province ? 'pointer' : '';
    if (province) {
      this.callbacks.onHover?.(province);
      this.showPopup(province, event.lngLat);
    }
  }

  clearBoundaryHover() {
    if (this.hoverBoundaryId != null) this.setBoundaryState(this.hoverBoundaryId, { hover: false });
    this.hoverBoundaryId = null;
    this.map.getCanvas().style.cursor = '';
    this.callbacks.onHover?.(null);
    this.removePopup();
  }

  syncBoundaryMetricStates() {
    if (!this.map.getSource(BOUNDARY_SOURCE_ID) || !this.provinces.length) return;
    const stats = getMetricStats(this.provinces, this.metric);
    const span = Math.max(1, stats.max - stats.min);
    for (const province of this.provinces) {
      const record = this.boundaryRecordForProvince(province);
      if (!record || record.id == null) continue;
      const value = metricValue(province, this.metric);
      const norm = Math.max(0, Math.min(1, (value - stats.min) / span));
      this.setBoundaryState(record.id, { metricNorm: norm });
    }
  }

  syncSelectedBoundary() {
    if (this.selectedBoundaryId != null) this.setBoundaryState(this.selectedBoundaryId, { selected: false });
    this.selectedBoundaryId = null;
    const province = this.provinces.find(p => p.id === this.selectedId);
    const record = this.boundaryRecordForProvince(province);
    if (record?.id != null) {
      this.selectedBoundaryId = record.id;
      this.setBoundaryState(record.id, { selected: true });
    }
  }

  async setData(provinces, metric = this.metric, selectedId = this.selectedId) {
    await this.ready;
    this.provinces = provinces;
    this.metric = metric;
    this.selectedId = selectedId;
    this.map.getSource('province-stats')?.setData(toGeoJson(provinces, metric, selectedId));
    await this.boundaryReady;
    this.syncBoundaryMetricStates();
    this.syncSelectedBoundary();
  }

  setMetric(metric) {
    this.metric = metric;
    return this.setData(this.provinces, metric, this.selectedId);
  }

  select(province, zoom = true) {
    this.selectedId = province?.id ?? null;
    this.setData(this.provinces, this.metric, this.selectedId);
    if (!province || !zoom) return;

    if (Array.isArray(province.bbox) && province.bbox.length >= 4) {
      const [minX, minY, maxX, maxY] = province.bbox.map(Number);
      if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
        this.map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 88, maxZoom: 7.4, duration: 850 });
        return;
      }
    }
    if (Number.isFinite(province.lon) && Number.isFinite(province.lat)) {
      this.map.easeTo({ center: [province.lon, province.lat], zoom: Math.max(this.map.getZoom(), 6.2), duration: 850 });
    }
  }

  reset() {
    this.map.fitBounds(VIETNAM_BOUNDS, { padding: 34, duration: 750 });
  }

  metricRank(province) {
    const sorted = [...this.provinces].sort((a, b) => metricValue(b, this.metric) - metricValue(a, this.metric));
    return sorted.findIndex(p => p.id === province.id) + 1;
  }

  showPopup(province, lngLat) {
    this.removePopup();
    const rank = this.metricRank(province);
    const html = `
      <div class="map-popup-rich">
        <div class="popup-kicker">${province.type} · Xếp hạng #${rank || '—'} theo ${this.metric === 'population' ? 'dân số' : this.metric === 'area' ? 'diện tích' : 'mật độ'}</div>
        <div class="popup-title">${province.name}</div>
        <div class="popup-metrics">
          <div><span>Dân số</span><b>${formatMetric(province.population, 'population')}</b><small>người</small></div>
          <div><span>Diện tích</span><b>${formatMetric(province.area, 'area')}</b><small>km²</small></div>
          <div><span>Mật độ</span><b>${formatMetric(province.density, 'density')}</b><small>người/km²</small></div>
        </div>
        <div class="popup-hint">Nhấp để cố định tỉnh và zoom chi tiết</div>
      </div>`;
    this.popup = new window.maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      maxWidth: '360px',
      className: 'vietflex-popup'
    }).setLngLat(lngLat).setHTML(html).addTo(this.map);
  }

  removePopup() {
    this.popup?.remove();
    this.popup = null;
  }
}
