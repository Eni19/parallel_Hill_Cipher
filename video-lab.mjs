// Laboratorio de video: conversa com server.py, que executa video_hill e o FFmpeg na maquina local.
const $ = id => document.getElementById(id);
const MODE_COLORS = { seq: '#3987e5', omp: '#d95926', pipeline: '#199e70' };
const STAGES = [
  { key: 'leitura', label: 'Leitura', color: '#c98500' },
  { key: 'cifra', label: 'Cifra', color: '#d55181' },
  { key: 'gravacao', label: 'Gravação', color: '#9085e9' }
];
const HIST_COLORS = { original: '#94a3b8', cifrado: '#d55181' };
const METRICS = {
  tempo_total: { label: 'Tempo total', unit: 's', better: 'menor' },
  cifra: { label: 'Tempo da cifra', unit: 's', better: 'menor' },
  fps: { label: 'Quadros por segundo', unit: 'qps', better: 'maior' }
};
const SVG = 'http://www.w3.org/2000/svg';
const fmt = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBytes = b => b >= 1 << 30 ? `${fmt(b / (1 << 30), 2)} GB` : `${fmt(b / (1 << 20), 1)} MB`;

let state = { info: null, batches: [], polling: false, lastKind: null };

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// ---------- tooltip compartilhado ----------
const tip = $('video-tooltip');
function showTip(event, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => { tip.hidden = true; };

function legend(container, items) {
  container.innerHTML = items.map(i =>
    `<span><i style="background:${i.color}${i.dashed ? ';height:0;border-top:2px dashed ' + i.color + ';background:none' : ''}"></i>${i.label}</span>`).join('');
}

// ---------- escalas e eixos ----------
// Maximo do eixo = 4 marcas de passo "redondo" (1, 2, 2,5, 3, 4 ou 5 vezes uma potencia de 10).
function niceMax(v) {
  if (v <= 0) return 1;
  const raw = v / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return 4 * ([1, 2, 2.5, 3, 4, 5, 10].find(s => n <= s)) * p;
}

function frame(container, { width = 520, height = 300, left = 52, right = 18, top = 14, bottom = 42 } = {}) {
  container.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'video-svg', role: 'img' }, container);
  return { svg, width, height, x0: left, x1: width - right, y0: height - bottom, y1: top };
}

const tickFmt = v => fmt(v, Number.isInteger(v) ? 0 : Number.isInteger(v * 10) ? 1 : 2);

function axes(f, { xTicks, xLabel, yMax, yLabel, yFmt = tickFmt }) {
  const g = el('g', { class: 'axis' }, f.svg);
  const ys = v => f.y0 - (v / yMax) * (f.y0 - f.y1);
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i, y = ys(v);
    el('line', { x1: f.x0, x2: f.x1, y1: y, y2: y, class: i ? 'grid' : 'baseline' }, g);
    el('text', { x: f.x0 - 8, y: y + 4, 'text-anchor': 'end' }, g).textContent = yFmt(v);
  }
  xTicks.forEach(t => {
    el('text', { x: t.x, y: f.y0 + 18, 'text-anchor': 'middle' }, g).textContent = t.label;
  });
  el('text', { x: (f.x0 + f.x1) / 2, y: f.height - 6, 'text-anchor': 'middle', class: 'axis-title' }, g).textContent = xLabel;
  const yt = el('text', { x: 12, y: (f.y0 + f.y1) / 2, 'text-anchor': 'middle', class: 'axis-title',
    transform: `rotate(-90 12 ${(f.y0 + f.y1) / 2})` }, g);
  yt.textContent = yLabel;
  return ys;
}

