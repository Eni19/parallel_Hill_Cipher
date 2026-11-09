#!/bin/bash
# Copia o projeto do Windows para o disco do WSL e compila as duas versoes (CPU e CUDA).
# Uso, no Windows:  wsl -d Ubuntu -- bash preparar_wsl.sh
# Rodar a partir de ~/pcd evita medir o compartilhamento de arquivos /mnt/c, que e lento.
# Requer no Ubuntu: sudo apt install ffmpeg nvidia-cuda-toolkit rsync g++-13
set -e
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
DESTINO="${DESTINO:-$HOME/pcd}"
export NVCC_CCBIN="${NVCC_CCBIN:-g++-13}"  # o CUDA 12.4 do Ubuntu nao aceita o GCC 15

mkdir -p "$DESTINO"
rsync -a --delete --exclude .git --exclude video_lab --exclude resultados --exclude '*.exe' \
      --exclude __pycache__ --exclude HillCypherCode/hcOMP "$ORIGEM/" "$DESTINO/"
git -C "$ORIGEM" describe --always --dirty > "$DESTINO/.commit" 2>/dev/null || true

cd "$DESTINO"
gcc -O2 -std=c11 -fopenmp -Wall -Wextra HillCypherCode/video_hill.c -o video_hill
rm -f video_lab/image_hill_cuda  # recompila o CUDA a partir do fonte atual
python3 -c "import server; server.require_cuda_binary(); print('GPU:', server.cuda_device_info()['name'])"
echo "Pronto em $DESTINO (commit $(cat .commit 2>/dev/null)). Exemplo:"
echo "  cd $DESTINO && NVCC_CCBIN=$NVCC_CCBIN python3 benchmark.py --rotulo principal ..."
