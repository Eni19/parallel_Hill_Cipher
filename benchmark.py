"""Experimentos de desempenho e energia da cifra de Hill em video, pela linha de comando.

Uso tipico (na mesma maquina para tempo e energia):

    python benchmark.py --modos seq omp pipeline cuda --threads 1 2 4 6 8 10 12 --reps 10
    python analisar.py resultados/<id> --hwinfo caminho/do/log_hwinfo.csv

O que este script garante, para responder a revisao:

* Mesmo escopo de tempo em todas as versoes: tempo_total vai da abertura do FFmpeg de leitura ate o
  fim do FFmpeg de saida (no video_hill isso e medido dentro do programa; no CUDA, em volta dos tres
  processos). O CUDA tambem informa "init_gpu" (criacao do contexto), para poder ser descontado.
* Mesma janela para energia: cada execucao grava inicio_epoch/fim_epoch; o analisar.py integra a
  potencia da CPU (log do HWiNFO) e da GPU (nvidia-smi) exatamente nessa janela.
* Correcao com saida descartada: antes das medicoes, cada configuracao roda uma vez com a saida
  "hash" (SHA-256 dos quadros cifrados, sem disco). Todas precisam dar o mesmo hash do seq, e o
  seq aplicado ao video cifrado precisa devolver o hash dos quadros originais (K^2 = I).
  Nas medicoes, todas as execucoes precisam processar o mesmo numero de quadros.
* --saida disco grava o video cifrado de verdade, para mostrar que descartar a saida nao muda as
  conclusoes (compare um lote "null" com um lote "disco").
* Periodos ociosos antes e depois do lote dao a potencia de repouso, para calcular energia liquida.
"""
import argparse
import csv
import json
import os
import platform
import random
import re
import shutil
import subprocess
import sys
import time

import server

CLIP = "bench_trecho.mp4"
SEED = 123
FIELDS = ["tipo", "modo", "threads", "config", "rep", "saida", "quadros", "tempo_total", "leitura", "cifra",
          "gravacao", "fps", "init_gpu", "copia_h2d", "kernel", "copia_d2h", "inicio_epoch", "fim_epoch"]


def config_name(mode, threads):
    if mode == "seq":
        return "seq"
    if mode == "cuda":
        return "cuda"
    return f"{mode} {threads}+2" if mode == "pipeline" else f"{mode} {threads}"


def lab(name):
    return os.path.join(server.LAB, name)


def run_cpu(binary, mode, threads, output):
    """Executa o video_hill e devolve as estatisticas impressas por ele."""
    result = subprocess.run([binary, mode, str(threads), str(SEED), CLIP, output], cwd=server.LAB,
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{config_name(mode, threads)}: {(result.stderr or result.stdout).strip()}")
    stats = {}
    for line in result.stdout.splitlines():
        if line.startswith("SHA256="):
            stats["sha256"] = line.split("=", 1)[1].strip()
        elif "tempo_total=" in line:
            stats.update(server.parse_stats(line))
    return stats


def run_one(binary, mode, threads, output, memory_percent, src=CLIP):
    """output: '-' (descarta), 'hash' (SHA-256 sem disco) ou nome .mkv (grava em disco)."""
    if mode == "cuda":
        if output == "hash":
            return server.run_cuda_video(src, None, SEED, memory_percent, "hash")
        if output == "-":
            return server.run_cuda_video(src, None, SEED, memory_percent, "raw", discard=True)
        return server.run_cuda_video(src, output, SEED, memory_percent, "raw")
    if src != CLIP:
        raise ValueError("run_cpu so usa o trecho de benchmark")
    return run_cpu(binary, mode, threads, output)


def ffmpeg_hash(path):
    """SHA-256 dos quadros brutos yuv420p de um video (mesmo calculo da saida 'hash')."""
    out = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-fps_mode",
                          "passthrough", "-pix_fmt", "yuv420p", "-c:v", "rawvideo", "-f", "hash", "-hash",
                          "sha256", "-"], cwd=server.LAB, capture_output=True, text=True, check=True).stdout
    match = re.search(r"SHA256=([0-9a-f]{64})", out)
    if not match:
        raise RuntimeError(f"Nao foi possivel calcular o hash de {path}")
    return match.group(1)