// ---------- graficos do benchmark ----------
function median(values) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate(batch) {
  const groups = new Map();
  for (const r of batch.runs) {
    const key = `${r.modo}|${r.threads}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].map(([key, runs]) => {
    const [mode, threads] = key.split('|');
    const stat = k => {
      const vals = runs.map(r => Number(r[k]));
      return { med: median(vals), min: Math.min(...vals), max: Math.max(...vals) };
    };
    return { mode, threads: Number(threads), n: runs.length, frames: runs[0].quadros,
      tempo_total: stat('tempo_total'), cifra: stat('cifra'), leitura: stat('leitura'),
      gravacao: stat('gravacao'), fps: stat('fps') };
  }).sort((a, b) => (a.mode > b.mode) - (a.mode < b.mode) || a.threads - b.threads);
}

function lineChart(container, { series, refs = [], xs, xLabel, yLabel, ideal }) {
  const f = frame(container, { right: 70 });
  // A linha ideal nao estica a escala: ela e cortada no topo do grafico.
  const allY = series.flatMap(s => s.points.flatMap(p => [p.max ?? p.y, p.y])).concat(refs.map(r => r.y));
  const yMax = niceMax(Math.max(...allY) * 1.08);
  const step = (f.x1 - f.x0 - 30) / Math.max(1, xs.length - 1);
  const xPos = x => f.x0 + 15 + xs.indexOf(x) * step;
  const ys = axes(f, { xTicks: xs.map(x => ({ x: xPos(x), label: x })), xLabel, yMax, yLabel });
  if (ideal) {
    const clip = el('clipPath', { id: `clip-${container.id}` }, f.svg);
    el('rect', { x: f.x0, y: f.y1, width: f.x1 - f.x0, height: f.y0 - f.y1 }, clip);
    el('polyline', { points: xs.map(x => `${xPos(x)},${ys(x)}`).join(' '), class: 'ref-line', stroke: '#64748b',
      'clip-path': `url(#clip-${container.id})` }, f.svg);
  }
  refs.forEach(r => {
    el('line', { x1: f.x0, x2: f.x1, y1: ys(r.y), y2: ys(r.y), class: 'ref-line', stroke: r.color }, f.svg);
    const hit = el('line', { x1: f.x0, x2: f.x1, y1: ys(r.y), y2: ys(r.y), class: 'hit-line' }, f.svg);
    hit.addEventListener('mousemove', e => showTip(e, r.tip));
    hit.addEventListener('mouseleave', hideTip);
  });
  const labels = [];
  series.forEach(s => {
    const pts = s.points.map(p => `${xPos(p.x)},${ys(p.y)}`).join(' ');
    el('polyline', { points: pts, class: 'data-line', stroke: s.color }, f.svg);
    s.points.forEach(p => {
      if (p.min !== undefined) el('line', { x1: xPos(p.x), x2: xPos(p.x), y1: ys(p.min), y2: ys(p.max), class: 'whisker', stroke: s.color }, f.svg);
      el('circle', { cx: xPos(p.x), cy: ys(p.y), r: 5, fill: s.color, class: 'data-dot' }, f.svg);
      const hit = el('circle', { cx: xPos(p.x), cy: ys(p.y), r: 14, class: 'hit' }, f.svg);
      hit.addEventListener('mousemove', e => showTip(e, p.tip));
      hit.addEventListener('mouseleave', hideTip);
    });
    const last = s.points[s.points.length - 1];
    if (last) labels.push({ x: xPos(last.x) + 9, y: ys(last.y) + 4, name: s.name });
  });
  // Rotulos diretos no fim das linhas, afastados para nao se sobreporem.
  labels.sort((a, b) => a.y - b.y).forEach((l, i, all) => {
    if (i && l.y - all[i - 1].y < 14) l.y = all[i - 1].y + 14;
    el('text', { x: l.x, y: l.y, class: 'direct-label' }, f.svg).textContent = l.name;
  });
  f.svg.setAttribute('aria-label', `${yLabel} por ${xLabel}`);
}

function stageChart(container, rows) {
  const rowH = 30, height = 20 + rows.length * rowH + 34;
  const f = frame(container, { width: 1000, height, left: 120, right: 24, top: 10, bottom: 34 });
  const maxV = niceMax(Math.max(...rows.map(r => Math.max(r.leitura.med + r.cifra.med + r.gravacao.med, r.tempo_total.med))) * 1.05);
  const xs = v => f.x0 + (v / maxV) * (f.x1 - f.x0);
  const g = el('g', { class: 'axis' }, f.svg);
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i;
    el('line', { x1: xs(v), x2: xs(v), y1: f.y1, y2: f.y0, class: i ? 'grid' : 'baseline' }, g);
    el('text', { x: xs(v), y: f.y0 + 16, 'text-anchor': 'middle' }, g).textContent = `${tickFmt(v)} s`;
  }
  rows.forEach((r, i) => {
    const y = f.y1 + 8 + i * rowH;
    el('text', { x: f.x0 - 10, y: y + 13, 'text-anchor': 'end', class: 'row-label' }, f.svg).textContent =
      r.mode === 'seq' ? 'seq' : `${r.mode} ${r.threads}${r.mode === 'pipeline' ? '+2' : ''}`;
    let acc = 0;
    STAGES.forEach((s, k) => {
      const v = r[s.key].med, x = xs(acc), w = Math.max(0, xs(acc + v) - x - (k < 2 ? 2 : 0));
      const rect = el('rect', { x, y, width: w, height: 18, rx: k === 2 ? 4 : 0, fill: s.color }, f.svg);
      rect.addEventListener('mousemove', e => showTip(e, `<b>${r.mode} · ${r.threads} thread(s)</b><br>${s.label}: ${fmt(v)} s<br>Tempo total: ${fmt(r.tempo_total.med)} s`));
      rect.addEventListener('mouseleave', hideTip);
      acc += v;
    });
    el('line', { x1: xs(r.tempo_total.med), x2: xs(r.tempo_total.med), y1: y - 4, y2: y + 22, class: 'total-tick' }, f.svg);
  });
  f.svg.setAttribute('aria-label', 'Tempo de leitura, cifra e gravação por configuração');
}

