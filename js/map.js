import { PMTiles } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.4.1/+esm';
import { VectorTile } from 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.4/+esm';
import Pbf from 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm';
import { TEDP_TILE_URL, VIETNAM_BOUNDS, VIETNAM_CENTER, ANHMAP_SOURCES } from './config.js';
import { metricValue, getMetricStats, formatMetric, normalizeText } from './data.js';

const TILE_SIZE = 256;
const BOUNDARY_MIN_ZOOM = 4;
const BOUNDARY_MAX_ZOOM = 18;
const BOUNDARY_NATIVE_MAX_ZOOM = 9;
const SOURCE_LAYER = 'admin';
const CHOROPLETH = ['#eef8ff', '#d7effb', '#aee0f5', '#69c2e9', '#1686c7'];
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';

function injectLeafletCss() {
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS;
    link.crossOrigin = '';
    document.head.appendChild(link);
  }
  if (document.getElementById('vietflex-leaflet-fix')) return;
  const style = document.createElement('style');
  style.id = 'vietflex-leaflet-fix';
  style.textContent = `
    #map.leaflet-container{background:#eef3f6;font:inherit;outline:0}
    #map .leaflet-tile-pane{filter:saturate(.92) contrast(.98)}
    #map .leaflet-control-container{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #map .leaflet-bar{border:1px solid #d8e2e9;box-shadow:0 5px 16px rgba(29,51,66,.10)}
    #map .leaflet-bar a{color:#4c677a;background:#fff;border-bottom-color:#e3eaf0}
    #map .leaflet-bar a:hover{background:#f2f9fd;color:#1686c7}
    #map .leaflet-control-attribution{background:rgba(255,255,255,.88);color:#6b7f8e;font-size:9px;border-radius:6px 0 0 0}
    #map .leaflet-control-attribution a{color:#1a79af}
    #map .boundary-canvas{pointer-events:none}
    #map .leaflet-popup.vietflex-popup .leaflet-popup-content-wrapper{padding:0;border:1px solid #cbdce7;background:#fff;color:#1a2b38;border-radius:16px;box-shadow:0 18px 42px rgba(31,70,95,.18);overflow:hidden}
    #map .leaflet-popup.vietflex-popup .leaflet-popup-content{margin:0;min-width:310px}
    #map .leaflet-popup.vietflex-popup .leaflet-popup-tip{background:#fff;box-shadow:none}
  `;
  document.head.appendChild(style);
}

async function loadLeaflet() {
  injectLeafletCss();
  if (window.L?.map) return window.L;
  const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      const check = () => window.L?.map ? resolve(window.L) : reject(new Error('Leaflet đã tải nhưng API chưa sẵn sàng.'));
      existing.addEventListener('load', check, { once: true });
      existing.addEventListener('error', () => reject(new Error('Không tải được Leaflet.')), { once: true });
      setTimeout(check, 0);
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => window.L?.map ? resolve(window.L) : reject(new Error('Leaflet không khởi tạo.'));
    script.onerror = () => reject(new Error('Không tải được Leaflet từ CDN.'));
    document.head.appendChild(script);
  });
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
    this.key = `memory://vietflex-anhmap-${bytes.byteLength}`;
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

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a.y > y) !== (b.y > y)) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y || Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

function pointInGeometry(x, y, geometry) {
  let inside = false;
  for (const ring of geometry) if (ring.length > 2 && pointInRing(x, y, ring)) inside = !inside;
  return inside;
}

function recordStrings(record = {}) {
  return [record.name, record.full_name, record.province, record.ten, record.label]
    .filter(Boolean).map(normalizeText).filter(Boolean);
}

function colorForNorm(value) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  return CHOROPLETH[Math.min(CHOROPLETH.length - 1, Math.floor(v * CHOROPLETH.length))];
}

