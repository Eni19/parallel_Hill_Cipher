"""Servidor local do site: arquivos estaticos + APIs dos laboratorios de imagem e video.

Uso: python server.py   (depois abra http://localhost:8085)

O servidor local executa o backend CUDA de imagens, video_hill e FFmpeg.
Escuta apenas em 127.0.0.1.
"""
import glob
import hashlib
import json
import math
import os
import random
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time
import ctypes
from collections import Counter
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(ROOT, "video_lab")
SOURCE = os.path.join(ROOT, "video.mp4")
BENCH_FILE = os.path.join(LAB, "benchmarks.json")
PORT = 8085
MODES = ("seq", "omp", "pipeline")
DEMO_MODES = MODES + ("cuda",)
CUDA_SOURCE = os.path.join(ROOT, "HillCypherCode", "image_hill_cuda.cu")
CUDA_BINARY = os.path.join(LAB, "image_hill_cuda.exe" if os.name == "nt" else "image_hill_cuda")
CUDA_LOCK = threading.Lock()


def find_ffmpeg_dir():
    """Diretorio do ffmpeg: PATH ou, no Windows, a instalacao do winget (que so entra no PATH de terminais novos)."""
    exe = shutil.which("ffmpeg")
    if exe and shutil.which("ffprobe"):
        return os.path.dirname(exe)
    pattern = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages",
                           "*FFmpeg*", "*", "bin", "ffmpeg.exe")
    found = sorted(glob.glob(pattern))
    return os.path.dirname(found[-1]) if found else None


def find_binary():
    names = ["video_hill.exe", "video_hill"] if os.name == "nt" else ["video_hill"]
    for folder in (ROOT, os.path.join(ROOT, "HillCypherCode")):
        for name in names:
            path = os.path.join(folder, name)
            if os.path.isfile(path):
                return path
    return None


def find_nvcc():
    exe_name = "nvcc.exe" if os.name == "nt" else "nvcc"
    path_exe = shutil.which(exe_name)
    if path_exe:
        return path_exe
    roots = [os.environ.get("CUDA_PATH", ""),
             os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"),
                          "NVIDIA GPU Computing Toolkit", "CUDA")]
    candidates = [os.path.join(root, "bin", exe_name) for root in roots if root]
    candidates.extend(glob.glob(os.path.join(roots[-1], "v*", "bin", exe_name)))
    return next((path for path in candidates if path and os.path.isfile(path)), None)


def find_vsdevcmd():
    roots = [os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
             os.environ.get("ProgramFiles", r"C:\Program Files")]
    candidates = [path for root in roots for path in glob.glob(
        os.path.join(root, "Microsoft Visual Studio", "*", "*", "Common7", "Tools", "VsDevCmd.bat"))]
    return candidates[-1] if candidates else None


def cuda_build_environment():
    environment = os.environ.copy()
    if os.name != "nt" or shutil.which("cl.exe", path=environment.get("PATH")):
        return environment
    vsdevcmd = find_vsdevcmd()
    if not vsdevcmd:
        raise RuntimeError("Instale Visual Studio Build Tools 2022 com a carga Desenvolvimento para desktop com C++ (MSVC).")
    short_path = ctypes.create_unicode_buffer(32768)
    if not ctypes.windll.kernel32.GetShortPathNameW(vsdevcmd, short_path, len(short_path)):
        raise RuntimeError("Nao foi possivel resolver o caminho do VsDevCmd.bat.")
    command = (f"cmd.exe /d /c call {short_path.value} -arch=x64 -host_arch=x64 & set")
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Nao foi possivel carregar o ambiente MSVC pelo VsDevCmd.bat.")
    for line in result.stdout.splitlines():
        name, separator, value = line.partition("=")
        if separator and name and not name.startswith("="):
            existing_name = next((key for key in environment if key.lower() == name.lower()), name)
            environment[existing_name] = value
    path_value = next((value for key, value in environment.items() if key.lower() == "path"), "")
    if not shutil.which("cl.exe", path=path_value):
        raise RuntimeError("Visual Studio Build Tools foi encontrado, mas falta a carga Desenvolvimento para desktop com C++ (MSVC).")
    return environment