function renderBench() {
  const select = $('bench-batch');
  const batches = state.batches;
  if (!batches.length) {
    select.innerHTML = '<option>Nenhuma rodada ainda</option>';
    ['chart-time', 'chart-speedup', 'chart-stages'].forEach(id => { $(id).innerHTML = '<p class="image-hint">Rode o benchmark para ver os gráficos.</p>'; });
    $('bench-table').innerHTML = '';
    $('bench-meta').textContent = '';
    return;
  }
  const chosen = select.value;
  select.innerHTML = batches.map((b, i) => `<option value="${i}">${b.date} · ${b.seconds} s · ${b.reps} rep.${b.discard ? ' · sem disco' : ' · com disco'}</option>`).reverse().join('');
  select.value = chosen && batches[chosen] ? chosen : String(batches.length - 1);
  const batch = batches[Number(select.value)];
  const rows = aggregate(batch);
  const metricKey = $('bench-metric').value, metric = METRICS[metricKey];
  const seq = rows.find(r => r.mode === 'seq');
  $('bench-meta').textContent = `${batch.cpu} · ${batch.cores} núcleos lógicos · ${rows[0]?.frames ?? '?'} quadros · ${batch.runs.length} execuções`;

  const threadsUsed = [...new Set(rows.filter(r => r.mode !== 'seq').map(r => r.threads))].sort((a, b) => a - b);
  const xs = threadsUsed.length ? threadsUsed : [1];
  const modes = ['omp', 'pipeline'].filter(m => rows.some(r => r.mode === m));
  legend($('bench-legend'), [{ label: 'seq (referência)', color: MODE_COLORS.seq, dashed: true },
    ...modes.map(m => ({ label: m === 'pipeline' ? 'pipeline (+2 threads de E/S)' : 'omp', color: MODE_COLORS[m] }))]);

  const pointTip = (r, k) => `<b>${r.mode} · ${r.threads} thread(s)${r.mode === 'pipeline' ? ' + 2' : ''}</b><br>${METRICS[k].label}: ${fmt(r[k].med)} ${METRICS[k].unit} (mediana)<br>min ${fmt(r[k].min)} · max ${fmt(r[k].max)} · ${r.n} execuções`;
  const series = modes.map(m => ({
    name: m, color: MODE_COLORS[m],
    points: rows.filter(r => r.mode === m).map(r => ({ x: r.threads, y: r[metricKey].med, min: r[metricKey].min, max: r[metricKey].max, tip: pointTip(r, metricKey) }))
  }));
  const refs = seq ? [{ y: seq[metricKey].med, color: MODE_COLORS.seq, tip: pointTip(seq, metricKey) }] : [];
  $('chart-time-title').textContent = `${metric.label} por número de threads (${metric.better} é melhor)`;
  lineChart($('chart-time'), { series, refs, xs, xLabel: 'threads de cifra', yLabel: `${metric.label} (${metric.unit})` });

  if (seq) {
    const speed = (r) => metricKey === 'fps' ? r.fps.med / seq.fps.med : seq[metricKey].med / r[metricKey].med;
    const sSeries = modes.map(m => ({
      name: m, color: MODE_COLORS[m],
      points: rows.filter(r => r.mode === m).map(r => ({ x: r.threads, y: speed(r),
        tip: `<b>${r.mode} · ${r.threads} thread(s)</b><br>Speedup: ${fmt(speed(r))}×<br>Eficiência: ${fmt(speed(r) / r.threads * 100, 0)}%` }))
    }));
    $('chart-speedup-title').textContent = `Speedup sobre o seq (${metric.label.toLowerCase()}); tracejado cinza = ideal`;
    lineChart($('chart-speedup'), { series: sSeries, refs: [{ y: 1, color: MODE_COLORS.seq, tip: '<b>seq</b><br>Speedup 1×' }], xs, xLabel: 'threads de cifra', yLabel: 'speedup (×)', ideal: true });
  }

  legend($('stage-legend'), STAGES.map(s => ({ label: s.label, color: s.color })).concat([{ label: 'Tempo total', color: '#f8fafc' }]));
  const order = { seq: 0, omp: 1, pipeline: 2 };
  stageChart($('chart-stages'), [...rows].sort((a, b) => order[a.mode] - order[b.mode] || a.threads - b.threads));

  const cell = s => `${fmt(s.med)} <small>(${fmt(s.min)}–${fmt(s.max)})</small>`;
  $('bench-table').innerHTML = `<thead><tr><th>Modo</th><th>Threads</th><th>Total (s)</th><th>Leitura (s)</th><th>Cifra (s)</th><th>Gravação (s)</th><th>Quadros/s</th><th>Speedup total</th><th>Speedup cifra</th></tr></thead><tbody>${
    rows.map(r => `<tr><td>${r.mode}</td><td>${r.threads}${r.mode === 'pipeline' ? '+2' : ''}</td><td>${cell(r.tempo_total)}</td><td>${cell(r.leitura)}</td><td>${cell(r.cifra)}</td><td>${cell(r.gravacao)}</td><td>${cell(r.fps)}</td><td>${seq ? fmt(seq.tempo_total.med / r.tempo_total.med) + '×' : '—'}</td><td>${seq ? fmt(seq.cifra.med / r.cifra.med) + '×' : '—'}</td></tr>`).join('')}</tbody>`;
}

