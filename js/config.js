export const TEDP_TILE_URL = 'https://tedp.vn/api/map/proxy-tile/{z}/{x}/{y}';

export const TEDP_STYLE = {
  version: 8,
  name: 'Vietflex TEDP',
  sources: {
    'vietflex-tedp': {
      type: 'raster',
      tiles: [TEDP_TILE_URL],
      tileSize: 256,
      minzoom: 3,
      maxzoom: 18,
      attribution: 'Nguồn ảnh nền: TEDP (tedp.vn)'
    }
  },
  layers: [
    {
      id: 'vietflex-tedp',
      type: 'raster',
      source: 'vietflex-tedp',
      minzoom: 0,
      maxzoom: 24,
      paint: {
        'raster-opacity': 0.96,
        'raster-saturation': -0.22,
        'raster-contrast': -0.03,
        'raster-brightness-min': 0.05,
        'raster-brightness-max': 1
      }
    }
  ]
};

export const ANHMAP_SOURCES = [
  'https://vietflexmap.github.io/anhmap/index.html',
  'https://cdn.jsdelivr.net/gh/Vietflexmap/anhmap@main/index.html'
];

export const DATA_SOURCES = [
  {
    label: 'Vietflexmap/sapnhap · GitHub Pages',
    url: 'https://vietflexmap.github.io/sapnhap/data/admin.json'
  },
  {
    label: 'Vietflexmap/sapnhap · raw GitHub',
    url: 'https://raw.githubusercontent.com/Vietflexmap/sapnhap/main/data/admin.json'
  }
];

export const VIETNAM_BOUNDS = [[102.05, 8.15], [109.55, 23.65]];
export const VIETNAM_CENTER = [106.0, 16.35];

export const METRICS = {
  population: {
    key: 'population',
    label: 'Dân số',
    unit: 'người',
    shortUnit: 'người',
    decimals: 0
  },
  area: {
    key: 'area',
    label: 'Diện tích',
    unit: 'km²',
    shortUnit: 'km²',
    decimals: 0
  },
  density: {
    key: 'density',
    label: 'Mật độ dân số',
    unit: 'người/km²',
    shortUnit: 'người/km²',
    decimals: 0
  }
};