def verify(binary, configs, memory_percent):
    """Confere, sem medir tempo, que todas as configuracoes geram os mesmos bytes cifrados."""
    print("Verificacao de correcao (nao entra nas medicoes)")
    original = ffmpeg_hash(CLIP)
    report = {"sha256_original": original, "configuracoes": {}}
    for mode, threads in configs:
        stats = run_one(binary, mode, threads, "hash", memory_percent)
        report["configuracoes"][config_name(mode, threads)] = {"sha256_cifrado": stats.get("sha256"),
                                                               "quadros": stats.get("quadros")}
        print(f"  {config_name(mode, threads):<14} {stats.get('sha256', '?')[:16]}...  {stats.get('quadros')} quadros")
    reference = report["configuracoes"]["seq"]["sha256_cifrado"]
    report["cifrados_iguais"] = all(c["sha256_cifrado"] == reference for c in report["configuracoes"].values())
    report["cifrado_difere_do_original"] = reference != original
    # Ida e volta: o seq aplicado ao video cifrado deve devolver os quadros originais (K^2 = I).
    run_cpu(binary, "seq", 1, "verif_cifrado.mkv")
    back = subprocess.run([binary, "seq", "1", str(SEED), "verif_cifrado.mkv", "hash"], cwd=server.LAB,
                          capture_output=True, text=True, check=True).stdout
    match = re.search(r"SHA256=([0-9a-f]{64})", back)
    report["sha256_decifrado"] = match.group(1) if match else None
    report["decifrado_igual_original"] = report["sha256_decifrado"] == original
    os.remove(lab("verif_cifrado.mkv"))
    ok = report["cifrados_iguais"] and report["decifrado_igual_original"] and report["cifrado_difere_do_original"]
    print("  Todas iguais ao seq:", report["cifrados_iguais"], "| ida e volta devolve o original:",
          report["decifrado_igual_original"])
    report["ok"] = ok
    return report


class GpuSampler:
    """Amostra a potencia da placa (nvidia-smi, a cada 100 ms) em um CSV durante todo o lote.

    Usa power.draw.instant quando o driver oferece: em GPUs Ampere ou mais novas, power.draw e uma
    media movel de cerca de 1 s, que espalharia a energia de uma execucao para fora da sua janela."""

    def __init__(self, path, interval_ms):
        self.proc = None
        self.field = None
        smi = shutil.which("nvidia-smi")
        if not smi:
            print("nvidia-smi nao encontrado: sem medicao de energia da GPU")
            return
        test = subprocess.run([smi, "--query-gpu=power.draw.instant", "--format=csv,noheader"],
                              capture_output=True, text=True)
        self.field = "power.draw.instant" if test.returncode == 0 and "W" in test.stdout else "power.draw"
        self.file = open(path, "w", encoding="utf-8")
        self.proc = subprocess.Popen([smi, f"--query-gpu=timestamp,{self.field}", "--format=csv,noheader,nounits",
                                      f"-lms={interval_ms}"], stdout=self.file, stderr=subprocess.DEVNULL)

    def stop(self):
        if self.proc:
            self.proc.terminate()
            self.proc.wait()
            self.file.close()


