# Vietflex WebGIS Statistics — 34 tỉnh/thành sau sáp nhập

Dashboard WebGIS thống kê **34 tỉnh/thành Việt Nam sau sáp nhập**, được tái cấu trúc từ ý tưởng trực quan hóa của project `bieudo` và tối ưu để chạy trực tiếp trên GitHub Pages.

## Mục tiêu kiến trúc

- **Chỉ một lớp nền:** `Vietflex TEDP` từ `Vietflexmap/openmap`.
- **Nguồn thống kê:** `Vietflexmap/sapnhap/data/admin.json`.
- **Chỉ tiêu:** dân số, diện tích, mật độ dân số.
- **WebGIS:** MapLibre GL JS, lớp bubble thống kê theo centroid tỉnh/thành, zoom theo bbox, tooltip và chọn tỉnh trực tiếp trên bản đồ.
- **Dashboard:** KPI quốc gia, Top 12/34, scatter dân số × diện tích, bảng 34 tỉnh/thành có sort/search.
- **Deploy:** HTML/CSS/ES Modules thuần, không cần bước build.

## Cấu trúc

```text
index.html
styles.css
js/
  config.js      # TEDP + URL nguồn dữ liệu + cấu hình metric
  data.js        # tải/chuẩn hóa/kiểm tra admin.json
  map.js         # MapLibre + Vietflex TEDP + lớp thống kê
  charts.js      # ECharts ranking + scatter
  app.js         # state + UI + kết nối map/chart/table
```

## Nguồn dữ liệu

Ứng dụng thử lần lượt:

1. `https://vietflexmap.github.io/sapnhap/data/admin.json`
2. `https://raw.githubusercontent.com/Vietflexmap/sapnhap/main/data/admin.json`

Schema được chuẩn hóa theo `provinces[]` của dự án `Vietflexmap/sapnhap`. Mật độ ưu tiên giá trị `density` từ nguồn; nếu thiếu thì tính `population / area_km2`.

## Nền Vietflex TEDP

```js
{
  type: 'raster',
  tiles: ['https://tedp.vn/api/map/proxy-tile/{z}/{x}/{y}'],
  tileSize: 256,
  minzoom: 3,
  maxzoom: 18
}
```

Không cấu hình OSM, Google, Esri hay basemap phụ.

## Chạy local

Vì đây là static site, chỉ cần một HTTP server:

```bash
python -m http.server 8080
```

Mở `http://localhost:8080`.

## GitHub Pages

Vào **Settings → Pages → Deploy from a branch → `main` / root**.

## Lưu ý vận hành

TEDP là nguồn tile trực tuyến bên ngoài. Cần duy trì attribution và kiểm tra điều khoản/quyền sử dụng khi triển khai thương mại hoặc tái phân phối/cache tile quy mô lớn.