// ---------- analise do quadro ----------
function histChart(container, plane, analysis) {
  const f = frame(container, { width: 340, height: 220, left: 44, right: 10, top: 10, bottom: 38 });
  const toPct = h => { const n = h.reduce((a, b) => a + b, 0); return h.map(c => (c / n) * 100); };
  const orig = toPct(analysis.original[plane].hist), enc = toPct(analysis.cifrado[plane].hist);
  const yMax = niceMax(Math.max(...orig, ...enc) * 1.05);
  const xs = v => f.x0 + (v / 255) * (f.x1 - f.x0);
  const ys = axes(f, { xTicks: [0, 64, 128, 192, 255].map(v => ({ x: xs(v), label: v })), xLabel: 'valor do byte',
    yMax, yLabel: '% dos bytes' });
  const area = vals => `M${xs(0)},${ys(0)} ` + vals.map((v, i) => `L${xs(i)},${ys(v)}`).join(' ') + ` L${xs(255)},${ys(0)} Z`;
  el('path', { d: area(orig), fill: HIST_COLORS.original, 'fill-opacity': 0.35, stroke: HIST_COLORS.original, 'stroke-width': 1.5 }, f.svg);
  el('polyline', { points: enc.map((v, i) => `${xs(i)},${ys(v)}`).join(' '), class: 'data-line', stroke: HIST_COLORS.cifrado, 'stroke-width': 1.5 }, f.svg);
  const cross = el('line', { y1: f.y1, y2: f.y0, class: 'crosshair', visibility: 'hidden' }, f.svg);
  const hit = el('rect', { x: f.x0, y: f.y1, width: f.x1 - f.x0, height: f.y0 - f.y1, class: 'hit' }, f.svg);
  hit.addEventListener('mousemove', e => {
    const box = f.svg.getBoundingClientRect();
    const sx = (e.clientX - box.left) * (f.width / box.width);
    const bin = Math.max(0, Math.min(255, Math.round(((sx - f.x0) / (f.x1 - f.x0)) * 255)));
    cross.setAttribute('x1', xs(bin)); cross.setAttribute('x2', xs(bin)); cross.setAttribute('visibility', 'visible');
    showTip(e, `<b>Plano ${plane} · valor ${bin}</b><br>Original: ${fmt(orig[bin], 3)}%<br>Cifrado: ${fmt(enc[bin], 3)}%`);
  });
  hit.addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
  f.svg.setAttribute('aria-label', `Histograma do plano ${plane}: original e cifrado`);
}