def windows_clock():
    """No WSL, compara o relogio do Linux com o do Windows (onde o HWiNFO registra a CPU).

    Devolve {"diferenca_s": relogio_windows - relogio_linux, "fuso_windows_min": ..., "incerteza_s": ...}
    ou None fora do WSL. A incerteza e metade do tempo da chamada ao powershell.exe."""
    if not shutil.which("powershell.exe"):
        return None
    # Um unico powershell.exe le o relogio varias vezes, avisando quando le; fica a leitura com menor atraso.
    script = ("$n=[DateTimeOffset]::Now; [Console]::Out.WriteLine(\"tz $($n.Offset.TotalMinutes)\"); "
              "for($i=0;$i -lt 8;$i++){ [Console]::In.ReadLine() | Out-Null; "
              "[Console]::Out.WriteLine([DateTimeOffset]::Now.ToUnixTimeMilliseconds()) }")
    proc = subprocess.Popen(["powershell.exe", "-NoProfile", "-Command", script], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, text=True, bufsize=1)
    best = None
    try:
        offset_min = float(proc.stdout.readline().split()[1].replace(",", "."))
        for _ in range(8):
            before = time.time()
            proc.stdin.write("\n")
            proc.stdin.flush()
            windows_ms = float(proc.stdout.readline())
            after = time.time()
            if best is None or after - before < best[1] - best[0]:
                best = (before, after, windows_ms)
    except (IndexError, ValueError, OSError):
        return None
    finally:
        proc.kill()
        proc.wait()
    before, after, windows_ms = best
    return {"diferenca_s": windows_ms / 1000 - (before + after) / 2, "fuso_windows_min": offset_min,
            "incerteza_s": (after - before) / 2}


def machine_info():
    info = {"cpu": server.cpu_name(), "nucleos_logicos": os.cpu_count(), "so": platform.platform(),
            "python": platform.python_version(),
            # fuso do ambiente que roda o benchmark: o nvidia-smi grava a hora local dele
            "fuso_local_min": time.localtime().tm_gmtoff / 60}
    for tool, flag in (("gcc", "--version"), ("nvcc", "--version")):
        if shutil.which(tool):
            lines = subprocess.run([tool, flag], capture_output=True, text=True).stdout.strip().splitlines()
            info[tool] = lines[-1] if tool == "nvcc" and lines else (lines[0] if lines else "")
    try:
        info["ffmpeg"] = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0]
    except (OSError, IndexError):
        pass
    try:
        info["commit"] = subprocess.run(["git", "describe", "--always", "--dirty"], cwd=server.ROOT,
                                        capture_output=True, text=True).stdout.strip()
    except OSError:
        pass
    if not info.get("commit") and os.path.exists(os.path.join(server.ROOT, ".commit")):
        with open(os.path.join(server.ROOT, ".commit"), encoding="utf-8") as f:  # copia sem .git (WSL)
            info["commit"] = f.read().strip()
    smi = shutil.which("nvidia-smi")
    if smi:
        info["gpu"] = subprocess.run([smi, "--query-gpu=name,driver_version", "--format=csv,noheader"],
                                     capture_output=True, text=True).stdout.strip()
    return info