def require_cuda_binary():
    nvcc = find_nvcc()
    if not nvcc:
        raise RuntimeError("nvcc nao encontrado. Instale o NVIDIA CUDA Toolkit e reinicie o servidor.")
    if not os.path.isfile(CUDA_SOURCE):
        raise RuntimeError("Fonte CUDA da cifra nao encontrada.")
    os.makedirs(LAB, exist_ok=True)
    if not os.path.isfile(CUDA_BINARY) or os.path.getmtime(CUDA_SOURCE) > os.path.getmtime(CUDA_BINARY):
        environment = cuda_build_environment()
        compile_args = [nvcc, "-O2", "-std=c++17"]
        smi = shutil.which("nvidia-smi")
        if smi:
            capability = subprocess.run([smi, "--query-gpu=compute_cap", "--format=csv,noheader"],
                                        capture_output=True, text=True)
            match = re.search(r"(\d+)\.(\d+)", capability.stdout.splitlines()[0]) if capability.stdout else None
            if match:
                compile_args.extend(["-arch=sm_" + match.group(1) + match.group(2)])
        result = subprocess.run([*compile_args, CUDA_SOURCE, "-o", CUDA_BINARY],
                                cwd=ROOT, capture_output=True, text=True, env=environment)
        if result.returncode:
            message = (result.stderr or result.stdout).strip().splitlines()
            detail = message[-1] if message else "erro desconhecido"
            if "Host compiler" in detail or "cl.exe" in detail:
                raise RuntimeError("Para compilar CUDA no Windows, instale Visual Studio Build Tools 2022 com o componente Desenvolvimento para desktop com C++ (MSVC). " + detail)
            raise RuntimeError("Falha ao compilar o backend CUDA: " + detail)
    return CUDA_BINARY


def cuda_device_info():
    binary = require_cuda_binary()
    result = subprocess.run([binary, "--info"], cwd=ROOT, capture_output=True,
                            text=True, timeout=20)
    if result.returncode:
        raise RuntimeError((result.stderr or "Nao foi possivel consultar a GPU").strip())
    try:
        return json.loads(result.stdout)
    except ValueError as exc:
        raise RuntimeError("Resposta invalida do backend CUDA") from exc


def cuda_transform(data, seed, memory_percent):
    binary = require_cuda_binary()
    with CUDA_LOCK:
        result = subprocess.run([binary, str(seed), str(memory_percent)], input=data,
                                 capture_output=True, timeout=180)
    if result.returncode:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or "Falha no processamento CUDA")
    metadata = re.search(rb"GPU_META (\d+) (\d+)", result.stderr)
    if not metadata or len(result.stdout) != len(data):
        raise RuntimeError("O backend CUDA retornou um resultado incompleto")
    return result.stdout, int(metadata.group(1)), int(metadata.group(2))


FFMPEG_DIR = find_ffmpeg_dir()
if FFMPEG_DIR:
    os.environ["PATH"] = FFMPEG_DIR + os.pathsep + os.environ.get("PATH", "")


class Cancelled(Exception):
    pass