function renderAnalysis(a) {
  const planes = ['Y', 'U', 'V'];
  legend($('video-hist-legend'), [{ label: 'Original', color: HIST_COLORS.original }, { label: 'Cifrado', color: HIST_COLORS.cifrado }]);
  $('video-hists').innerHTML = planes.map(p => `<figure class="video-chart"><figcaption>Plano ${p} ${p === 'Y' ? '(brilho)' : '(cor)'}</figcaption><div id="hist-${p}"></div></figure>`).join('');
  planes.forEach(p => histChart($(`hist-${p}`), p, a));
  $('video-metrics').innerHTML = planes.map(p => {
    const o = a.original[p], c = a.cifrado[p];
    return `<div class="video-metric"><span>Plano ${p}</span>
      <dl><dt>Entropia</dt><dd>${fmt(o.entropy)} → <b>${fmt(c.entropy)}</b> bits</dd>
      <dt>Correlação vizinhos</dt><dd>${fmt(o.correlation, 3)} → <b>${fmt(c.correlation, 3)}</b></dd>
      <dt>Valores distintos</dt><dd>${o.distinct} → <b>${c.distinct}</b></dd></dl></div>`;
  }).join('');
  const weak = planes.filter(p => a.cifrado[p].entropy < 7.9);
  const leak = $('video-leak');
  leak.hidden = !weak.length;
  if (weak.length) {
    leak.innerHTML = `<b>Vazamento detectado nos planos ${weak.join(', ')}:</b> a entropia do cifrado ficou abaixo de 7,9 bits. Em áreas de cor neutra, U e V valem 128; um bloco [128,128,128,128] vezes qualquer K só pode dar 0 ou 128 (mod 256), então essas regiões continuam visíveis. É uma limitação da cifra de Hill linear (C = K·P), não do paralelismo.`;
  }
}

