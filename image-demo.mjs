import { matrixForBlock } from './image-core.mjs';

const $ = id => document.getElementById(id);
const state = { width: 0, height: 0, channels: 3, input: null, output: null, original: null, block: 0, busy: false, gpuInfo: null, gpuBatchBytes: null };

function status(message, error = false) {
  $('image-status').textContent = message;
  $('image-status').classList.toggle('error', error);
}

function seed() {
  const text = $('image-seed').value.trim();
  if (!/^\d+$/.test(text)) throw new Error('Digite uma semente decimal entre 0 e 2⁶⁴ − 1.');
  const value = BigInt(text);
  if (value > (1n << 64n) - 1n) throw new Error('A semente deve caber em 64 bits.');
  return value;
}

function draw(canvas, bytes) {
  canvas.width = state.width;
  canvas.height = state.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, state.width, state.height);
  if (!bytes) return;
  const rgba = ctx.createImageData(state.width, state.height);
  for (let p = 0, j = 0; p < state.width * state.height; p++) {
    const i = p * 4;
    if (state.channels === 1) {
      rgba.data[i] = rgba.data[i + 1] = rgba.data[i + 2] = bytes[j++];
    } else {
      rgba.data[i] = bytes[j++];
      rgba.data[i + 1] = bytes[j++];
      rgba.data[i + 2] = bytes[j++];
    }
    rgba.data[i + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);
}

function setInput(width, height, channels, bytes, label) {
  if (!width || !height || width * height > 1500000) throw new Error('Use uma imagem de até 1,5 milhão de pixels nesta demonstração.');
  state.width = width;
  state.height = height;
  state.channels = channels;
  state.input = bytes;
  state.original = bytes.slice();
  state.output = null;
  state.gpuBatchBytes = null;
  state.block = 0;
  draw($('image-input-canvas'), bytes);
  draw($('image-output-canvas'), null);
  $('image-input-caption').textContent = `Entrada: ${label}`;
  $('image-output-caption').textContent = 'Resultado';
  $('image-dimensions').textContent = `${width} × ${height}`;
  $('image-blocks').textContent = Math.ceil(bytes.length / 4).toLocaleString('pt-BR');
  $('image-time').textContent = '—';
  $('image-check').textContent = '—';
  $('image-reuse').disabled = $('image-download').disabled = $('image-download-pnm').disabled = true;
  renderDetails();
  status(`${label} pronta: ${bytes.length.toLocaleString('pt-BR')} bytes em ${Math.ceil(bytes.length / 4).toLocaleString('pt-BR')} blocos.`);
}

function readPnm(buffer) {
  const data = new Uint8Array(buffer);
  let pos = 0;
  const next = () => {
    while (pos < data.length) {
      if (data[pos] === 35) { while (pos < data.length && data[pos] !== 10) pos++; }
      else if (data[pos] <= 32) pos++;
      else break;
    }
    const start = pos;
    while (pos < data.length && data[pos] > 32) pos++;
    const value = new TextDecoder('ascii').decode(data.subarray(start, pos));
    if (!value || pos >= data.length) throw new Error('Cabeçalho PGM/PPM incompleto.');
    if (data[pos++] === 13 && data[pos] === 10) pos++;
    return value;
  };
  const magic = next();
  const width = Number(next()), height = Number(next()), max = Number(next());
  const channels = magic === 'P6' ? 3 : magic === 'P5' ? 1 : 0;
  if (!channels || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !width || !height || max !== 255 || width * height > 1500000) {
    throw new Error('A demonstração aceita PGM P5 ou PPM P6 de 8 bits até 1,5 milhão de pixels.');
  }
  const bytes = width * height * channels;
  if (data.length - pos !== bytes) throw new Error('O tamanho dos dados PGM/PPM não corresponde ao cabeçalho.');
  return { width, height, channels, bytes: data.slice(pos) };
}

async function loadFile(file) {
  if (!file) return;
  try {
    if (/\.(pgm|ppm)$/i.test(file.name)) {
      const image = readPnm(await file.arrayBuffer());
      setInput(image.width, image.height, image.channels, image.bytes, file.name);
      return;
    }
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 1500000) throw new Error('Use uma imagem de até 1,5 milhão de pixels nesta demonstração.');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4) {
        rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
      }
      setInput(canvas.width, canvas.height, 3, rgb, file.name);
    } finally { bitmap.close(); }
  } catch (error) { status(error.message || 'Não foi possível abrir a imagem.', true); }
}

