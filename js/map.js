import { TEDP_STYLE, VIETNAM_BOUNDS, VIETNAM_CENTER } from './config.js';
import { metricValue, getMetricStats, formatMetric } from './data.js';

const PALETTE = ['#71d7ff', '#4fc2ee', '#28acd9', '#188bc0', '#0c67a6'];

function valueClass(value, min, max) {
  if (!Number.isFinite(value) || max <= min) return 2;
  const t = (value - min) / (max - min);
  return Math.max(0, Math.min(4, Math.floor(t * 5)));
}

function bubbleRadius(value, min, max) {
  if (!Number.isFinite(value) || value <= 0) return 8;
  if (max <= min) return 17;
  const t = Math.sqrt((value - min) / (max - min));
  return 8 + Math.max(0, Math.min(1, t)) * 20;
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

export class StatisticsMap {
  constructor(containerId, callbacks = {}) {
    if (!window.maplibregl) throw new Error('MapLibre GL chưa tải được.');
    this.callbacks = callbacks;
    this.provinces = [];
    this.metric = 'population';
    this.selectedId = null;
    this.popup = null;

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
        'circle-radius': ['+', ['get', 'radius'], ['case', ['==', ['get', 'selected'], 1], 8, 4]],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.16,
        'circle-blur': 0.3
      }
    });

    this.map.addLayer({
      id: 'province-bubbles',
      type: 'circle',
      source: 'province-stats',
      paint: {
        'circle-radius': ['+', ['get', 'radius'], ['case', ['==', ['get', 'selected'], 1], 3, 0]],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.78,
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', 'rgba(255,255,255,.82)'],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 1.25]
      }
    });

    for (const layerId of ['province-bubbles']) {
      this.map.on('mouseenter', layerId, () => { this.map.getCanvas().style.cursor = 'pointer'; });
      this.map.on('mouseleave', layerId, () => { this.map.getCanvas().style.cursor = ''; });
      this.map.on('click', layerId, event => {
        const feature = event.features?.[0];
        if (!feature) return;
        const province = this.provinces.find(p => p.id === feature.properties?.id);
        if (province) this.callbacks.onSelect?.(province, { fromMap: true });
      });
    }

    this.map.on('mousemove', 'province-bubbles', event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const province = this.provinces.find(p => p.id === feature.properties?.id);
      if (!province) return;
      this.showPopup(province, event.lngLat);
    });
    this.map.on('mouseleave', 'province-bubbles', () => this.removePopup());
  }

  async setData(provinces, metric = this.metric, selectedId = this.selectedId) {
    await this.ready;
    this.provinces = provinces;
    this.metric = metric;
    this.selectedId = selectedId;
    const source = this.map.getSource('province-stats');
    source?.setData(toGeoJson(provinces, metric, selectedId));
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
        this.map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 90, maxZoom: 7.4, duration: 900 });
        return;
      }
    }
    if (Number.isFinite(province.lon) && Number.isFinite(province.lat)) {
      this.map.easeTo({ center: [province.lon, province.lat], zoom: Math.max(this.map.getZoom(), 6.2), duration: 900 });
    }
  }

  reset() {
    this.map.fitBounds(VIETNAM_BOUNDS, { padding: 34, duration: 800 });
  }

  showPopup(province, lngLat) {
    this.removePopup();
    const html = `
      <div class="map-popup">
        <b>${province.name}</b>
        <span>${formatMetric(province.population, 'population')} người</span>
        <span>${formatMetric(province.area, 'area')} km² · ${formatMetric(province.density, 'density')} người/km²</span>
      </div>`;
    this.popup = new window.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 18, className: 'vietflex-popup' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(this.map);
  }

  removePopup() {
    this.popup?.remove();
    this.popup = null;
  }
}