// ---------- linhas do tempo esquematicas dos modos ----------
// Unidades: ler = 1, gravar = 1, cifrar = 3 com uma thread (1 com tres threads). Tres quadros.
const TIMELINES = [
  { title: 'seq', note: '1 thread', rows: [
    ['thread 0', [[0, 1, 'L', 0], [1, 3, 'C', 0], [4, 1, 'G', 0], [5, 1, 'L', 1], [6, 3, 'C', 1], [9, 1, 'G', 1], [10, 1, 'L', 2], [11, 3, 'C', 2], [14, 1, 'G', 2]]]
  ] },
  { title: 'omp 3', note: '3 threads', rows: [
    ['thread 0', [[0, 1, 'L', 0], [1, 1, 'C', 0], [2, 1, 'G', 0], [3, 1, 'L', 1], [4, 1, 'C', 1], [5, 1, 'G', 1], [6, 1, 'L', 2], [7, 1, 'C', 2], [8, 1, 'G', 2]]],
    ['thread 1', [[1, 1, 'C', 0], [4, 1, 'C', 1], [7, 1, 'C', 2]]],
    ['thread 2', [[1, 1, 'C', 0], [4, 1, 'C', 1], [7, 1, 'C', 2]]]
  ] },
  { title: 'pipeline 3+2', note: '5 threads', rows: [
    ['leitora', [[0, 1, 'L', 0], [1, 1, 'L', 1], [2, 1, 'L', 2]]],
    ['cifra 1', [[1, 1, 'C', 0], [2, 1, 'C', 1], [3, 1, 'C', 2]]],
    ['cifra 2', [[1, 1, 'C', 0], [2, 1, 'C', 1], [3, 1, 'C', 2]]],
    ['cifra 3', [[1, 1, 'C', 0], [2, 1, 'C', 1], [3, 1, 'C', 2]]],
    ['gravadora', [[2, 1, 'G', 0], [3, 1, 'G', 1], [4, 1, 'G', 2]]]
  ] }
];

function renderTimelines() {
  const colors = { L: STAGES[0].color, C: STAGES[1].color, G: STAGES[2].color };
  const names = { L: 'lê', C: 'cifra', G: 'grava' };
  legend($('mode-legend'), [...STAGES.map(s => ({ label: s.label, color: s.color })), { label: 'Esperando', color: '#1e293b' }]);
  $('mode-timelines').innerHTML = TIMELINES.map(t => {
    const end = Math.max(...t.rows.flatMap(([, blocks]) => blocks.map(([s, len]) => s + len)));
    return `<div class="mode-timeline"><div class="mode-head"><b>${t.title}</b><span>${t.note} · termina em <b>${end}</b> unidades</span></div>${
      t.rows.map(([label, blocks]) => `<div class="mode-row"><span class="mode-label">${label}</span><div class="mode-track">${
        blocks.map(([start, len, stage, q]) => `<span class="mode-block" style="grid-column:${start + 1} / span ${len};background:${colors[stage]}" title="${label}: ${names[stage]} o quadro ${q}">${names[stage]} Q${q}</span>`).join('')
      }</div></div>`).join('')}</div>`;
  }).join('');
}

// ---------- resultado do laboratorio ----------
function renderDemo(d) {
  const v = `?v=${d.version}`;
  [['video-original', 'prev_original.mp4'], ['video-cifrado', 'prev_cifrado.mp4'], ['video-decifrado', 'prev_decifrado.mp4']]
    .forEach(([id, file]) => { $(id).src = `video_lab/${file}${v}`; });
  $('video-play').disabled = false;
  $('video-seek').disabled = false;
  const check = $('video-check');
  check.hidden = false;
  check.className = `video-check ${d.identical ? 'ok' : 'fail'}`;
  check.innerHTML = d.identical
    ? `<b>✓ Decifrado idêntico ao original</b><span>SHA-256 dos quadros: <code>${d.hash_original.slice(0, 16)}…</code> nos dois arquivos</span>`
    : `<b>✗ Decifrado diferente do original</b><span>original <code>${d.hash_original.slice(0, 16)}…</code> · decifrado <code>${d.hash_decifrado.slice(0, 16)}…</code></span>`;
  const e = d.encrypt, x = d.decrypt;
  const row = (label, k, unit = 's', dec = 3) => `<tr><th scope="row">${label}</th><td>${fmt(e[k], dec)} ${unit}</td><td>${fmt(x[k], dec)} ${unit}</td></tr>`;
  $('video-stats').querySelector('tbody').innerHTML = [
    `<tr><th scope="row">Configuração</th><td>${e.modo} · ${e.threads}${e.modo === 'pipeline' ? '+2' : ''} thread(s)</td><td>${x.modo} · ${x.threads}${x.modo === 'pipeline' ? '+2' : ''} thread(s)</td></tr>`,
    `<tr><th scope="row">Quadros</th><td>${e.quadros} · ${e.resolucao}</td><td>${x.quadros} · ${x.resolucao}</td></tr>`,
    row('Tempo total', 'tempo_total'), row('Leitura (ocupada)', 'leitura'), row('Cifra', 'cifra'),
    row('Gravação (ocupada)', 'gravacao'), row('Quadros por segundo', 'fps', 'qps', 1),
    `<tr><th scope="row">Arquivo gerado</th><td>cifrado.mkv (raw) · ${fmtBytes(d.sizes['cifrado.mkv'])}</td><td>decifrado.mkv (FFV1) · ${fmtBytes(d.sizes['decifrado.mkv'])}</td></tr>`
  ].join('');
  $('video-source').innerHTML = `Trecho de ${d.params.seconds} s a partir de ${d.params.start} s do <code>video.mp4</code> (${fmtBytes(d.sizes['trecho.mp4'])}), semente ${d.params.seed}.`;
  renderAnalysis(d.analysis);
}