function sample() {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 200;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 320, 200);
  gradient.addColorStop(0, '#273b8d'); gradient.addColorStop(.55, '#0db4c8'); gradient.addColorStop(1, '#f7ad5c');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 320, 200);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(25, 30, 118, 126);
  ctx.fillStyle = '#6049b4'; ctx.beginPath(); ctx.arc(215, 94, 55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#071326'; ctx.font = 'bold 30px sans-serif'; ctx.fillText('HILL', 38, 102);
  const rgba = ctx.getImageData(0, 0, 320, 200).data;
  const rgb = new Uint8Array(320 * 200 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
  setInput(320, 200, 3, rgb, 'exemplo gerado no navegador');
}

function workerCount() { return Math.min(Number($('image-threads').value), Math.ceil((state.input?.length || 0) / 4)); }

async function transform() {
  const blocks = Math.ceil(state.input.length / 4);
  const count = workerCount();
  const result = new Uint8Array(state.input.length);
  const key = seed().toString();
  const start = performance.now();
  await Promise.all(Array.from({ length: count }, (_, index) => new Promise((resolve, reject) => {
    const first = Math.floor(blocks * index / count);
    const last = Math.floor(blocks * (index + 1) / count);
    const from = first * 4, to = Math.min(last * 4, state.input.length);
    const chunk = state.input.slice(from, to);
    const worker = new Worker(new URL('./image-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      result.set(new Uint8Array(event.data), from);
      worker.terminate();
      resolve();
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Falha no Web Worker. Execute o site por um servidor local.')); };
    worker.postMessage({ buffer: chunk.buffer, seed: key, firstBlock: first }, [chunk.buffer]);
  })));
  return { result, ms: performance.now() - start, count };
}

async function transformGpu() {
  const memoryPercent = Number($('image-memory').value);
  const url = `/api/image/gpu?seed=${encodeURIComponent(seed().toString())}&memoryPercent=${memoryPercent}`;
  const start = performance.now();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: state.input });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Backend CUDA respondeu ${response.status}.`);
  }
  const batchBytes = Number(response.headers.get('X-GPU-Batch-Bytes')) || state.input.length;
  return {
    result: new Uint8Array(await response.arrayBuffer()),
    ms: performance.now() - start,
    count: Math.ceil(state.input.length / batchBytes),
    batchBytes,
    freeBytes: Number(response.headers.get('X-GPU-Free-Bytes')) || 0,
    device: response.headers.get('X-GPU-Name') || 'GPU CUDA'
  };
}

function setBusy(value) {
  state.busy = value;
  for (const id of ['image-file', 'image-sample', 'image-seed', 'image-threads', 'image-backend', 'image-memory', 'image-encrypt', 'image-decrypt']) $(id).disabled = value;
  $('image-threads').disabled = value || $('image-backend').value === 'cuda';
  $('image-memory').disabled = value || $('image-backend').value !== 'cuda';
  $('image-reuse').disabled = value || !state.output;
}

async function process(action) {
  if (!state.input || state.busy) return;
  try {
    seed();
    setBusy(true);
    const useGpu = $('image-backend').value === 'cuda';
    status(useGpu
      ? `${action === 'encrypt' ? 'Cifrando' : 'Decifrando'} na GPU em lotes de até ${$('image-memory').value}% da VRAM livre…`
      : `${action === 'encrypt' ? 'Cifrando' : 'Decifrando'} com ${workerCount()} worker(s)…`);
    const { result, ms, count, batchBytes, device } = useGpu ? await transformGpu() : await transform();
    state.output = result;
    state.gpuBatchBytes = useGpu ? batchBytes : null;
    draw($('image-output-canvas'), result);
    $('image-output-caption').textContent = action === 'encrypt' ? 'Resultado cifrado' : 'Resultado decifrado';
    $('image-time').textContent = `${ms.toFixed(1)} ms`;
    const recovered = result.length === state.original.length && result.every((value, i) => value === state.original[i]);
    $('image-check').textContent = recovered ? 'Pixels recuperados ✓' : 'Transformação concluída';
    $('image-reuse').disabled = $('image-download').disabled = $('image-download-pnm').disabled = false;
    renderDetails();
    status(useGpu
      ? `${action === 'encrypt' ? 'Cifragem' : 'Decifragem'} concluída na ${device}: ${count} lote(s), até ${(batchBytes / (1024 * 1024)).toFixed(1)} MiB por lote. ${recovered ? 'Pixels iguais aos da imagem inicial.' : 'Use o resultado como entrada e aplique K novamente para recuperar.'}`
      : `${action === 'encrypt' ? 'Cifragem' : 'Decifragem'} concluída com ${count} worker(s). ${recovered ? 'Pixels iguais aos da imagem inicial.' : 'Use o resultado como entrada e aplique K novamente para recuperar.'}`);
  } catch (error) { status(error.message || 'Falha ao processar imagem.', true); }
  finally { setBusy(false); }
}

function renderDetails() {
  if (!state.input) return;
  const blocks = Math.ceil(state.input.length / 4);
  state.block = Math.max(0, Math.min(state.block, blocks - 1));
  $('image-block-label').textContent = `Bloco ${state.block + 1} de ${blocks.toLocaleString('pt-BR')}`;
  const from = state.block * 4, size = Math.min(4, state.input.length - from);
  try {
    const matrix = matrixForBlock(seed(), state.block, size);
    const grid = $('image-key-matrix');
    grid.style.gridTemplateColumns = `repeat(${size}, minmax(31px, 1fr))`;
    grid.replaceChildren(...matrix.flat().map(value => {
      const cell = document.createElement('span'); cell.textContent = value; return cell;
    }));
    const input = [...state.input.slice(from, from + size)];
    $('image-math-trace').replaceChildren(...matrix.map((row, rowIndex) => {
      const line = document.createElement('div'); line.className = 'image-math-row';
      const title = document.createElement('strong'); title.textContent = `Linha ${rowIndex + 1} → byte ${rowIndex + 1}`;
      const formula = document.createElement('code');
      const sum = row.reduce((total, value, col) => total + value * input[col], 0);
      formula.textContent = `${row.map((value, col) => `${value} × ${input[col]}`).join(' + ')} = ${sum}; resto ÷ 256 = ${sum & 255}`;
      line.append(title, formula);
      return line;
    }));
  } catch { $('image-key-matrix').replaceChildren(); $('image-math-trace').replaceChildren(); }
  const before = [...state.input.slice(from, from + size)].join(', ');
  const after = state.output ? [...state.output.slice(from, from + size)].join(', ') : '…';
  $('image-block-bytes').textContent = `[${before}] → [${after}]`;
  const count = workerCount();
  const map = $('image-thread-map');
  map.replaceChildren();
  if ($('image-backend').value === 'cuda') {
    const budget = state.gpuBatchBytes || Math.floor((state.gpuInfo?.free_bytes || 0) * Number($('image-memory').value) / 100 / 4) * 4;
    const batchBytes = Math.max(4, budget);
    const note = document.createElement('div'); note.className = 'image-gpu-batch-note';
    note.textContent = `${blocks.toLocaleString('pt-BR')} blocos · ${Math.ceil(state.input.length / batchBytes)} lote(s) · 1 thread CUDA por bloco`;
    map.append(note);
    $('image-owner').textContent = 'CUDA · 1 thread por bloco';
    $('image-parallel-title').textContent = 'GPU: um thread por bloco';
    $('image-parallel-copy').textContent = 'Cada thread CUDA calcula um bloco independente. O servidor transfere os dados em lotes alinhados a quatro bytes e usa a mesma semente e o índice global do bloco.';
    $('image-thread-example').textContent = `O limite por lote é ${$('image-memory').value}% da VRAM livre observada no início da execução. Os workers CPU não participam quando CUDA está selecionado.`;
  } else {
    const owner = Array.from({ length: count }, (_, i) => i).find(i => state.block < Math.floor(blocks * (i + 1) / count));
    $('image-owner').textContent = `Intervalo do worker ${owner + 1}`;
    $('image-parallel-title').textContent = 'Cada worker recebe um intervalo';
    $('image-parallel-copy').textContent = 'O escalonamento estático do OpenMP e a divisão por intervalos do Pthreads percorrem blocos distintos. A matriz depende do índice do bloco, então o resultado permanece igual com diferentes números de workers.';
    $('image-thread-example').textContent = 'No desenho, cada barra colorida representa a parte da imagem atribuída a um worker. Alterar o controle “Workers no navegador” muda a divisão, mas não os bytes produzidos.';
    map.replaceChildren(...Array.from({ length: count }, (_, i) => {
      const first = Math.floor(blocks * i / count), last = Math.floor(blocks * (i + 1) / count);
      const row = document.createElement('div'); row.className = 'image-thread-row';
      const label = document.createElement('span'); label.textContent = `Worker ${i + 1}`;
      const bar = document.createElement('div'); bar.className = 'image-thread-bar';
      const fill = document.createElement('span'); fill.style.marginLeft = `${first / blocks * 100}%`; fill.style.width = `${(last - first) / blocks * 100}%`;
      bar.append(fill);
      const range = document.createElement('span'); range.textContent = `${first + 1}–${last}`;
      row.append(label, bar, range); return row;
    }));
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  $('image-file').addEventListener('change', event => loadFile(event.target.files[0]));
  $('image-sample').addEventListener('click', sample);
  $('image-encrypt').addEventListener('click', () => process('encrypt'));
  $('image-decrypt').addEventListener('click', () => process('decrypt'));
  $('image-backend').addEventListener('change', () => { state.gpuBatchBytes = null; setBusy(state.busy); renderDetails(); });
  $('image-memory').addEventListener('input', () => {
    state.gpuBatchBytes = null;
    $('image-memory-value').textContent = `${$('image-memory').value}%`;
    renderDetails();
  });
  $('image-threads').addEventListener('input', () => { $('image-thread-value').textContent = $('image-threads').value; renderDetails(); });
  $('image-seed').addEventListener('input', () => {
    if (state.output) {
      state.output = null;
      draw($('image-output-canvas'), null);
      $('image-output-caption').textContent = 'Resultado';
      $('image-time').textContent = $('image-check').textContent = '—';
      $('image-reuse').disabled = $('image-download').disabled = $('image-download-pnm').disabled = true;
      status('Semente alterada. Processe novamente a entrada com o novo valor.');
    }
    renderDetails();
  });
  $('image-prev-block').addEventListener('click', () => { state.block--; renderDetails(); });
  $('image-next-block').addEventListener('click', () => { state.block++; renderDetails(); });
  $('image-reuse').addEventListener('click', () => {
    if (!state.output) return;
    state.input = state.output.slice(); state.output = null;
    draw($('image-input-canvas'), state.input);
    draw($('image-output-canvas'), null);
    $('image-input-caption').textContent = 'Entrada: resultado anterior';
    $('image-output-caption').textContent = 'Resultado';
    $('image-check').textContent = '—'; $('image-time').textContent = '—';
    $('image-reuse').disabled = $('image-download').disabled = $('image-download-pnm').disabled = true;
    renderDetails(); status('Resultado carregado. Clique em “Decifrar imagem” com a mesma semente.');
  });
  $('image-download').addEventListener('click', () => {
    if (!state.output) return;
    $('image-output-canvas').toBlob(blob => { if (blob) download(blob, 'hill-resultado.png'); }, 'image/png');
  });
  $('image-download-pnm').addEventListener('click', () => {
    if (!state.output) return;
    const magic = state.channels === 1 ? 'P5' : 'P6';
    const header = new TextEncoder().encode(`${magic}\n${state.width} ${state.height}\n255\n`);
    download(new Blob([header, state.output], { type: 'application/octet-stream' }), `hill-resultado.${state.channels === 1 ? 'pgm' : 'ppm'}`);
  });
  sample();
  const gpuOption = $('image-backend').querySelector('option[value="cuda"]');
  try {
    const response = await fetch('/api/gpu/info');
    const info = await response.json();
    if (!response.ok) throw new Error(info.error || `Servidor respondeu ${response.status}.`);
    state.gpuInfo = info;
    gpuOption.disabled = false;
    gpuOption.textContent = `GPU · ${info.name}`;
    const gib = bytes => (bytes / (1024 ** 3)).toFixed(2);
    $('image-gpu-hint').textContent = `CUDA pronto · ${info.name} · ${gib(info.total_bytes)} GiB VRAM, ${gib(info.free_bytes)} GiB livres. O limite escolhido é aplicado à VRAM livre no início de cada execução.`;
  } catch (error) {
    gpuOption.disabled = true;
    $('image-gpu-hint').textContent = `GPU CUDA indisponível: ${error.message} A CPU continua disponível.`;
    $('image-gpu-hint').classList.add('error');
  }
}

init();
