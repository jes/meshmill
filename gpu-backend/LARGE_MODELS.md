# Большие модели: стратегия обработки

Проблема: STL вроде «Николай чудотворец» (~15M треугольников) вешает
Electron/THREE и CPU-`pngcam`, потому что весь mesh живёт в JS heap и
растеризуется однопоточно.

## Целевая схема (три слоя)

### 1. Proxy preview (UI)

- При открытии: быстрый probe (`stl-info`) → число треугольников / AABB.
- Если tris > ~500k: **не** грузить полный mesh в THREE.
  - Вариант A: встроенный decimate (quadric / edge-collapse) → proxy STL ≤ 200–400k.
  - Вариант B: voxel / octree downsample только для превью.
- Полный STL остаётся на диске; UI показывает proxy + AABB заготовки.

### 2. Out-of-core heightmap (GPU backend)

- Memory-map binary STL; читать треугольники **батчами** (256k–1M).
- Каждый батч → GPU buffer → compute rasterize в общий R32Float Z-buffer
  (atomicMax / depth compare).
- После всех батчей: скачать Z-buffer → 24-bit PNG (как pngcam).
- Память Electron ≈ O(proxy), память GPU ≈ O(W×H) + один батч треугольников.

### 3. Toolpath без повторной загрузки mesh

- Вход — только heightmap + параметры инструмента.
- Offset (ball/flat) — convolution / local max на GPU по тайлам heightmap.
- Scanline G-code: step-over ряды; при огромных картах — тайлы по Y,
  склейка сегментов на CPU.

## Пороги (рабочие)

| Tris / размер | Поведение (реализовано) |
|---------------|-----------|
| &lt; 400k | полный mesh в UI + CAM |
| 400k – 2M | авто-decimate превью (~400k); полный STL → `mesh-full.stl` для heightmap |
| 2M – 80M | confirm; то же (proxy + full CAM) |
| &gt; 80M или &gt; 1.5 GB | hard refuse |

## Что уже есть в Meshmill

- `stl-info` + soft/hard limits в `js/project.js`.
- GPU hardware acceleration для Three.js preview.
- Этот каталог: GPU heightmap/toolpath CLI с batched STL upload.

## Следующие шаги интеграции

1. IPC `render-heightmap` → опционально `gpu-backend` вместо `pngcam-go-render`.
2. Фоновый decimate при open (worker / отдельный процесс).
3. Сравнение PNG/G-code с `pngcam-go` на регрессионных моделях.
4. Не упаковывать `.venv` в AppImage; собирать frozen binary (`pyinstaller`
   или позже Rust/wgpu) когда алгоритм стабилен.