// ---------- players sincronizados ----------
const players = () => ['video-original', 'video-cifrado', 'video-decifrado'].map($);
function setupSync() {
  const [master] = players();
  $('video-play').addEventListener('click', () => {
    const all = players();
    if (master.paused) { all.forEach(p => { p.currentTime = master.currentTime; p.play().catch(() => {}); }); $('video-play').textContent = 'Pausar os três'; }
    else { all.forEach(p => p.pause()); $('video-play').textContent = 'Reproduzir os três'; }
  });
  master.addEventListener('timeupdate', () => {
    if (master.duration) $('video-seek').value = Math.round((master.currentTime / master.duration) * 1000);
    $('video-time').textContent = `${fmt(master.currentTime, 1)} s`;
    players().slice(1).forEach(p => { if (Math.abs(p.currentTime - master.currentTime) > 0.2) p.currentTime = master.currentTime; });
  });
  master.addEventListener('ended', () => { players().forEach(p => p.pause()); $('video-play').textContent = 'Reproduzir os três'; });
  $('video-seek').addEventListener('input', e => {
    if (!master.duration) return;
    const t = (e.target.value / 1000) * master.duration;
    players().forEach(p => { p.currentTime = t; });
  });
}

// ---------- trabalhos e progresso ----------
function setBusy(busy) {
  $('video-run').disabled = busy;
  $('bench-run').disabled = busy;
  $('video-cancel').hidden = !busy;
}

function showJob(job) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  $('video-progress-bar').style.width = `${job.busy ? Math.max(4, pct) : job.error ? 0 : 100}%`;
  const status = $('video-status');
  status.classList.toggle('error', Boolean(job.error));
  status.textContent = job.error ? `Erro: ${job.error}` : job.busy
    ? `${job.kind === 'bench' ? 'Benchmark' : 'Laboratório'}: ${job.step}${job.total ? ` (${job.done}/${job.total})` : ''}…`
    : job.kind ? `${job.kind === 'bench' ? 'Benchmark concluído.' : 'Concluído.'}` : '';
}

async function poll() {
  if (state.polling) return;
  state.polling = true;
  setBusy(true);
  try {
    for (;;) {
      const job = await api('/api/job');
      showJob(job);
      if (!job.busy) {
        if (!job.error && job.result) {
          if (job.kind === 'demo') renderDemo(job.result);
          if (job.kind === 'bench') { state.batches = await api('/api/bench'); $('bench-batch').value = ''; renderBench(); }
        }
        break;
      }
      await new Promise(r => setTimeout(r, 700));
    }
  } catch (err) {
    $('video-status').textContent = `Erro ao consultar o servidor: ${err.message}`;
  } finally {
    state.polling = false;
    setBusy(false);
  }
}

async function start(path, body) {
  try {
    await api(path, body);
    poll();
  } catch (err) {
    $('video-status').classList.add('error');
    $('video-status').textContent = `Erro: ${err.message}`;
  }
}

function updateEstimate() {
  const modes = [...document.querySelectorAll('[name=bench-mode]:checked')].map(i => i.value);
  const threads = [...document.querySelectorAll('[name=bench-thread]:checked')].length;
  const reps = Number($('bench-reps').value) || 1;
  const runs = (1 + modes.length * threads) * reps;
  $('bench-estimate').textContent = `${runs} execuções do programa`;
}

