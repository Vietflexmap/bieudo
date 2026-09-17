import { METRICS } from './config.js';
import { formatMetric, sortedBy } from './data.js';

const axisColor = 'rgba(191, 211, 229, .30)';
const textColor = '#bdd0df';
const accent = '#43c8f5';

function getEcharts() {
  if (!window.echarts) throw new Error('ECharts chưa tải được.');
  return window.echarts;
}

export class DashboardCharts {
  constructor(rankingEl, scatterEl, onSelect) {
    const echarts = getEcharts();
    this.ranking = echarts.init(rankingEl, null, { renderer: 'canvas' });
    this.scatter = echarts.init(scatterEl, null, { renderer: 'canvas' });
    this.onSelect = onSelect;
    this.provinces = [];
    this.metric = 'population';
    this.showAll = false;

    this.ranking.on('click', params => {
      const province = this.provinces.find(p => p.id === params.data?.id);
      if (province) this.onSelect?.(province);
    });
    this.scatter.on('click', params => {
      const province = this.provinces.find(p => p.id === params.data?.id);
      if (province) this.onSelect?.(province);
    });

    window.addEventListener('resize', () => this.resize());
  }

  setData(provinces, metric, showAll = this.showAll) {
    this.provinces = provinces;
    this.metric = metric;
    this.showAll = showAll;
    this.renderRanking();
    this.renderScatter();
  }

  setShowAll(value) {
    this.showAll = Boolean(value);
    this.renderRanking();
  }

  renderRanking() {
    const metric = this.metric;
    const rows = sortedBy(this.provinces, metric).slice(0, this.showAll ? 34 : 12).reverse();
    const values = rows.map(p => Number(p[metric]) || 0);
    const max = Math.max(...values, 1);

    this.ranking.setOption({
      animationDuration: 550,
      grid: { left: 12, right: 18, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: '#101c2a', borderColor: 'rgba(255,255,255,.12)',
        textStyle: { color: '#eef8ff' },
        formatter: params => {
          const item = params?.[0]?.data;
          return item ? `<b>${item.name}</b><br>${METRICS[metric].label}: ${formatMetric(item.value, metric)} ${METRICS[metric].unit}` : '';
        }
      },
      xAxis: {
        type: 'value', max: max * 1.06,
        axisLabel: { color: textColor, fontSize: 10, formatter: v => compactAxis(v, metric) },
        splitLine: { lineStyle: { color: axisColor, type: 'dashed' } },
        axisLine: { show: false }, axisTick: { show: false }
      },
      yAxis: {
        type: 'category', data: rows.map(p => p.name),
        axisLabel: { color: '#e6f3fb', width: 94, overflow: 'truncate', fontSize: 11 },
        axisLine: { show: false }, axisTick: { show: false }
      },
      series: [{
        type: 'bar', barMaxWidth: 13, showBackground: true,
        backgroundStyle: { color: 'rgba(255,255,255,.035)', borderRadius: 8 },
        itemStyle: {
          borderRadius: [0, 8, 8, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [{ offset: 0, color: '#1a7cae' }, { offset: 1, color: '#55d6ff' }]
          }
        },
        emphasis: { itemStyle: { shadowBlur: 14, shadowColor: 'rgba(67,200,245,.35)' } },
        data: rows.map(p => ({ id: p.id, name: p.name, value: Number(p[metric]) || 0 }))
      }]
    }, true);
  }

  renderScatter() {
    const data = this.provinces
      .filter(p => Number.isFinite(p.area) && Number.isFinite(p.population))
      .map(p => ({ id: p.id, name: p.name, value: [p.area, p.population, p.density || 0] }));
    const maxDensity = Math.max(...data.map(d => d.value[2]), 1);

    this.scatter.setOption({
      animationDuration: 650,
      grid: { left: 15, right: 18, top: 12, bottom: 10, containLabel: true },
      tooltip: {
        trigger: 'item', backgroundColor: '#101c2a', borderColor: 'rgba(255,255,255,.12)', textStyle: { color: '#eef8ff' },
        formatter: ({ data: d }) => `<b>${d.name}</b><br>Dân số: ${formatMetric(d.value[1], 'population')} người<br>Diện tích: ${formatMetric(d.value[0], 'area')} km²<br>Mật độ: ${formatMetric(d.value[2], 'density')} người/km²`
      },
      xAxis: {
        name: 'Diện tích (km²)', nameTextStyle: { color: textColor, fontSize: 10 }, type: 'value',
        axisLabel: { color: textColor, fontSize: 10 }, splitLine: { lineStyle: { color: axisColor, type: 'dashed' } },
        axisLine: { lineStyle: { color: axisColor } }, axisTick: { show: false }
      },
      yAxis: {
        name: 'Dân số', nameTextStyle: { color: textColor, fontSize: 10 }, type: 'value',
        axisLabel: { color: textColor, fontSize: 10, formatter: v => compactAxis(v, 'population') },
        splitLine: { lineStyle: { color: axisColor, type: 'dashed' } }, axisLine: { lineStyle: { color: axisColor } }, axisTick: { show: false }
      },
      series: [{
        type: 'scatter', data,
        symbolSize: value => 8 + Math.sqrt(Math.max(0, value[2]) / maxDensity) * 25,
        itemStyle: { color: accent, opacity: 0.74, borderColor: '#dff7ff', borderWidth: 1 },
        emphasis: { scale: 1.35, itemStyle: { opacity: 1, borderWidth: 2 } }
      }]
    }, true);
  }

  resize() { this.ranking.resize(); this.scatter.resize(); }
}

function compactAxis(value, metric) {
  const n = Number(value) || 0;
  if (metric === 'population') {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}tr`;
    if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  }
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}
