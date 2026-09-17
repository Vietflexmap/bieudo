import { DATA_SOURCES } from './config.js';

const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function provinceType(value = '') {
  const text = normalizeText(value);
  return text.includes('tinh') ? 'Tỉnh' : 'Thành phố';
}

function centerFromBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return [null, null];
  const [minX, minY, maxX, maxY] = bbox.map(Number);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [null, null];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function normalizeProvince(row, index) {
  const area = numberOrNull(row.area_km2 ?? row.area ?? row.dien_tich);
  const population = numberOrNull(row.population_2025 ?? row.population ?? row.dan_so);
  const densityInput = numberOrNull(row.density ?? row.mat_do);
  const density = densityInput ?? (area && population !== null ? population / area : null);
  const bbox = Array.isArray(row.bbox) ? row.bbox.map(Number) : null;
  const [bboxLon, bboxLat] = centerFromBbox(bbox);
  const lon = numberOrNull(row.centroid_lon ?? row.lon ?? row.longitude) ?? bboxLon;
  const lat = numberOrNull(row.centroid_lat ?? row.lat ?? row.latitude) ?? bboxLat;

  const rawName = row.name ?? row.ten_short ?? row.ten ?? row.full_name ?? `Tỉnh ${index + 1}`;
  const fullName = row.full_name ?? row.ten ?? rawName;

  return {
    id: row.id ?? `p:${String(index + 1).padStart(2, '0')}`,
    order: numberOrNull(row.order) ?? index + 1,
    code: String(row.code ?? row.ma ?? ''),
    name: String(rawName).replace(/^(Thủ đô|Thành phố|Tỉnh)\s+/i, '').trim(),
    fullName: String(fullName),
    type: provinceType(row.type ?? fullName),
    population,
    area,
    density,
    lon,
    lat,
    bbox,
    communeCount: numberOrNull(row.commune_level_count),
    mergedFrom: row.merge_origin ?? row.predecessors ?? null,
    administrativeCenter: row.administrative_center ?? row.capital ?? row.address ?? null,
    resolution: row.resolution ?? row.decree ?? null
  };
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.provinces)) {
    throw new Error('admin.json không có mảng provinces.');
  }
  if (payload.provinces.length !== 34) {
    throw new Error(`Cần 34 tỉnh/thành, nhận ${payload.provinces.length}.`);
  }
  return payload;
}

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadProvinceData() {
  const errors = [];
  for (const source of DATA_SOURCES) {
    try {
      const payload = validatePayload(await fetchJson(source.url));
      const provinces = payload.provinces.map(normalizeProvince)
        .sort((a, b) => a.order - b.order);
      const usable = provinces.filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat));
      if (usable.length < 30) throw new Error(`Chỉ ${usable.length}/34 tỉnh có centroid hợp lệ.`);
      return { provinces, payload, source };
    } catch (error) {
      errors.push(`${source.label}: ${error?.message || error}`);
    }
  }
  throw new Error(errors.join(' · '));
}

export function nationalSummary(provinces) {
  const population = provinces.reduce((sum, p) => sum + (p.population || 0), 0);
  const area = provinces.reduce((sum, p) => sum + (p.area || 0), 0);
  const density = area > 0 ? population / area : 0;
  const cities = provinces.filter(p => p.type === 'Thành phố').length;
  return { population, area, density, cities, provinces: provinces.length };
}

export function metricValue(province, metric) {
  return Number(province?.[metric]) || 0;
}

export function formatMetric(value, metric, compact = false) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (compact && metric === 'population') {
    if (Math.abs(n) >= 1_000_000) return `${nf1.format(n / 1_000_000)} tr`;
    if (Math.abs(n) >= 1_000) return `${nf1.format(n / 1_000)} nghìn`;
  }
  if (compact && metric === 'area' && Math.abs(n) >= 1_000) {
    return `${nf1.format(n / 1_000)} nghìn`;
  }
  return nf0.format(n);
}

export function formatNumber(value) {
  return Number.isFinite(Number(value)) ? nf0.format(Number(value)) : '—';
}

export function sortedBy(provinces, metric, direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...provinces].sort((a, b) => (metricValue(a, metric) - metricValue(b, metric)) * sign);
}

export function getMetricStats(provinces, metric) {
  const values = provinces.map(p => metricValue(p, metric)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    min: values[0] ?? 0,
    max: values[values.length - 1] ?? 0,
    median: values[Math.floor(values.length / 2)] ?? 0
  };
}
