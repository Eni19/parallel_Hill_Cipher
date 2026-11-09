"""Estatistica dos experimentos: media, dispersao, intervalos de confianca, testes e energia.

Entradas aceitas:
  * pasta criada pelo benchmark.py (execucoes.csv, meta.json e, se houver, gpu_potencia.csv);
  * video_lab/benchmarks.json do site (lotes antigos; escolha com --lote, padrao: todos);
  * um CSV qualquer com uma linha por execucao e as colunas "config" (ou "modo" e "threads")
    e metricas numericas, por exemplo tempo_total, energia_cpu_j (serve para dados ja coletados).

Energia (so para a pasta do benchmark.py):
  * CPU: --hwinfo com o CSV do HWiNFO; integra a coluna "CPU Package Power" na janela
    [inicio_epoch, fim_epoch] de cada execucao (trapezios, com interpolacao linear nos limites);
  * GPU: gpu_potencia.csv (nvidia-smi), mesma janela;
  * potencia de repouso: media nas janelas ociosas; a energia liquida desconta P_ocioso * T.

Saidas (na pasta de entrada ou em --saida): resumo.csv, comparacoes.csv, execucoes_com_energia.csv
e tabelas.tex. Nao usa bibliotecas externas.

Exemplos:
  python analisar.py resultados/20261110-140000 --hwinfo hwinfo.csv --comparar "omp 8=omp 12"
  python analisar.py video_lab/benchmarks.json
  python analisar.py energia_plataformaC.csv --comparar "omp 8=omp 16"
"""
import argparse
import calendar
import csv
import json
import math
import os
import random
import re
import statistics
import sys
import time
from collections import defaultdict
from datetime import datetime

# Metricas de tempo (s) e de energia (J ou W) reconhecidas, na ordem das tabelas.
TIME_METRICS = ["tempo_total", "tempo_sem_init", "leitura", "cifra", "gravacao", "init_gpu", "copia_h2d",
                "kernel", "copia_d2h"]
ENERGY_METRICS = ["energia_cpu_j", "energia_cpu_liq_j", "energia_gpu_j", "energia_gpu_liq_j", "energia_total_j",
                  "energia_total_liq_j", "potencia_cpu_w", "potencia_gpu_w", "j_por_quadro"]
NOT_METRICS = {"tipo", "modo", "threads", "config", "rep", "saida", "quadros", "inicio_epoch", "fim_epoch",
               "fps", "sha256", "codec", "resolucao", "formato", "bytes_quadro", "gpu"}


# ---------------------------------------------------------------- distribuicao t de Student
def _betacf(a, b, x):
    """Fracao continua da funcao beta incompleta (Numerical Recipes)."""
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        for aa in (m * (b - m) * x / ((qam + m2) * (a + m2)), -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))):
            d = 1 + aa * d
            d = 1 / (d if abs(d) > 1e-300 else 1e-300)
            c = 1 + aa / c
            c = c if abs(c) > 1e-300 else 1e-300
            h *= d * c
            if aa < 0 and abs(d * c - 1) < 1e-14:
                return h
    return h