def idle(seconds, writer, label):
    if seconds <= 0:
        return
    print(f"Ocioso por {seconds} s ({label}): nao use o computador")
    start = time.time()
    time.sleep(seconds)
    writer.writerow({"tipo": "ocioso", "config": label, "inicio_epoch": f"{start:.3f}",
                     "fim_epoch": f"{time.time():.3f}"})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--modos", nargs="+", default=["seq", "omp", "pipeline", "cuda"],
                        choices=["seq", "omp", "pipeline", "cuda"])
    parser.add_argument("--threads", nargs="+", type=int, default=[1, 2, 4, 8])
    parser.add_argument("--reps", type=int, default=10, help="repeticoes por configuracao (sugestao: >= 10)")
    parser.add_argument("--segundos", type=int, default=8, help="duracao do trecho do video")
    parser.add_argument("--inicio", type=int, default=0, help="inicio do trecho no video (s)")
    parser.add_argument("--saida", choices=["null", "disco"], default="null",
                        help="null descarta os quadros no FFmpeg de saida; disco grava .mkv sem perdas")
    parser.add_argument("--memoria-gpu", type=int, default=60, help="%% da VRAM livre usada pelo CUDA")
    parser.add_argument("--ocioso", type=int, default=30, help="segundos ociosos antes e depois do lote")
    parser.add_argument("--pausa", type=float, default=3, help="pausa entre execucoes (s)")
    parser.add_argument("--amostragem-gpu-ms", type=int, default=100)
    parser.add_argument("--sem-verificacao", action="store_true")
    parser.add_argument("--rotulo", default="", help="nome curto acrescentado ao id do lote")
    args = parser.parse_args()

    binary = server.require_tools()
    if "cuda" in args.modos:
        server.require_cuda_binary()
    batch_id = time.strftime("%Y%m%d-%H%M%S") + (f"-{args.rotulo}" if args.rotulo else "")
    folder = os.path.join(server.ROOT, "resultados", batch_id)
    os.makedirs(folder)
    server.cut_clip(args.inicio, args.segundos, CLIP)

    configs = [("seq", 1)] + [(m, t) for m in args.modos if m in ("omp", "pipeline") for t in args.threads]
    if "cuda" in args.modos:
        configs.append(("cuda", 0))
    meta = {"id": batch_id, "data": time.strftime("%Y-%m-%d %H:%M:%S"), "args": vars(args),
            "maquina": machine_info(), "video": server.probe(lab(CLIP)), "semente": SEED,
            "configuracoes": [config_name(m, t) for m, t in configs]}

    if not args.sem_verificacao:
        meta["verificacao"] = verify(binary, configs, args.memoria_gpu)
        if not meta["verificacao"]["ok"]:
            with open(os.path.join(folder, "meta.json"), "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=1)
            sys.exit("Verificacao falhou: as versoes nao produzem os mesmos bytes. Medicoes canceladas.")

    output = "-" if args.saida == "null" else "bench_saida.mkv"
    meta["relogio_windows_inicio"] = windows_clock()
    sampler = GpuSampler(os.path.join(folder, "gpu_potencia.csv"), args.amostragem_gpu_ms)
    meta["campo_potencia_gpu"] = sampler.field

    def save_meta():
        with open(os.path.join(folder, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=1, ensure_ascii=False)

    save_meta()  # gravado antes das medicoes: se o lote for interrompido, o meta nao se perde
    print(f"\nInicie agora o registro do HWiNFO (se for medir a CPU). Resultados em {folder}")
    total = len(configs) * args.reps
    done = 0
    try:
        with open(os.path.join(folder, "execucoes.csv"), "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
            writer.writeheader()
            idle(args.ocioso, writer, "ocioso_inicio")
            for mode, threads in sorted({(m, 2) if m != "cuda" else (m, 0) for m, _ in configs}):
                print(f"Aquecimento {mode} (descartado)")
                run_one(binary, mode, threads, "-", args.memoria_gpu)
            for rep in range(1, args.reps + 1):
                order = configs[:]
                random.shuffle(order)  # ordem embaralhada a cada repeticao
                for mode, threads in order:
                    time.sleep(args.pausa)
                    stats = run_one(binary, mode, threads, output, args.memoria_gpu)
                    if output != "-" and os.path.exists(lab(output)):
                        os.remove(lab(output))
                    done += 1
                    row = {**stats, "tipo": "execucao", "modo": mode, "threads": threads if mode != "cuda" else "",
                           "config": config_name(mode, threads), "rep": rep, "saida": args.saida}
                    writer.writerow(row)
                    f.flush()
                    print(f"[{done}/{total}] rep {rep} {row['config']:<14} {stats['tempo_total']:.3f} s "
                          f"({stats.get('quadros')} quadros)")
            idle(args.ocioso, writer, "ocioso_fim")
    finally:
        sampler.stop()
    meta["relogio_windows_fim"] = windows_clock()
    meta["fim"] = time.strftime("%Y-%m-%d %H:%M:%S")
    save_meta()
    print(f"\nPronto. Pare o registro do HWiNFO e rode:\n  python analisar.py {os.path.relpath(folder)} "
          f"--hwinfo <log_hwinfo.csv>")


if __name__ == "__main__":
    main()