class Job:
    """Estado do unico trabalho em execucao, lido pelo site a cada poucos centesimos de segundo."""

    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"busy": False, "kind": None, "step": "", "done": 0, "total": 0,
                      "log": [], "result": None, "error": None}
        self.proc = None
        self.cancel = False

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps(self.state))

    def update(self, **kw):
        with self.lock:
            self.state.update(kw)

    def log(self, line):
        with self.lock:
            self.state["log"] = (self.state["log"] + [line])[-40:]

    def start(self, kind, target, *args):
        with self.lock:
            if self.state["busy"]:
                return False
            self.state = {"busy": True, "kind": kind, "step": "Preparando", "done": 0, "total": 0,
                          "log": [], "result": None, "error": None}
            self.cancel = False
        threading.Thread(target=self._run, args=(target, args), daemon=True).start()
        return True

    def _run(self, target, args):
        try:
            result = target(*args)
            self.update(busy=False, result=result, step="Concluido")
        except Cancelled:
            self.update(busy=False, error="Cancelado pelo usuario", step="Cancelado")
        except Exception as exc:  # erro mostrado no site
            self.update(busy=False, error=str(exc), step="Erro")

    def run(self, cmd, step=None):
        """Executa um processo e devolve a saida; o cancelamento encerra o processo atual."""
        if self.cancel:
            raise Cancelled()
        if step:
            self.update(step=step)
        self.log("$ " + " ".join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd)))
        self.proc = subprocess.Popen(cmd, cwd=LAB, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        out, err = self.proc.communicate()
        code, self.proc = self.proc.returncode, None
        if self.cancel:
            raise Cancelled()
        if out.strip():
            self.log(out.strip())
        if code != 0:
            raise RuntimeError((err or out).strip().splitlines()[-1] if (err or out).strip()
                               else f"{os.path.basename(cmd[0])} terminou com codigo {code}")
        return out

    def stop(self):
        self.cancel = True
        proc = self.proc
        if proc:
            proc.kill()


JOB = Job()


def parse_stats(line):
    """Converte a linha 'chave=valor' impressa por video_hill em dicionario."""
    stats = {}
    for key, value in re.findall(r"(\w+)=(\S+)", line):
        try:
            stats[key] = float(value) if "." in value else int(value)
        except ValueError:
            stats[key] = value
    if "threads" in stats:
        stats["threads"] = int(str(stats["threads"]).split("+")[0])
    return stats


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate,nb_frames,codec_name,pix_fmt:format=duration",
                          "-of", "json", path], capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    s, fmt = data["streams"][0], data.get("format", {})
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    return {"width": s["width"], "height": s["height"], "fps": round(num / den, 3),
            "frame_rate": s["r_frame_rate"],
            "codec": s.get("codec_name"), "pix_fmt": s.get("pix_fmt"),
            "frames": int(s["nb_frames"]) if s.get("nb_frames", "").isdigit() else None,
            "duration": round(float(fmt.get("duration", 0)), 2)}


def cut_clip(start, seconds, name):
    """Trecho do video original, copiado sem recodificar (o corte comeca no quadro-chave mais proximo)."""
    JOB.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-i", SOURCE, "-t", str(seconds),
             "-map", "0:v:0", "-c", "copy", "-an", name], f"Recortando {seconds} s do video")


