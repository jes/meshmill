#!/bin/sh
set -e
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/pyinstaller ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt pyinstaller
fi
.venv/bin/pyinstaller --onefile --name meshmill-gpu --clean -y \
  --collect-all wgpu \
  --hidden-import PIL \
  --hidden-import PIL.Image \
  --add-data 'meshmill_gpu/shaders:meshmill_gpu/shaders' \
  meshmill_gpu_main.py
cp -f dist/meshmill-gpu ../bin/meshmill-gpu
chmod +x ../bin/meshmill-gpu
ls -lh ../bin/meshmill-gpu