def betai(a, b, x):
    """Funcao beta incompleta regularizada I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1 - front * _betacf(b, a, 1 - x) / b


def t_two_sided_p(t, df):
    return betai(df / 2, 0.5, df / (df + t * t))


def t_quantile(prob, df):
    """Quantil superior: t tal que P(T > t) = 1 - prob (prob > 0,5)."""
    target = 2 * (1 - prob)
    low, high = 0.0, 1e4
    for _ in range(200):
        mid = (low + high) / 2
        if t_two_sided_p(mid, df) > target:
            low = mid
        else:
            high = mid
    return (low + high) / 2


# ---------------------------------------------------------------- estatistica descritiva e testes
def describe(values):
    n = len(values)
    mean = statistics.fmean(values)
    sd = statistics.stdev(values) if n > 1 else float("nan")
    q1, med, q3 = statistics.quantiles(values, n=4, method="inclusive") if n > 1 else (values[0],) * 3
    half = t_quantile(0.975, n - 1) * sd / math.sqrt(n) if n > 1 else float("nan")
    return {"n": n, "media": mean, "dp": sd, "cv_pct": 100 * sd / mean if mean else float("nan"),
            "mediana": med, "q1": q1, "q3": q3, "iqr": q3 - q1, "min": min(values), "max": max(values),
            "ic95_inf": mean - half, "ic95_sup": mean + half}


def welch(a, b):
    """Teste t de Welch (variancias diferentes). Devolve diferenca de medias (a - b), IC95, t, gl, p."""
    na, nb = len(a), len(b)
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    va, vb = statistics.variance(a), statistics.variance(b)
    se2 = va / na + vb / nb
    if se2 == 0:
        return {"dif": ma - mb, "ic95_inf": ma - mb, "ic95_sup": ma - mb, "t": float("inf"), "gl": na + nb - 2,
                "p": 0.0 if ma != mb else 1.0}
    df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    t = (ma - mb) / math.sqrt(se2)
    half = t_quantile(0.975, df) * math.sqrt(se2)
    return {"dif": ma - mb, "ic95_inf": ma - mb - half, "ic95_sup": ma - mb + half, "t": t, "gl": df,
            "p": t_two_sided_p(abs(t), df)}


def bootstrap_ratio(base, other, reps=10000, seed=2026):
    """IC95 por bootstrap do speedup = media(base) / media(outro)."""
    rng = random.Random(seed)
    ratios = sorted(statistics.fmean(rng.choices(base, k=len(base))) /
                    statistics.fmean(rng.choices(other, k=len(other))) for _ in range(reps))
    return ratios[int(0.025 * reps)], ratios[int(0.975 * reps) - 1]


def holm(pvalues):
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [0.0] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


# ---------------------------------------------------------------- leitura das entradas
def to_number(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def config_of(row):
    if row.get("config"):
        return row["config"]
    mode, threads = row.get("modo", "?"), str(row.get("threads", "")).split("+")[0]
    if mode in ("seq", "cuda"):
        return mode
    return f"{mode} {threads}+2" if mode == "pipeline" else f"{mode} {threads}"


def config_key(name):
    """Ordem das tabelas: seq, omp por threads, pipeline por threads, cuda, outros."""
    mode, _, rest = name.partition(" ")
    rank = {"seq": 0, "omp": 1, "pipeline": 2, "cuda": 3}.get(mode, 4)
    number = re.match(r"\d+", rest)
    return rank, int(number.group()) if number else 0, name


def load(path, batch):
    """Devolve (execucoes, janelas_ociosas, pasta_de_saida, meta)."""
    meta, idle = {}, []
    if os.path.isdir(path):
        folder = path
        with open(os.path.join(path, "execucoes.csv"), encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        if os.path.exists(os.path.join(path, "meta.json")):
            with open(os.path.join(path, "meta.json"), encoding="utf-8") as f:
                meta = json.load(f)
        idle = [r for r in rows if r.get("tipo") == "ocioso"]
        rows = [r for r in rows if r.get("tipo", "execucao") == "execucao"]
    elif path.endswith(".json"):
        folder = os.path.dirname(os.path.abspath(path))
        with open(path, encoding="utf-8") as f:
            batches = json.load(f)
        chosen = [b for b in batches if batch in (None, b["id"])]
        if not chosen:
            sys.exit(f"Lote {batch} nao encontrado. Lotes: {', '.join(b['id'] for b in batches)}")
        rows = [dict(r, lote=b["id"]) for b in chosen for r in b["runs"]]
        meta = {"lotes": [{k: v for k, v in b.items() if k != "runs"} for b in chosen]}
    else:
        folder = os.path.dirname(os.path.abspath(path))
        with open(path, encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
    for row in rows:
        row["config"] = config_of(row)
        for key in list(row):
            if (key not in NOT_METRICS and key != "lote") or key in ("inicio_epoch", "fim_epoch", "quadros"):
                number = to_number(row[key])
                row[key] = number if number is not None else row[key]
        if isinstance(row.get("tempo_total"), float) and isinstance(row.get("init_gpu"), float):
            row["tempo_sem_init"] = row["tempo_total"] - row["init_gpu"]
    return rows, idle, folder, meta


def local_to_epoch(moment, utc_offset_min):
    """Hora local sem fuso -> segundos desde 1970. Com utc_offset_min usa esse fuso; sem ele, o da maquina."""
    if utc_offset_min is None:
        return time.mktime(moment.timetuple()) + moment.microsecond / 1e6
    return calendar.timegm(moment.timetuple()) - utc_offset_min * 60 + moment.microsecond / 1e6


def parse_hwinfo_time(date_text, time_text, utc_offset_min=None):
    numbers = [int(x) for x in re.findall(r"\d+", date_text)]
    if len(numbers) != 3:
        return None
    if numbers[0] > 31:            # 2026-11-09
        year, month, day = numbers
    else:                          # 9.11.2026 (padrao do HWiNFO) ou 9/11/2026
        day, month, year = numbers
    match = re.match(r"(\d+):(\d+):(\d+)(?:[.,](\d+))?", time_text.strip())
    if not match:
        return None
    hour, minute, second = (int(match.group(i)) for i in (1, 2, 3))
    fraction = float("0." + match.group(4)) if match.group(4) else 0.0
    return local_to_epoch(datetime(year, month, day, hour, minute, second), utc_offset_min) + fraction


def read_hwinfo(path, column_pattern, utc_offset_min=None, clock_shift=0.0):
    """clock_shift = relogio do Windows - relogio de quem rodou o benchmark (WSL); e subtraido das amostras."""
    raw = open(path, "rb").read()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    rows = list(csv.reader(text.splitlines()))
    header = rows[0]
    try:
        date_col, time_col = header.index("Date"), header.index("Time")
    except ValueError:
        sys.exit("CSV do HWiNFO sem colunas Date e Time")
    matches = [i for i, name in enumerate(header) if re.search(column_pattern, name, re.I)]
    if not matches:
        sys.exit(f"Coluna '{column_pattern}' nao encontrada no HWiNFO. Algumas colunas: {header[2:12]}")
    col = matches[0]
    samples = []
    for row in rows[1:]:
        if len(row) <= col:
            continue
        stamp = parse_hwinfo_time(row[date_col], row[time_col], utc_offset_min)
        value = to_number(row[col])
        if stamp is not None and value is not None:
            samples.append((stamp - clock_shift, value))
    print(f"HWiNFO: coluna '{header[col]}', {len(samples)} amostras")
    return sorted(samples)


def read_nvidia_smi(path, utc_offset_min=None):
    samples = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 2:
                continue
            try:
                stamp = local_to_epoch(datetime.strptime(parts[0], "%Y/%m/%d %H:%M:%S.%f"), utc_offset_min)
            except ValueError:
                continue
            value = to_number(parts[1])
            if value is not None:
                samples.append((stamp, value))
    print(f"nvidia-smi: {len(samples)} amostras de potencia da GPU")
    return sorted(samples)


def integrate(samples, start, end):
    """Energia (J) na janela [start, end] por trapezios, interpolando a potencia nos limites."""
    if not samples or start < samples[0][0] or end > samples[-1][0] or end <= start:
        return None

    def power_at(t):
        lo, hi = 0, len(samples) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if samples[mid][0] <= t:
                lo = mid
            else:
                hi = mid
        (t0, p0), (t1, p1) = samples[lo], samples[hi]
        return p0 if t1 == t0 else p0 + (p1 - p0) * (t - t0) / (t1 - t0)

    points = [(start, power_at(start))] + [s for s in samples if start < s[0] < end] + [(end, power_at(end))]
    return sum((points[i + 1][0] - points[i][0]) * (points[i][1] + points[i + 1][1]) / 2
               for i in range(len(points) - 1))


def add_energy(rows, idle, samples, prefix):
    """Acrescenta energia bruta, potencia media e energia liquida (descontado o repouso)."""
    idle_powers = []
    for window in idle:
        start, end = to_number(window["inicio_epoch"]), to_number(window["fim_epoch"])
        if not samples or start is None or end is None:
            continue
        # Para a media de repouso basta a parte da janela coberta por amostras (o nvidia-smi leva ~1 s
        # para gravar a primeira); exige pelo menos 10 s de cobertura.
        start, end = max(start, samples[0][0]), min(end, samples[-1][0])
        if end - start < 10:
            continue
        energy = integrate(samples, start, end)
        if energy is not None:
            idle_powers.append(energy / (end - start))
    idle_power = statistics.fmean(idle_powers) if idle_powers else None
    missing = 0
    for row in rows:
        start, end = row.get("inicio_epoch"), row.get("fim_epoch")
        energy = integrate(samples, start, end) if isinstance(start, float) and isinstance(end, float) else None
        if energy is None:
            missing += 1
            continue
        row[f"energia_{prefix}_j"] = energy
        row[f"potencia_{prefix}_w"] = energy / (end - start)
        if idle_power is not None:
            row[f"energia_{prefix}_liq_j"] = energy - idle_power * (end - start)
    if missing:
        print(f"Aviso: {missing} execucoes fora do intervalo do registro de {prefix}")
    return idle_power


# ---------------------------------------------------------------- relatorio
def fmt(value, digits=3):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "--"
    return f"{value:.{digits}f}".replace(".", ",")


def fmt_p(p):
    return "$<$0,001" if p < 0.001 else fmt(p, 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("entrada", help="pasta do benchmark.py, benchmarks.json ou CSV")
    parser.add_argument("--hwinfo", help="CSV exportado pelo HWiNFO durante o lote")
    parser.add_argument("--coluna-cpu", default=r"^(CPU Package Power|Potência total da CPU) \[W\]",
                        help="expressao regular da coluna de potencia da CPU no HWiNFO")
    parser.add_argument("--lote", help="id do lote em benchmarks.json")
    parser.add_argument("--base", default="seq", help="configuracao de referencia do speedup")
    parser.add_argument("--comparar", action="append", default=[],
                        help='par extra a testar, no formato "omp 8=omp 16" (pode repetir)')
    parser.add_argument("--saida", help="pasta dos arquivos gerados")
    args = parser.parse_args()

    rows, idle, folder, meta = load(args.entrada, args.lote)
    out = args.saida or folder
    os.makedirs(out, exist_ok=True)
    idle_info = {}
    # Relogios: o HWiNFO grava a hora local do Windows; o benchmark (talvez no WSL) usa o proprio relogio.
    clocks = [c for c in (meta.get("relogio_windows_inicio"), meta.get("relogio_windows_fim")) if c]
    shift = statistics.fmean(c["diferenca_s"] for c in clocks) if clocks else 0.0
    windows_tz = clocks[0]["fuso_windows_min"] if clocks else None
    if clocks:
        print(f"Relogio Windows - benchmark: {shift:+.3f} s (deriva no lote: "
              f"{clocks[-1]['diferenca_s'] - clocks[0]['diferenca_s']:+.3f} s); fuso do Windows: {windows_tz:+.0f} min")
    if args.hwinfo:
        samples = read_hwinfo(args.hwinfo, args.coluna_cpu, windows_tz, shift)
        idle_info["cpu_w"] = add_energy(rows, idle, samples, "cpu")
    gpu_file = os.path.join(folder, "gpu_potencia.csv") if os.path.isdir(args.entrada) else None
    if gpu_file and os.path.exists(gpu_file) and os.path.getsize(gpu_file):
        local_tz = meta.get("maquina", {}).get("fuso_local_min")
        idle_info["gpu_w"] = add_energy(rows, idle, read_nvidia_smi(gpu_file, local_tz), "gpu")
    for row in rows:
        for suffix in ("_j", "_liq_j"):
            parts = [row.get(f"energia_cpu{suffix}"), row.get(f"energia_gpu{suffix}")]
            if all(isinstance(p, float) for p in parts):
                row[f"energia_total{suffix}"] = sum(parts)
        best = row.get("energia_total_j", row.get("energia_cpu_j", row.get("energia_j")))
        if isinstance(best, float) and isinstance(row.get("quadros"), float) and row["quadros"]:
            row["j_por_quadro"] = best / row["quadros"]
    for name, value in idle_info.items():
        if value is not None:
            print(f"Potencia media em repouso ({name}): {value:.2f} W")

    frames = {r.get("quadros") for r in rows if isinstance(r.get("quadros"), float)}
    if len(frames) > 1:
        print(f"ATENCAO: execucoes com numero de quadros diferente: {sorted(frames)}")

    groups = defaultdict(list)
    for row in rows:
        groups[row["config"]].append(row)
    configs = sorted(groups, key=config_key)
    metrics = [m for m in TIME_METRICS + ENERGY_METRICS if any(isinstance(r.get(m), float) for r in rows)]
    metrics += sorted({k for r in rows for k, v in r.items() if isinstance(v, float)
                       and k not in metrics and k not in NOT_METRICS and k != "lote"})

    def values(config, metric):
        return [r[metric] for r in groups[config] if isinstance(r.get(metric), float)]

    # --- resumo por configuracao
    summary = []
    for config in configs:
        for metric in metrics:
            vals = values(config, metric)
            if not vals:
                continue
            item = {"config": config, "metrica": metric, **describe(vals)}
            base = values(args.base, metric)
            if metric in ("tempo_total", "tempo_sem_init", "cifra") and base and config != args.base and len(vals) > 1:
                item["speedup"] = statistics.fmean(base) / item["media"]
                item["speedup_ic95_inf"], item["speedup_ic95_sup"] = bootstrap_ratio(base, vals)
            summary.append(item)

    # --- comparacoes: vizinhos de threads, melhor x segundo melhor, melhores de cada modo e pares pedidos
    def threads_of(config):
        number = re.search(r"\d+", config)
        return int(number.group()) if number else 0

    comparisons = []
    for metric in [m for m in ("tempo_total", "cifra", "energia_cpu_j", "energia_total_j", "energia_j",
                               "energia_total_liq_j", "energia_cpu_liq_j") if m in metrics]:
        pairs = []
        candidates = [c for c in configs if len(values(c, metric)) > 1]
        ranked = sorted(candidates, key=lambda c: statistics.fmean(values(c, metric)))
        if len(ranked) > 1:
            pairs.append((ranked[0], ranked[1], "melhor x 2o melhor"))
        for mode in ("omp", "pipeline"):
            same = sorted([c for c in candidates if c.startswith(mode + " ")], key=threads_of)
            pairs += [(a, b, "threads vizinhas") for a, b in zip(same, same[1:])]
        bests = [min((c for c in candidates if c.split()[0] == mode), key=lambda c: statistics.fmean(values(c, metric)))
                 for mode in ("omp", "pipeline", "cuda") if any(c.split()[0] == mode for c in candidates)]
        pairs += [(a, b, "melhores de cada modo") for i, a in enumerate(bests) for b in bests[i + 1:]]
        for text in args.comparar:
            a, _, b = (part.strip() for part in text.partition("="))
            if a in groups and b in groups:
                pairs.append((a, b, "pedido"))
            else:
                print(f"Aviso: par '{text}' ignorado (configuracoes: {', '.join(configs)})")
        seen, family = set(), []
        for a, b, why in pairs:
            if (a, b) in seen or (b, a) in seen or len(values(a, metric)) < 2 or len(values(b, metric)) < 2:
                continue
            seen.add((a, b))
            family.append({"metrica": metric, "a": a, "b": b, "motivo": why,
                           "media_a": statistics.fmean(values(a, metric)), "media_b": statistics.fmean(values(b, metric)),
                           **welch(values(a, metric), values(b, metric))})
        for item, adjusted in zip(family, holm([c["p"] for c in family])):
            item["p_holm"] = adjusted
            item["dif_pct"] = 100 * item["dif"] / item["media_b"] if item["media_b"] else float("nan")
            item["significativo_5pct"] = adjusted < 0.05
        comparisons += family

    # --- arquivos
    def write_csv(name, items):
        if not items:
            return
        keys = list(dict.fromkeys(k for item in items for k in item))
        with open(os.path.join(out, name), "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=keys)
            writer.writeheader()
            writer.writerows(items)

    write_csv("resumo.csv", summary)
    write_csv("comparacoes.csv", comparisons)
    if args.hwinfo or idle_info:
        write_csv("execucoes_com_energia.csv", rows)

    get = {(s["config"], s["metrica"]): s for s in summary}
    tex = ["% Gerado por analisar.py a partir de " + os.path.basename(os.path.normpath(args.entrada)),
           "% media +- desvio padrao amostral; IC95 da media pela distribuicao t; speedup com IC95 por bootstrap.", ""]
    if "tempo_total" in metrics:
        tex += [r"\begin{tabular}{lrrrrr}", r"\hline",
                r"\textbf{Config.} & \textbf{n} & \textbf{T. total (s)} & \textbf{IC95\% (s)} & "
                r"\textbf{Speedup [IC95\%]} & \textbf{T. cifra (s)} \\", r"\hline"]
        for config in configs:
            total = get.get((config, "tempo_total"))
            if not total:
                continue
            cipher = get.get((config, "cifra"))
            speed = (f"{fmt(total['speedup'], 2)} [{fmt(total['speedup_ic95_inf'], 2)}; "
                     f"{fmt(total['speedup_ic95_sup'], 2)}]" if "speedup" in total else "1,00")
            tex.append(rf"\texttt{{{config}}} & {total['n']} & {fmt(total['media'])} $\pm$ {fmt(total['dp'])} & "
                       rf"[{fmt(total['ic95_inf'])}; {fmt(total['ic95_sup'])}] & {speed} & "
                       + (rf"{fmt(cipher['media'])} $\pm$ {fmt(cipher['dp'])}" if cipher else "--") + r" \\")
        tex += [r"\hline", r"\end{tabular}", ""]
    if any(m in metrics for m in ("init_gpu", "kernel")):
        tex += [r"% Decomposicao do tempo do CUDA (s)", r"\begin{tabular}{lrrrrr}", r"\hline",
                r"\textbf{Config.} & \textbf{Inicializa\c{c}\~ao} & \textbf{C\'opia CPU$\to$GPU} & "
                r"\textbf{Kernel} & \textbf{C\'opia GPU$\to$CPU} & \textbf{Total sem init.} \\", r"\hline"]
        for config in configs:
            cells = [get.get((config, m)) for m in ("init_gpu", "copia_h2d", "kernel", "copia_d2h", "tempo_sem_init")]
            if any(cells):
                tex.append(rf"\texttt{{{config}}} & " + " & ".join(
                    rf"{fmt(c['media'])} $\pm$ {fmt(c['dp'])}" if c else "--" for c in cells) + r" \\")
        tex += [r"\hline", r"\end{tabular}", ""]
    energy_cols = [m for m in ("potencia_cpu_w", "energia_cpu_j", "energia_gpu_j", "energia_total_j",
                               "energia_total_liq_j", "energia_j", "j_por_quadro") if m in metrics]
    if energy_cols:
        titles = {"potencia_cpu_w": "P. m\\'edia CPU (W)", "energia_cpu_j": "$E_{CPU}$ (J)",
                  "energia_gpu_j": "$E_{GPU}$ (J)", "energia_total_j": "$E_{CPU+GPU}$ (J)",
                  "energia_total_liq_j": "$E$ l\\'iquida (J)", "energia_j": "Energia (J)", "j_por_quadro": "J/quadro"}
        tex += [r"\begin{tabular}{l" + "r" * len(energy_cols) + "}", r"\hline",
                r"\textbf{Config.} & " + " & ".join(rf"\textbf{{{titles[m]}}}" for m in energy_cols) + r" \\", r"\hline"]
        for config in configs:
            cells = [get.get((config, m)) for m in energy_cols]
            if any(cells):
                digits = lambda m: 4 if m == "j_por_quadro" else 1
                tex.append(rf"\texttt{{{config}}} & " + " & ".join(
                    rf"{fmt(c['media'], digits(m))} $\pm$ {fmt(c['dp'], digits(m))}" if c else "--"
                    for c, m in zip(cells, energy_cols)) + r" \\")
        tex += [r"\hline", r"\end{tabular}", ""]
    if comparisons:
        tex += [r"% Comparacoes: teste t de Welch, p corrigido por Holm dentro de cada metrica",
                r"\begin{tabular}{llrrr}", r"\hline",
                r"\textbf{M\'etrica} & \textbf{A $\times$ B} & \textbf{A$-$B [IC95\%]} & \textbf{Dif. (\%)} & "
                r"\textbf{$p$ (Holm)} \\", r"\hline"]
        for c in comparisons:
            metric_tex = c["metrica"].replace("_", "\\_")
            tex.append(rf"{metric_tex} & \texttt{{{c['a']}}} $\times$ \texttt{{{c['b']}}} & "
                       rf"{fmt(c['dif'])} [{fmt(c['ic95_inf'])}; {fmt(c['ic95_sup'])}] & {fmt(c['dif_pct'], 1)} & "
                       rf"{fmt_p(c['p_holm'])} \\")
        tex += [r"\hline", r"\end{tabular}", ""]
    with open(os.path.join(out, "tabelas.tex"), "w", encoding="utf-8") as f:
        f.write("\n".join(tex))

    # --- resumo no terminal
    print(f"\n{'config':<15}{'n':>3}{'media':>10}{'dp':>9}{'CV%':>7}{'IC95%':>22}{'speedup':>9}   metrica")
    for s in summary:
        if s["metrica"] not in ("tempo_total", "energia_cpu_j", "energia_total_j", "energia_j"):
            continue
        interval = "[{:.3f}; {:.3f}]".format(s["ic95_inf"], s["ic95_sup"])
        speedup = s.get("speedup", 1.0 if s["config"] == args.base else float("nan"))
        print(f"{s['config']:<15}{s['n']:>3}{s['media']:>10.3f}{s['dp']:>9.3f}{s['cv_pct']:>7.1f}"
              f"{interval:>22}{speedup:>9.2f}   {s['metrica']}")
    if comparisons:
        print("\nComparacoes (Welch, p corrigido por Holm):")
        for c in comparisons:
            mark = "*" if c["significativo_5pct"] else " "
            print(f" {mark} {c['metrica']:<16}{c['a']:>14} x {c['b']:<14} dif={c['dif']:+.3f} ({c['dif_pct']:+.1f}%) "
                  f"IC95=[{c['ic95_inf']:+.3f}; {c['ic95_sup']:+.3f}] p_holm={c['p_holm']:.4f}")
    print(f"\nArquivos em {out}: resumo.csv, comparacoes.csv, tabelas.tex")


if __name__ == "__main__":
    main()
