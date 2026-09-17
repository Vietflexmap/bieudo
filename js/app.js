import { METRICS } from './config.js';
import { loadProvinceData, nationalSummary, formatMetric, formatNumber, sortedBy, getMetricStats, normalizeText } from './data.js';
import { StatisticsMap } from './map.js';
import { DashboardCharts } from './charts.js';

const $ = id => document.getElementById(id);
const state = {
  provinces: [], metric: 'population', selected: null, hovered: null, rankingAll: false,
  sort: { key: 'population', direction: 'desc' }, source: null
};
let map;
let charts;

function setStatus(text, kind = '') {
  $('dataStatus').innerHTML = `<span class="status-dot ${kind}"></span>${escapeHtml(text)}`;
}
function showToast(message, timeout = 3200) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(showToast._timer); showToast._timer = setTimeout(() => el.classList.remove('show'), timeout);
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

function setActiveMetric(metric) {
  if (!METRICS[metric]) return;
  state.metric = metric;
  document.querySelectorAll('[data-metric]').forEach(button => button.classList.toggle('active', button.dataset.metric === metric));
  $('rankingTitle').textContent = `${state.rankingAll ? '34 tỉnh/thành' : 'Top 12'} theo ${METRICS[metric].label.toLowerCase()}`;
  renderLegend(); renderTable(); renderFocusCard();
  charts?.setData(state.provinces, metric, state.rankingAll);
  const pending = map?.setMetric(metric);
  if (pending?.catch) pending.catch(error => console.warn('Không cập nhật được chỉ tiêu trên bản đồ:', error));
}

function renderSummary() {
  const s = nationalSummary(state.provinces);
  $('kpiProvinces').textContent = formatNumber(s.provinces);
  $('kpiProvinceTypes').textContent = `${s.cities} thành phố · ${s.provinces - s.cities} tỉnh`;
  $('kpiPopulation').textContent = formatMetric(s.population, 'population', true);
  $('kpiArea').textContent = formatMetric(s.area, 'area', true);
  $('kpiDensity').textContent = formatMetric(s.density, 'density');
  $('recordCount').textContent = `${state.provinces.length} bản ghi`;
}
function renderLegend() {
  if (!state.provinces.length) return;
  const stats = getMetricStats(state.provinces, state.metric);
  $('legendTitle').textContent = METRICS[state.metric].label;
  $('legendMin').textContent = formatMetric(stats.min, state.metric, true);
  $('legendMax').textContent = formatMetric(stats.max, state.metric, true);
}
function renderFocusCard() {
  const card = $('selectedMapCard');
  const p = state.hovered || state.selected;
  if (!p) { card.hidden = true; return; }
  card.hidden = false;
  card.classList.toggle('hover-preview', Boolean(state.hovered));
  $('selectedType').textContent = state.hovered ? `${p.type} · đang rê chuột` : `${p.type} · đã chọn`;
  $('selectedName').textContent = p.name;
  $('selectedPopulation').textContent = `${formatMetric(p.population, 'population', true)} người`;
  $('selectedArea').textContent = `${formatMetric(p.area, 'area')} km²`;
  $('selectedDensity').textContent = `${formatMetric(p.density, 'density')} người/km²`;
}
function selectProvince(province, options = {}) {
  if (!province) return;
  state.selected = province; state.hovered = null; renderFocusCard(); renderTable();
  map?.select(province, options.zoom !== false);
  if (options.toast) showToast(`Đã chọn ${province.name}`);
}
function hoverProvince(province) {
  state.hovered = province || null;
  renderFocusCard();
}
function renderTable() {
  const { key, direction } = state.sort;
  const rows = sortedBy(state.provinces, key, direction);
  $('provinceTable').innerHTML = rows.map((p, i) => `
    <tr data-id="${escapeHtml(p.id)}" class="${state.selected?.id === p.id ? 'selected' : ''}" tabindex="0">
      <td>${i + 1}</td><td><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.type)}</small></td>
      <td>${formatMetric(p.population, 'population')}</td><td>${formatMetric(p.area, 'area')}</td><td>${formatMetric(p.density, 'density')}</td>
    </tr>`).join('');
}
function populateSearch() {
  $('provinceOptions').innerHTML = state.provinces.map(p => `<option value="${escapeHtml(p.name)}"></option>`).join('');
}
function selectBySearch(value) {
  const needle = normalizeText(value); if (!needle) return;
  const exact = state.provinces.find(p => normalizeText(p.name) === needle || normalizeText(p.fullName) === needle);
  const partial = state.provinces.find(p => normalizeText(p.name).includes(needle));
  const p = exact || partial;
  if (!p) return showToast('Không tìm thấy tỉnh/thành phù hợp.');
  $('provinceSearch').value = p.name; selectProvince(p, { toast: true });
}