def frame_bytes(path, index, w, h):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-vf", f"select=eq(n\\,{index})",
                          "-fps_mode", "passthrough", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"],
                         cwd=LAB, capture_output=True, check=True).stdout
    expected = w * h + 2 * ((w + 1) // 2) * ((h + 1) // 2)
    if len(raw) != expected:
        raise RuntimeError("Nao foi possivel extrair o quadro para analise")
    return raw


def plane_metrics(data, w, h):
    """Histograma, entropia (bits por byte) e correlacao entre vizinhos horizontais (amostrada)."""
    counts = Counter(data)
    hist = [counts.get(i, 0) for i in range(256)]
    n = len(data)
    entropy = -sum(c / n * math.log2(c / n) for c in hist if c)
    rng = random.Random(7)
    xs, ys = [], []
    for _ in range(20000):
        row, col = rng.randrange(h), rng.randrange(w - 1)
        i = row * w + col
        xs.append(data[i])
        ys.append(data[i + 1])
    try:
        corr = statistics.correlation(xs, ys)
    except statistics.StatisticsError:  # plano constante
        corr = 1.0
    return {"hist": hist, "entropy": round(entropy, 4), "correlation": round(corr, 4),
            "distinct": sum(1 for c in hist if c)}


def analyse_frame(index, w, h):
    result = {"frame": index}
    cw, ch = (w + 1) // 2, (h + 1) // 2
    for label, path in (("original", "trecho.mp4"), ("cifrado", "cifrado.mkv")):
        raw = frame_bytes(path, index, w, h)
        y, u, v = raw[:w * h], raw[w * h:w * h + cw * ch], raw[w * h + cw * ch:]
        result[label] = {"Y": plane_metrics(y, w, h), "U": plane_metrics(u, cw, ch), "V": plane_metrics(v, cw, ch)}
    return result


def frames_hash(path):
    """SHA-256 dos quadros brutos (yuv420p) de um video, lidos em fluxo."""
    digest = hashlib.sha256()
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-fps_mode", "passthrough",
                             "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], cwd=LAB, stdout=subprocess.PIPE)
    for chunk in iter(lambda: proc.stdout.read(1 << 20), b""):
        digest.update(chunk)
    if proc.wait() != 0:
        raise RuntimeError(f"Falha ao ler {path}")
    return digest.hexdigest()


def preview(src, dst, noise):
    """Versao H.264 reduzida so para o navegador exibir (nao serve para decifrar)."""
    scale = "scale=960:-2:flags=neighbor" if noise else "scale=960:-2"
    JOB.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v:0", "-vf", scale, "-c:v", "libx264",
             "-preset", "veryfast", "-crf", "30" if noise else "20", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", "-an", dst])


def run_cuda_video(src, dst, seed, memory_percent, codec, discard=False):
    binary = require_cuda_binary()
    input_path = src if os.path.isabs(src) else os.path.join(LAB, src)
    output_path = None if discard else dst if os.path.isabs(dst) else os.path.join(LAB, dst)
    info = probe(input_path)
    width, height = info["width"], info["height"]
    frame_size = width * height + 2 * ((width + 1) // 2) * ((height + 1) // 2)
    decode = ["ffmpeg", "-v", "error", "-nostdin", "-i", input_path, "-map", "0:v:0",
              "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "yuv420p", "pipe:1"]
    gpu = [binary, "--stream", str(seed), str(memory_percent), str(frame_size)]
    encode = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt",
              "yuv420p", "-s", f"{width}x{height}", "-framerate", info["frame_rate"], "-i", "pipe:0"]
    encode += (["-c:v", "ffv1", "-level", "3", "-g", "1", "-pix_fmt", "yuv420p"]
               if codec == "ffv1" else ["-c:v", "rawvideo", "-pix_fmt", "yuv420p"])
    encode += ["-an"]
    encode += ["-f", "null", "-"] if discard else [output_path]

    decoder = gpu_process = encoder = None
    start = time.perf_counter()
    try:
        with CUDA_LOCK:
            decoder = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            JOB.proc = decoder
            gpu_process = subprocess.Popen(gpu, stdin=decoder.stdout, stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE)
            decoder.stdout.close()
            encoder = subprocess.Popen(encode, stdin=gpu_process.stdout, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE)
            gpu_process.stdout.close()
            encoder_code = encoder.wait()
            gpu_code = gpu_process.wait()
            decoder_code = decoder.wait()
            gpu_stderr = gpu_process.stderr.read().decode("utf-8", errors="replace")
            decoder_stderr = decoder.stderr.read().decode("utf-8", errors="replace")
            encoder_stderr = encoder.stderr.read().decode("utf-8", errors="replace")
    finally:
        JOB.proc = None
        for process in (encoder, gpu_process, decoder):
            if process and process.poll() is None:
                process.kill()
                process.wait()
    elapsed = time.perf_counter() - start
    match = re.search(r"GPU_STREAM_META (\d+) (\d+) (\d+) ([\d.]+) ([\d.]+) ([\d.]+)", gpu_stderr)
    if decoder_code or gpu_code or encoder_code or not match:
        if output_path and os.path.exists(output_path):
            os.remove(output_path)
        details = (gpu_stderr or decoder_stderr or encoder_stderr).strip().splitlines()
        raise RuntimeError(details[-1] if details else "Falha no pipeline de video CUDA")
    frames = int(match.group(3))
    return {"modo": "cuda", "threads": "GPU", "gpu": cuda_device_info()["name"],
            "quadros": frames, "resolucao": f"{width}x{height}", "formato": "yuv420p",
            "bytes_quadro": frame_size, "codec": codec, "tempo_total": elapsed,
            "leitura": float(match.group(4)), "cifra": float(match.group(5)),
            "gravacao": float(match.group(6)),
            "fps": frames / elapsed if elapsed else 0}


def run_demo(p):
    if p["mode"] == "cuda":
        require_video_media()
        require_cuda_binary()
        binary = None
    else:
        binary = require_tools()
    cut_clip(p["start"], p["seconds"], "trecho.mp4")
    info = probe(os.path.join(LAB, "trecho.mp4"))
    JOB.update(total=6)
    if p["mode"] == "cuda":
        JOB.update(step="Decodificando e cifrando quadros na GPU")
        enc = run_cuda_video("trecho.mp4", "cifrado.mkv", p["seed"], p["memory_percent"], "raw")
    else:
        common = [str(p["threads"]), str(p["seed"])]
        enc = parse_stats(JOB.run([binary, p["mode"], *common, "trecho.mp4", "cifrado.mkv"], "Cifrando o trecho"))
    JOB.update(done=1)
    if p["mode"] == "cuda":
        JOB.update(step="Decodificando e decifrando quadros na GPU")
        dec = run_cuda_video("cifrado.mkv", "decifrado.mkv", p["seed"], p["memory_percent"], "ffv1")
    else:
        dec = parse_stats(JOB.run([binary, p["mode"], *common, "cifrado.mkv", "decifrado.mkv", "yuv420p", "ffv1"],
                                  "Decifrando o video cifrado"))
    JOB.update(done=2, step="Comparando quadros (SHA-256)")
    h_orig, h_dec = frames_hash("trecho.mp4"), frames_hash("decifrado.mkv")
    JOB.update(done=3, step="Analisando um quadro")
    frames = enc.get("quadros", 1)
    analysis = analyse_frame(frames // 2, info["width"], info["height"])
    JOB.update(done=4, step="Gerando previas para o navegador")
    for src, dst, noise in (("trecho.mp4", "prev_original.mp4", False), ("cifrado.mkv", "prev_cifrado.mp4", True),
                            ("decifrado.mkv", "prev_decifrado.mp4", False)):
        preview(src, dst, noise)
    JOB.update(done=6)
    sizes = {name: os.path.getsize(os.path.join(LAB, name))
             for name in ("trecho.mp4", "cifrado.mkv", "decifrado.mkv")}
    result = {"params": p, "info": info, "encrypt": enc, "decrypt": dec, "sizes": sizes,
              "hash_original": h_orig, "hash_decifrado": h_dec, "identical": h_orig == h_dec,
              "analysis": analysis, "version": int(time.time())}
    with open(os.path.join(LAB, "demo.json"), "w", encoding="utf-8") as f:
        json.dump(result, f)
    return result


def run_bench(p):
    binary = require_tools()
    if "cuda" in p["modes"]:
        require_cuda_binary()
    cut_clip(p["start"], p["seconds"], "bench_trecho.mp4")
    configs = [("seq", 1)] + [(m, t) for m in p["modes"] if m not in ("seq", "cuda") for t in p["threads"]]
    if "cuda" in p["modes"]:
        configs.append(("cuda", "GPU"))
    cuda_warmup = int("cuda" in p["modes"])
    total = len(configs) * p["reps"] + 1 + cuda_warmup
    JOB.update(total=total)
    out = "-" if p["discard"] else "bench_saida.mkv"
    batch = {"id": time.strftime("%Y%m%d-%H%M%S"), "date": time.strftime("%d/%m/%Y %H:%M"),
             "seconds": p["seconds"], "start": p["start"], "reps": p["reps"], "discard": p["discard"],
             "cpu": cpu_name(), "cores": os.cpu_count(), "cuda_memory_percent": p.get("memory_percent"),
             "runs": []}
    JOB.run([binary, "omp", "2", "1", "bench_trecho.mp4", out], "Aquecimento (descartado)")
    done = 1
    if cuda_warmup:
        JOB.update(done=done, step="Aquecimento CUDA (descartado)")
        cuda_warm = run_cuda_video("bench_trecho.mp4", None, 123, p["memory_percent"], "discard", discard=True)
        batch["gpu"] = cuda_warm["gpu"]
        done += 1
    for rep in range(1, p["reps"] + 1):
        order = configs[:]
        random.shuffle(order)  # ordem embaralhada reduz o efeito de aquecimento e carga do sistema
        for mode, threads in order:
            label = f"{mode} na GPU" if mode == "cuda" else f"{mode} com {threads} thread(s)"
            JOB.update(done=done, step=f"Repeticao {rep}/{p['reps']}: {label}")
            if mode == "cuda":
                cuda_out = None if p["discard"] else "bench_cuda_saida.mkv"
                stats = run_cuda_video("bench_trecho.mp4", cuda_out, 123, p["memory_percent"],
                                       "discard" if p["discard"] else "raw", discard=p["discard"])
            else:
                stats = parse_stats(JOB.run([binary, mode, str(threads), "123", "bench_trecho.mp4", out]))
            stats["rep"] = rep
            batch["runs"].append(stats)
            done += 1
    JOB.update(done=done)
    if not p["discard"]:
        for name in (out, "bench_cuda_saida.mkv"):
            path = os.path.join(LAB, name)
            if os.path.exists(path):
                os.remove(path)
    batches = load_benchmarks()
    batches.append(batch)
    with open(BENCH_FILE, "w", encoding="utf-8") as f:
        json.dump(batches, f, indent=1)
    return batch


def load_benchmarks():
    try:
        with open(BENCH_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def cpu_name():
    if os.name == "nt":
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return "desconhecido"


def require_video_media():
    if not FFMPEG_DIR:
        raise RuntimeError("FFmpeg nao encontrado. Instale-o e coloque ffmpeg/ffprobe no PATH.")
    if not os.path.isfile(SOURCE):
        raise RuntimeError("video.mp4 nao encontrado na pasta do projeto.")
    os.makedirs(LAB, exist_ok=True)


def require_tools():
    require_video_media()
    binary = find_binary()
    if not binary:
        raise RuntimeError("Compile HillCypherCode/video_hill.c como video_hill na pasta do projeto (veja o README).")
    return binary


def number(body, key, low, high, default, kind=int):
    try:
        value = kind(body.get(key, default))
    except (TypeError, ValueError):
        raise ValueError(f"Valor invalido para {key}")
    if not low <= value <= high:
        raise ValueError(f"{key} deve ficar entre {low} e {high}")
    return value


def clip_params(body, info):
    seconds = number(body, "seconds", 1, 30, 8)
    start = number(body, "start", 0, max(0, int(info["duration"]) - 1), 0)
    return seconds, start


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript",
                      ".js": "text/javascript", ".mp4": "video/mp4", ".json": "application/json"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # O navegador confere a versao a cada carga: edicoes no site aparecem sem limpar o cache.
        if "Cache-Control" not in "".join(h.decode("latin-1") for h in getattr(self, "_headers_buffer", [])):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/job"):
            sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_binary(self, data, headers=()):
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for name, value in headers:
            self.send_header(name, str(value))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/gpu/info":
            try:
                return self.send_json(cuda_device_info())
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                return self.send_json({"error": str(exc)}, 503)
        if path == "/api/video/info":
            info = None
            if FFMPEG_DIR and os.path.isfile(SOURCE):
                try:
                    info = probe(SOURCE)
                except (subprocess.CalledProcessError, ValueError, KeyError):
                    info = None
            demo = None
            try:
                with open(os.path.join(LAB, "demo.json"), encoding="utf-8") as f:
                    demo = json.load(f)
            except (OSError, ValueError):
                pass
            return self.send_json({"ffmpeg": bool(FFMPEG_DIR), "binary": bool(find_binary()),
                                   "source": os.path.isfile(SOURCE), "info": info, "cores": os.cpu_count(),
                                   "cpu": cpu_name(), "demo": demo, "job": JOB.snapshot()})
        if path == "/api/job":
            return self.send_json(JOB.snapshot())
        if path == "/api/bench":
            return self.send_json(load_benchmarks())
        if path.startswith("/video_lab/"):
            return self.send_ranged(path)
        return super().do_GET()

    def send_ranged(self, path):
        """Arquivos de video com suporte a Range, necessario para o navegador avancar e sincronizar os players."""
        file = os.path.join(LAB, os.path.basename(path))
        if not os.path.isfile(file):
            return self.send_error(404)
        size = os.path.getsize(file)
        start, end = 0, size - 1
        match = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if match and (match.group(1) or match.group(2)):
            if match.group(1):
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else end
            else:
                start = max(0, size - int(match.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                return self.end_headers()
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", self.guess_type(file))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(file, "rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(left, 1 << 16))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            length = int(self.headers.get("Content-Length", 0))
            if path == "/api/image/gpu":
                if not 1 <= length <= 64 * 1024 * 1024:
                    return self.send_json({"error": "A imagem deve ter entre 1 byte e 64 MiB."}, 413)
                image_bytes = self.rfile.read(length)
                if len(image_bytes) != length:
                    return self.send_json({"error": "Upload da imagem incompleto."}, 400)
                body = {}
            else:
                body = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            return self.send_json({"error": "JSON invalido"}, 400)
        if path == "/api/cancel":
            JOB.stop()
            return self.send_json({"ok": True})
        try:
            if path == "/api/image/gpu":
                query = parse_qs(urlsplit(self.path).query)
                try:
                    seed = int(query.get("seed", [""])[0])
                    memory_percent = int(query.get("memoryPercent", ["60"])[0])
                except ValueError as exc:
                    raise ValueError("Semente e percentual de memoria devem ser inteiros") from exc
                if not 0 <= seed < 2 ** 64:
                    raise ValueError("A semente deve caber em 64 bits")
                if not 10 <= memory_percent <= 80:
                    raise ValueError("O limite de memoria deve ficar entre 10% e 80% da VRAM livre")
                output, free_bytes, batch_bytes = cuda_transform(image_bytes, seed, memory_percent)
                info = cuda_device_info()
                return self.send_binary(output, (("X-GPU-Name", info["name"]),
                                                 ("X-GPU-Free-Bytes", free_bytes),
                                                 ("X-GPU-Batch-Bytes", batch_bytes)))
            mode = body.get("mode") if path == "/api/demo" else None
            if path == "/api/demo" and mode == "cuda":
                require_video_media()
            else:
                require_tools()
            info = probe(SOURCE)
            if path == "/api/demo":
                if mode not in DEMO_MODES:
                    raise ValueError("Modo invalido")
                seconds, start = clip_params(body, info)
                params = {"mode": mode, "threads": 1 if mode in ("seq", "cuda") else number(body, "threads", 1, 64, 2),
                          "seed": number(body, "seed", 0, 2 ** 64 - 1, 123), "seconds": seconds, "start": start}
                if mode == "cuda":
                    params["memory_percent"] = number(body, "memoryPercent", 10, 80, 60)
                started = JOB.start("demo", run_demo, params)
            elif path == "/api/bench":
                modes = [m for m in body.get("modes", []) if m in MODES or m == "cuda"]
                threads = sorted({int(t) for t in body.get("threads", []) if str(t).isdigit() and 1 <= int(t) <= 64})
                if not threads and any(m not in ("seq", "cuda") for m in modes):
                    raise ValueError("Escolha ao menos um numero de threads")
                if "cuda" in modes:
                    require_cuda_binary()
                seconds, start = clip_params(body, info)
                params = {"modes": modes, "threads": threads, "reps": number(body, "reps", 1, 20, 3),
                          "seconds": seconds, "start": start, "discard": bool(body.get("discard", True))}
                if "cuda" in modes:
                    params["memory_percent"] = number(body, "memoryPercent", 10, 80, 60)
                started = JOB.start("bench", run_bench, params)
            else:
                return self.send_json({"error": "Rota desconhecida"}, 404)
        except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired) as exc:
            return self.send_json({"error": str(exc)}, 400)
        if not started:
            return self.send_json({"error": "Ja existe um trabalho em execucao"}, 409)
        return self.send_json({"ok": True})


if __name__ == "__main__":
    os.makedirs(LAB, exist_ok=True)
    print(f"FFmpeg: {FFMPEG_DIR or 'NAO ENCONTRADO'}")
    print(f"video_hill: {find_binary() or 'NAO ENCONTRADO (compile HillCypherCode/video_hill.c)'}")
    print(f"Abra http://localhost:{PORT}  (Ctrl+C para encerrar)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
