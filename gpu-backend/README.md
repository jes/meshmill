# Meshmill GPU backend

Отдельный бэкенд для heightmap и toolpath на GPU (Vulkan / WebGPU через `wgpu`).
Не вшит в Electron AppImage — живёт рядом и вызывается CLI, чтобы можно было
откатить без трогания основного `pngcam-go`.

Машина разработки: AMD Radeon (RADV / Renoir). CUDA не требуется.

## Зачем

| Этап | Сейчас (CPU) | GPU-бэкенд |
|------|--------------|------------|
| STL → heightmap | `pngcam-go-render` | растеризация треугольников в Z-буфер на compute |
| heightmap → G-code | `pngcam-go` | морфологический offset инструмента + scanline |
| Превью в UI | THREE.js грузит весь STL | LOD / proxy-mesh (см. LARGE_MODELS.md) |

## Быстрый старт

```bash
cd gpu-backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m meshmill_gpu.cli device
.venv/bin/python -m meshmill_gpu.cli render model.stl --width 800 --height 600 --png out.png
.venv/bin/python -m meshmill_gpu.cli toolpath out.png \
  --width-mm 100 --height-mm 80 --depth-mm 10 \
  --tool-diameter 6 --tool-shape ball --step-over 1.5 \
  --xy-feed 400 --z-feed 50 --gcode out.nc
```

Флаги подогнаны под подмножество `pngcam-go` / `pngcam-go-render`, чтобы потом
подключить из `main.js` без смены контракта IPC.

## Архитектура

```
STL (mm) ──► [chunked upload] ──► GPU Z-buffer (R32Float)
                                      │
                                      ▼
                               24-bit PNG heightmap
                                      │
                                      ▼
                         GPU tool offset (ball / flat)
                                      │
                                      ▼
                            scanline G1 / rapids → NC
```

Большие модели: треугольники грузятся батчами (по умолчанию 262 144), Z-буфер
остаётся на GPU; Electron не обязан держать полный mesh. Подробности —
`LARGE_MODELS.md`.

## Интеграция в Meshmill

- Бинарник: `bin/meshmill-gpu` (PyInstaller), вызывается из `main.js`.
- Настройка: **Параметры → Бэкенд CAM → GPU / CPU**.
- GPU по умолчанию: heightmap, step-down roughing, finish, read/write-stock.
- `decimate` CLI — авто-упрощение превью при открытии огромных STL.
- `dxf` / `cad` — импорт DXF; DWG через `dwg2dxf` (LibreDWG) или ODA.
- `profile-outside` / `profile-inside` / `pocket` — обрезка, профиль изнутри, выборка.
- Rotary / ramp / beyond-edges / deep-black → откат на `pngcam-go`.
- Сборка бинарника: `./scripts/build-binary.sh` (нужен `.venv`).

## Статус

MVP: рабочий CLI + вшит в AppImage с откатом на `pngcam-go`.