function bindUi() {
  $('metricSwitch').addEventListener('click', event => {
    const button = event.target.closest('[data-metric]'); if (button) setActiveMetric(button.dataset.metric);
  });
  $('resetMap').addEventListener('click', () => map?.reset());
  $('provinceSearch').addEventListener('change', event => selectBySearch(event.target.value));
  $('provinceSearch').addEventListener('keydown', event => { if (event.key === 'Enter') selectBySearch(event.currentTarget.value); });
  $('toggleRanking').addEventListener('click', () => {
    state.rankingAll = !state.rankingAll;
    $('toggleRanking').textContent = state.rankingAll ? 'Thu gọn Top 12' : 'Xem 34 tỉnh';
    $('rankingTitle').textContent = `${state.rankingAll ? '34 tỉnh/thành' : 'Top 12'} theo ${METRICS[state.metric].label.toLowerCase()}`;
    $('rankingChart').classList.toggle('expanded', state.rankingAll);
    charts?.setShowAll(state.rankingAll); setTimeout(() => charts?.resize(), 80);
  });
  document.querySelector('.table-card').addEventListener('click', event => {
    const sort = event.target.closest('[data-sort]');
    if (sort) {
      const key = sort.dataset.sort;
      if (state.sort.key === key) state.sort.direction = state.sort.direction === 'desc' ? 'asc' : 'desc';
      else state.sort = { key, direction: 'desc' };
      renderTable(); return;
    }
    const row = event.target.closest('tr[data-id]');
    if (row) { const p = state.provinces.find(item => item.id === row.dataset.id); if (p) selectProvince(p); }
  });
  document.querySelector('.table-card').addEventListener('keydown', event => {
    const row = event.target.closest('tr[data-id]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); const p = state.provinces.find(item => item.id === row.dataset.id); if (p) selectProvince(p);
    }
  });
}

async function boot() {
  bindUi();
  try {
    map = new StatisticsMap('map', {
      onSelect: p => selectProvince(p, { zoom: false }),
      onHover: p => hoverProvince(p)
    });
  } catch (error) {
    console.error('Map constructor failed:', error);
    map = null;
  }
  try { charts = new DashboardCharts($('rankingChart'), $('scatterChart'), p => selectProvince(p)); }
  catch (error) {
    console.error(error);
    document.querySelectorAll('.chart').forEach(el => { el.innerHTML = '<div class="chart-fallback">Không tải được thư viện biểu đồ.</div>'; });
  }

  let loaded;
  try {
    loaded = await loadProvinceData();
  } catch (error) {
    console.error(error);
    setStatus('Không tải được dữ liệu thống kê', 'error');
    $('sourceDetail').textContent = error?.message || String(error);
    showToast('Không tải được admin.json từ Vietflexmap/sapnhap.', 5200);
    return;
  }

  state.provinces = loaded.provinces; state.source = loaded.source;
  renderSummary(); populateSearch(); renderLegend(); renderTable();
  charts?.setData(state.provinces, state.metric, false);
  $('sourceDetail').textContent = `Thống kê: ${loaded.source.label}. Ranh giới: Vietflexmap/anhmap. Nền: Vietflex TEDP.`;

  if (!map) {
    setStatus('Dữ liệu sẵn sàng · bản đồ chưa khởi tạo', 'error');
    showToast('Không khởi tạo được bản đồ. Dashboard thống kê vẫn hoạt động.', 5200);
    return;
  }

  try {
    const health = await map.setData(state.provinces, state.metric);
    map.reset();
    if (health?.boundary) {
      setStatus(`TEDP + AnhMap sẵn sàng · ${health.renderer}`, 'ok');
    } else {
      setStatus('TEDP sẵn sàng · ranh giới AnhMap chưa nạp', 'loading');
    }
    if (health?.tileErrors > 0) console.warn(`TEDP phát sinh ${health.tileErrors} lỗi tile lúc khởi tạo.`);
  } catch (error) {
    console.error('Map initialization failed:', error);
    setStatus('Dữ liệu sẵn sàng · bản đồ đang lỗi', 'error');
    $('sourceDetail').textContent = `Dữ liệu thống kê đã tải. Lỗi bản đồ: ${error?.message || error}`;
    showToast('Bản đồ không khởi tạo được. Hãy Ctrl+F5; dữ liệu thống kê vẫn an toàn.', 6200);
  }
}
boot();