async function init() {
  renderTimelines();
  setupSync();
  const threadHint = () => {
    const mode = $('video-mode').value, n = Number($('video-threads').value);
    $('video-threads').disabled = mode === 'seq';
    $('video-threads-value').textContent = mode === 'pipeline' ? `${n} + 2` : mode === 'seq' ? '1' : n;
    $('video-threads-hint').textContent = mode === 'seq' ? 'O modo seq usa sempre 1 thread: ela lê, cifra e grava.'
      : mode === 'pipeline' ? `pipeline ${n}+2 = ${n + 2} threads: ${n} só cifram, 1 só lê e 1 só grava, todas ao mesmo tempo.`
        : `omp ${n} = ${n} threads: elas dividem a cifra de cada quadro; a thread principal também lê e grava, enquanto as outras esperam.`;
  };
  $('video-threads').addEventListener('input', threadHint);
  $('video-mode').addEventListener('change', threadHint);
  threadHint();
  $('video-run').addEventListener('click', () => start('/api/demo', {
    mode: $('video-mode').value, threads: Number($('video-threads').value), seed: $('video-seed').value.trim(),
    start: Number($('video-start').value), seconds: Number($('video-seconds').value)
  }));
  $('video-cancel').addEventListener('click', () => api('/api/cancel', {}).catch(() => {}));
  $('bench-run').addEventListener('click', () => start('/api/bench', {
    modes: [...document.querySelectorAll('[name=bench-mode]:checked')].map(i => i.value),
    threads: [...document.querySelectorAll('[name=bench-thread]:checked')].map(i => Number(i.value)),
    reps: Number($('bench-reps').value), seconds: Number($('bench-seconds').value),
    start: Number($('video-start').value), discard: $('bench-discard').checked
  }));
  $('bench-batch').addEventListener('change', renderBench);
  $('bench-metric').addEventListener('change', renderBench);
  document.querySelector('.video-bench-controls').addEventListener('change', updateEstimate);

  let info;
  try {
    info = await api('/api/video/info');
  } catch {
    $('video-server').className = 'video-banner error';
    $('video-server').innerHTML = 'O servidor do laboratório não respondeu. Inicie o site com <code>python server.py</code> e abra <code>http://localhost:8085</code>.';
    setBusy(false); $('video-run').disabled = true; $('bench-run').disabled = true;
    renderBench();
    return;
  }
  state.info = info;
  const maxThreads = Math.max(8, info.cores || 4);
  $('video-threads').max = maxThreads;
  $('bench-threads').innerHTML = Array.from({ length: maxThreads }, (_, i) => i + 1)
    .map(t => `<label class="video-chip"><input type="checkbox" name="bench-thread" value="${t}"${t <= Math.min(4, info.cores || 4) ? ' checked' : ''}> ${t}</label>`).join('');
  updateEstimate();
  const problems = [!info.ffmpeg && 'FFmpeg não encontrado', !info.binary && 'video_hill não compilado', !info.source && 'video.mp4 ausente'].filter(Boolean);
  const banner = $('video-server');
  if (problems.length) {
    banner.className = 'video-banner error';
    banner.textContent = `Servidor ativo, mas falta: ${problems.join(' · ')}. Veja o README.`;
    $('video-run').disabled = true; $('bench-run').disabled = true;
  } else {
    const i = info.info;
    banner.className = 'video-banner ok';
    banner.innerHTML = `Servidor pronto · <b>video.mp4</b>: ${i.width}×${i.height}, ${fmt(i.fps, 2)} qps, ${fmt(i.duration, 1)} s, ${i.codec}/${i.pix_fmt} · ${info.cpu} (${info.cores} núcleos lógicos)`;
    $('video-start').max = Math.max(0, Math.floor(i.duration) - 1);
  }
  if (info.demo) renderDemo(info.demo);
  state.batches = await api('/api/bench').catch(() => []);
  renderBench();
  if (info.job?.busy) poll();
}

init();