function createBoundaryLayerClass(L) {
  return class BoundaryLayer extends L.GridLayer {
    initialize(archive, options = {}) {
      L.GridLayer.prototype.initialize.call(this, {
        tileSize: TILE_SIZE,
        minZoom: BOUNDARY_MIN_ZOOM,
        maxZoom: BOUNDARY_MAX_ZOOM,
        minNativeZoom: BOUNDARY_MIN_ZOOM,
        maxNativeZoom: BOUNDARY_NATIVE_MAX_ZOOM,
        noWrap: true,
        updateWhenIdle: false,
        keepBuffer: 2,
        className: 'boundary-canvas',
        ...options
      });
      this.archive = archive;
      this.decoded = new Map();
      this.metricNormById = new Map();
      this.selectedId = null;
      this.hoveredId = null;
      this._lastZoom = null;
    }

    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      this._lastZoom = map.getZoom();
      this._zoomHandler = () => {
        const z = map.getZoom();
        if (z === this._lastZoom) return;
        this._lastZoom = z;
        this.redraw();
      };
      map.on('zoomend', this._zoomHandler);
    }

    onRemove(map) {
      if (this._zoomHandler) map.off('zoomend', this._zoomHandler);
      this._zoomHandler = null;
      L.GridLayer.prototype.onRemove.call(this, map);
    }

    displayScale(tileZoom) {
      const mapZoom = Number(this._map?.getZoom?.());
      return Number.isFinite(mapZoom) ? Math.max(1, 2 ** (mapZoom - tileZoom)) : 1;
    }

    async _getDecodedTile(z, x, y) {
      const key = `${z}/${x}/${y}`;
      if (!this.decoded.has(key)) {
        this.decoded.set(key, this.archive.getZxy(z, x, y).then(result => {
          if (!result) return [];
          const vt = new VectorTile(new Pbf(new Uint8Array(result.data)));
          const layer = vt.layers[SOURCE_LAYER];
          if (!layer) return [];
          const out = [];
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            if (f.type !== 3) continue;
            const properties = f.properties || {};
            if (normalizeText(properties.level) !== 'province') continue;
            out.push({ properties, geometry: f.loadGeometry(), extent: layer.extent || 4096 });
          }
          return out;
        }));
      }
      return this.decoded.get(key);
    }

    createTile(coords, done) {
      const tile = document.createElement('canvas');
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      tile.width = TILE_SIZE * ratio;
      tile.height = TILE_SIZE * ratio;
      tile.style.width = `${TILE_SIZE}px`;
      tile.style.height = `${TILE_SIZE}px`;
      const ctx = tile.getContext('2d');
      ctx.scale(ratio, ratio);
      this._getDecodedTile(coords.z, coords.x, coords.y)
        .then(features => {
          this._paint(ctx, TILE_SIZE, features, this.displayScale(coords.z));
          done(null, tile);
        })
        .catch(error => done(error, tile));
      return tile;
    }

    _paint(ctx, size, features, renderScale = 1) {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const scale = Math.max(1, renderScale);
      for (const f of features) {
        const id = String(f.properties?.id ?? '');
        const selected = id && id === String(this.selectedId ?? '');
        const hovered = id && id === String(this.hoveredId ?? '');
        const norm = this.metricNormById.get(id) ?? 0;
        ctx.beginPath();
        for (const ring of f.geometry) {
          if (!ring.length) continue;
          ring.forEach((pt, i) => {
            const x = pt.x / f.extent * size;
            const y = pt.y / f.extent * size;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fillStyle = colorForNorm(norm);
        ctx.globalAlpha = selected ? 0.46 : hovered ? 0.38 : 0.18;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = selected ? '#075985' : hovered ? '#0284c7' : '#66889c';
        ctx.lineWidth = (selected ? 2.8 : hovered ? 2.5 : 0.95) / scale;
        ctx.setLineDash(selected || hovered ? [] : [5 / scale, 3 / scale]);
        ctx.stroke();
      }
      ctx.restore();
    }

    setMetricValues(values) {
      this.metricNormById = new Map(Array.from(values || []).map(([k, v]) => [String(k), v]));
      this.redraw();
    }

    setSelected(id) {
      const next = id == null ? null : String(id);
      if (next === this.selectedId) return;
      this.selectedId = next;
      this.redraw();
    }

    setHovered(id) {
      const next = id == null ? null : String(id);
      if (next === this.hoveredId) return;
      this.hoveredId = next;
      this.redraw();
    }

    async featureAt(latlng, mapZoom, map) {
      const z = Math.min(BOUNDARY_NATIVE_MAX_ZOOM, Math.max(BOUNDARY_MIN_ZOOM, Math.round(mapZoom)));
      const projected = map.project(latlng, z);
      const x = Math.floor(projected.x / TILE_SIZE);
      const y = Math.floor(projected.y / TILE_SIZE);
      const features = await this._getDecodedTile(z, x, y);
      if (!features.length) return null;
      const extent = features[0].extent;
      const lx = (projected.x - x * TILE_SIZE) / TILE_SIZE * extent;
      const ly = (projected.y - y * TILE_SIZE) / TILE_SIZE * extent;
      for (let i = features.length - 1; i >= 0; i--) {
        if (pointInGeometry(lx, ly, features[i].geometry)) return features[i];
      }
      return null;
    }
  };
}

export class StatisticsMap {
  constructor(containerId, callbacks = {}) {
    this.containerId = containerId;
    this.callbacks = callbacks;
    this.provinces = [];
    this.metric = 'population';
    this.selectedId = null;
    this.selectedBoundaryId = null;
    this.hoverBoundaryId = null;
    this.boundaryRecords = [];
    this.boundaryProvinceRecords = [];
    this.boundaryById = new Map();
    this.boundary = null;
    this.popup = null;
    this.hoverSequence = 0;
    this.tileErrorCount = 0;
    this.renderer = 'leaflet';
    this.boundaryReady = Promise.resolve(false);
    this.ready = this.initialize();
  }

  async initialize() {
    const L = await loadLeaflet();
    this.L = L;
    const container = document.getElementById(this.containerId);
    if (!container) throw new Error(`Không tìm thấy #${this.containerId}.`);
    container.innerHTML = '';
    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      minZoom: 3,
      maxZoom: 18,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      worldCopyJump: false
    }).setView([VIETNAM_CENTER[1], VIETNAM_CENTER[0]], 4.75);
    this.baseLayer = L.tileLayer(TEDP_TILE_URL, {
      tileSize: 256,
      minZoom: 3,
      maxZoom: 18,
      maxNativeZoom: 18,
      noWrap: true,
      keepBuffer: 3,
      updateWhenIdle: false,
      attribution: 'Nguồn ảnh nền: TEDP (tedp.vn)'
    }).addTo(this.map);
    this.baseLayer.on('tileerror', event => {
      this.tileErrorCount += 1;
      if (this.tileErrorCount <= 3) console.warn('TEDP tile load error', event?.coords || event);
    });
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(this.map);
    this.map.createPane('boundaryPane');
    this.map.getPane('boundaryPane').style.zIndex = 410;
    this.boundaryReady = this.installBoundary().catch(error => {
      console.warn('Không nạp được ranh giới AnhMap:', error);
      return false;
    });
    this.map.on('mousemove', event => this.handlePointerMove(event));
    this.map.on('mouseout', () => this.clearBoundaryHover());
    this.map.on('click', event => this.handleMapClick(event));
    this.map.on('zoomstart movestart', () => this.removePopup());
    requestAnimationFrame(() => this.map.invalidateSize(false));
    setTimeout(() => this.map.invalidateSize(false), 180);
    return true;
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
    const archive = new PMTiles(new MemorySource(decodeBase64(pm.textContent)));
    await archive.getHeader();
    const BoundaryLayer = createBoundaryLayerClass(this.L);
    this.boundary = new BoundaryLayer(archive, { pane: 'boundaryPane', attribution: 'Ranh giới: Vietflexmap/anhmap' }).addTo(this.map);
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
    const properties = feature.properties || {};
    const record = properties.id != null ? this.boundaryById.get(String(properties.id)) : null;
    const values = [properties.name, properties.full_name, properties.province, properties.ten, record?.name, record?.full_name, record?.province, record?.ten].filter(Boolean).map(normalizeText);
    return this.provinces.find(province => {
      const names = [province.name, province.fullName].map(normalizeText).filter(Boolean);
      return values.some(value => names.some(name => value === name || value.endsWith(` ${name}`) || name.endsWith(` ${value}`)));
    }) || null;
  }

  syncBoundaryMetricStates() {
    if (!this.boundary || !this.provinces.length) return;
    const stats = getMetricStats(this.provinces, this.metric);
    const span = Math.max(1, stats.max - stats.min);
    const values = new Map();
    for (const province of this.provinces) {
      const record = this.boundaryRecordForProvince(province);
      if (!record || record.id == null) continue;
      const norm = Math.max(0, Math.min(1, (metricValue(province, this.metric) - stats.min) / span));
      values.set(String(record.id), norm);
    }
    this.boundary.setMetricValues(values);
  }

  syncSelectedBoundary() {
    if (!this.boundary) return;
    const province = this.provinces.find(p => p.id === this.selectedId);
    const record = this.boundaryRecordForProvince(province);
    this.selectedBoundaryId = record?.id != null ? String(record.id) : null;
    this.boundary.setSelected(this.selectedBoundaryId);
  }

  async handlePointerMove(event) {
    if (!this.boundary) return;
    const sequence = ++this.hoverSequence;
    try {
      const feature = await this.boundary.featureAt(event.latlng, this.map.getZoom(), this.map);
      if (sequence !== this.hoverSequence) return;
      if (!feature) return this.clearBoundaryHover();
      const id = String(feature.properties?.id ?? '');
      const province = this.provinceFromBoundaryFeature(feature);
      if (!id || !province) return this.clearBoundaryHover();
      if (this.hoverBoundaryId !== id) {
        this.hoverBoundaryId = id;
        this.boundary.setHovered(id);
        this.callbacks.onHover?.(province);
      }
      this.map.getContainer().style.cursor = 'pointer';
      this.showPopup(province, event.latlng);
    } catch (error) {
      console.warn('Boundary hover failed:', error);
    }
  }

  clearBoundaryHover() {
    this.hoverSequence += 1;
    if (this.hoverBoundaryId != null && this.boundary) this.boundary.setHovered(null);
    this.hoverBoundaryId = null;
    if (this.map) this.map.getContainer().style.cursor = '';
    this.callbacks.onHover?.(null);
    this.removePopup();
  }

  async handleMapClick(event) {
    if (!this.boundary) return;
    try {
      const feature = await this.boundary.featureAt(event.latlng, this.map.getZoom(), this.map);
      const province = feature && this.provinceFromBoundaryFeature(feature);
      if (province) this.callbacks.onSelect?.(province, { fromMap: true });
    } catch (error) {
      console.warn('Map identify failed:', error);
    }
  }

  async setData(provinces, metric = this.metric, selectedId = this.selectedId) {
    await this.ready;
    this.provinces = provinces;
    this.metric = metric;
    this.selectedId = selectedId;
    await this.boundaryReady;
    this.syncBoundaryMetricStates();
    this.syncSelectedBoundary();
    return this.getHealth();
  }

  setMetric(metric) {
    this.metric = metric;
    return this.setData(this.provinces, metric, this.selectedId);
  }

  select(province, zoom = true) {
    this.selectedId = province?.id ?? null;
    this.syncSelectedBoundary();
    if (!province || !zoom || !this.map) return;
    if (Array.isArray(province.bbox) && province.bbox.length >= 4) {
      const [minX, minY, maxX, maxY] = province.bbox.map(Number);
      if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
        this.map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [72, 72], maxZoom: 7.4, animate: true, duration: 0.75 });
        return;
      }
    }
    if (Number.isFinite(province.lon) && Number.isFinite(province.lat)) {
      this.map.flyTo([province.lat, province.lon], Math.max(this.map.getZoom(), 6.25), { duration: 0.75 });
    }
  }

  reset() {
    if (!this.map) return;
    this.clearBoundaryHover();
    this.map.fitBounds([[VIETNAM_BOUNDS[0][1], VIETNAM_BOUNDS[0][0]], [VIETNAM_BOUNDS[1][1], VIETNAM_BOUNDS[1][0]]], { padding: [28, 28], animate: true, duration: 0.65 });
  }

  metricRank(province) {
    const sorted = [...this.provinces].sort((a, b) => metricValue(b, this.metric) - metricValue(a, this.metric));
    return sorted.findIndex(p => p.id === province.id) + 1;
  }

  showPopup(province, latlng) {
    if (!this.L || !this.map) return;
    const rank = this.metricRank(province);
    const metricLabel = this.metric === 'population' ? 'dân số' : this.metric === 'area' ? 'diện tích' : 'mật độ';
    const html = `<div class="map-popup-rich"><div class="popup-kicker">${province.type} · Xếp hạng #${rank || '—'} theo ${metricLabel}</div><div class="popup-title">${province.name}</div><div class="popup-metrics"><div><span>Dân số</span><b>${formatMetric(province.population, 'population')}</b><small>người</small></div><div><span>Diện tích</span><b>${formatMetric(province.area, 'area')}</b><small>km²</small></div><div><span>Mật độ</span><b>${formatMetric(province.density, 'density')}</b><small>người/km²</small></div></div><div class="popup-hint">Nhấp để cố định tỉnh và zoom chi tiết</div></div>`;
    if (!this.popup) this.popup = this.L.popup({ closeButton: false, autoPan: false, className: 'vietflex-popup', offset: [0, -5] });
    this.popup.setLatLng(latlng).setContent(html);
    if (!this.map.hasLayer(this.popup)) this.popup.openOn(this.map);
  }

  removePopup() {
    if (this.popup && this.map?.hasLayer(this.popup)) this.map.closePopup(this.popup);
  }

  getHealth() {
    return { renderer: this.renderer, basemap: 'Vietflex TEDP', boundary: Boolean(this.boundary), tileErrors: this.tileErrorCount };
  }
}
