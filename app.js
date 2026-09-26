/**
 * Hill Cipher Explorer & Parallelization Visualizer
 * Implementação fiel da lógica do Tanay PrabhuDesai (tanayseven/9491684)
 * Desenvolvido para a disciplina de Programação Concorrente e Distribuída (PCD) - UNIFESP
 */

// --- Utilitários Matemáticos e Algoritmo de Tanayseven ---

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    let t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function mod26(n) {
  let r = n % 26;
  return r < 0 ? r + 26 : r;
}

function createMatrix(rows, cols) {
  let m = [];
  for (let r = 0; r < rows; r++) {
    m.push(new Array(cols).fill(0));
  }
  return m;
}

function cloneMatrix(mat) {
  return mat.map(row => [...row]);
}

// Mat_get_minor_matrix
function getMinorMatrix(mat, rowToRemove, colToRemove) {
  let rows = mat.length;
  let cols = mat[0].length;
  let minor = [];
  for (let r = 0; r < rows; r++) {
    if (r === rowToRemove) continue;
    let newRow = [];
    for (let c = 0; c < cols; c++) {
      if (c === colToRemove) continue;
      newRow.push(mat[r][c]);
    }
    minor.push(newRow);
  }
  return minor;
}

// Mat_get_matrix_determinant (recursivo por menores)
function getMatrixDeterminant(mat) {
  let n = mat.length;
  if (n === 1) return mat[0][0];
  if (n === 2) {
    return mat[0][0] * mat[1][1] - mat[0][1] * mat[1][0];
  }
  let det = 0;
  let flag = 1;
  for (let c = 0; c < n; c++) {
    let minor = getMinorMatrix(mat, 0, c);
    let term = mat[0][c] * getMatrixDeterminant(minor);
    if (flag) {
      det += term;
    } else {
      det -= term;
    }
    flag ^= 1;
  }
  return det;
}

// Mat_get_cofactor_matrix
function getCofactorMatrix(mat) {
  let n = mat.length;
  let cofactors = createMatrix(n, n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let minor = getMinorMatrix(mat, r, c);
      let minorDet = getMatrixDeterminant(minor);
      let sign = ((r + c) % 2 === 0) ? 1 : -1;
      cofactors[r][c] = sign * minorDet;
    }
  }
  return cofactors;
}

// Mat_matrix_transpose
function transposeMatrix(mat) {
  let rows = mat.length;
  let cols = mat[0].length;
  let t = createMatrix(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      t[c][r] = mat[r][c];
    }
  }
  return t;
}

// Mat_get_adjoint_matrix: transposta da matriz de cofatores
function getAdjointMatrix(mat) {
  let cofactors = getCofactorMatrix(mat);
  return transposeMatrix(cofactors);
}

// Algoritmo de Decryption Key do Tanayseven:
// Mat_add_num_till_divisible, Mat_divide_by_number, Mat_add_num_till_positive, Mat_mod_by_number
function calculateDecryptionKeyWithTrace(encryptionKey) {
  let size = encryptionKey.length;
  let rawDet = getMatrixDeterminant(encryptionKey);
  let det = mod26(Math.round(rawDet));
  let isInv = gcd(det, 26) === 1;

  if (!isInv) {
    return {
      isValid: false,
      rawDet,
      det,
      error: `Determinante mod 26 é ${det}, que NÃO é coprimo com 26 (mdc(${det}, 26) = ${gcd(det, 26)} != 1). A matriz não é invertível em Z26.`
    };
  }

  let cofactors = getCofactorMatrix(encryptionKey);
  let adjoint = transposeMatrix(cofactors);

  let workAdj = cloneMatrix(adjoint);
  let added26Count = createMatrix(size, size);

  // Mat_add_num_till_divisible(key->decryption_key, 26, determinant);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let orig = workAdj[r][c];
      let val = Math.round(orig);
      let count = 0;
      while (val % det !== 0 && count < 200) {
        val += 26;
        count++;
      }
      workAdj[r][c] = val;
      added26Count[r][c] = count;
    }
  }

  // Mat_divide_by_number(key->decryption_key, determinant);
  let divided = createMatrix(size, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      divided[r][c] = Math.round(workAdj[r][c] / det);
    }
  }

  // Mat_add_num_till_positive(key->decryption_key, 26);
  let positive = cloneMatrix(divided);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      while (positive[r][c] < 0) {
        positive[r][c] += 26;
      }
    }
  }

  // Mat_mod_by_number(key->decryption_key, 26);
  let finalDecKey = createMatrix(size, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      finalDecKey[r][c] = mod26(positive[r][c]);
    }
  }

  return {
    isValid: true,
    rawDet,
    det,
    cofactors,
    adjoint,
    added26Count,
    afterAddition: workAdj,
    divided,
    positive,
    finalDecKey
  };
}

// Multiplicação de matrizes
function multiplyMatrix(m1, m2) {
  let r1 = m1.length;
  let c1 = m1[0].length;
  let r2 = m2.length;
  let c2 = m2[0].length;
  if (c1 !== r2) throw new Error("Dimensões incompatíveis");
  let res = createMatrix(r1, c2);
  for (let i = 0; i < r1; i++) {
    for (let j = 0; j < c2; j++) {
      let sum = 0;
      for (let k = 0; k < c1; k++) {
        sum += m1[i][k] * m2[k][j];
      }
      res[i][j] = sum;
    }
  }
  return res;
}

// --- Estado Global da Aplicação ---

const AppState = {
  matrixSize: 3,
  encryptionKey: [
    [6, 24, 1],
    [13, 16, 10],
    [20, 17, 15]
  ],
  decryptionKeyInfo: null,

  // Textos separados para Encriptação e Decriptação
  plainText: "RETREAT",
  cipherText: "JHRQZSNNY",
  cleanedText: "RETREATXX",
  isEncryptMode: true,

  // Stepper State
  steps: [],
  currentStepIndex: -1,
  activeBlockIndex: 0,
  isPlaying: false,
  playTimer: null,
  speedMs: 800
};

// Presets pré-configurados
const PRESETS = {
  "3x3-tanay": {
    size: 3,
    key: [
      [6, 24, 1],
      [13, 16, 10],
      [20, 17, 15]
    ],
    label: "3x3 Tanayseven (Gist 9491684)"
  },
  "2x2-classic": {
    size: 2,
    key: [
      [3, 3],
      [2, 5]
    ],
    label: "2x2 Clássico (det = 9)"
  },
  "2x2-alternate": {
    size: 2,
    key: [
      [5, 8],
      [17, 3]
    ],
    label: "2x2 Hill (det = -121 ≡ 9)"
  },
  "3x3-alternate": {
    size: 3,
    key: [
      [17, 17, 5],
      [21, 18, 21],
      [2, 2, 19]
    ],
    label: "3x3 Alternativo (det ≡ 25)"
  }
};

// --- Funções de Renderização do Laboratório Centralizado ---

function renderMatrixInputs() {
  const container = document.getElementById("matrix-input-table");
  if (!container) return;
  container.innerHTML = "";
  const size = AppState.matrixSize;

  for (let r = 0; r < size; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < size; c++) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.className = "matrix-cell wb-cell-key";
      input.id = `k-cell-${r}-${c}`;
      input.value = AppState.encryptionKey[r] ? AppState.encryptionKey[r][c] || 0 : 0;
      input.addEventListener("input", (e) => {
        AppState.encryptionKey[r][c] = parseFloat(e.target.value) || 0;
        updateMatrixDiagnostics();
        buildStepByStepProcess();
      });
      td.appendChild(input);
      tr.appendChild(td);
    }
    container.appendChild(tr);
  }
}

function updateMatrixDiagnostics() {
  const decInfo = calculateDecryptionKeyWithTrace(AppState.encryptionKey);
  AppState.decryptionKeyInfo = decInfo;
  const diagEl = document.getElementById("matrix-diagnostics");
  const decTable = document.getElementById("matrix-decryption-table");

  if (!decInfo.isValid) {
    if (diagEl) {
      diagEl.className = "diag-badge invalid";
      diagEl.innerHTML = `
        <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
        <div>
          <strong>Matriz Inválida para Cifra de Hill!</strong><br>
          det = ${decInfo.rawDet} | det mod 26 = ${decInfo.det}. mdc(${decInfo.det}, 26) != 1. Escolha um dos presets ao lado.
        </div>
      `;
    }
    if (decTable) decTable.innerHTML = "<tr><td class='text-dim' style='padding:1rem;'>Matriz não invertível</td></tr>";
    renderDecryptionTrace(null);
    return false;
  }

  if (diagEl) {
    diagEl.className = "diag-badge valid";
    diagEl.innerHTML = `
      <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
      <div>
        <strong>Matriz Válida e Invertível em Z₂₆!</strong><br>
        det = ${decInfo.rawDet} | det mod 26 = ${decInfo.det} | mdc(${decInfo.det}, 26) = 1.
      </div>
    `;
  }

  // Renderiza tabela da chave de decriptação na gaveta
  if (decTable) {
    decTable.innerHTML = "";
    const size = AppState.matrixSize;
    for (let r = 0; r < size; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < size; c++) {
        const td = document.createElement("td");
        const div = document.createElement("div");
        div.className = "matrix-cell wb-cell-key readonly";
        div.id = `dec-cell-${r}-${c}`;
        div.textContent = decInfo.finalDecKey[r][c];
        td.appendChild(div);
        tr.appendChild(td);
      }
      decTable.appendChild(tr);
    }
  }

  renderDecryptionTrace(decInfo);
  return true;
}

// Renderiza a Mesa de Operação Central (A Equação Matricial Viva com Células Espaçosas)
function renderWorkbenchStage() {
  const keyTable = document.getElementById("workbench-key-table");
  const vecTable = document.getElementById("workbench-vector-table");
  const resTable = document.getElementById("workbench-result-table");
  const keyLabel = document.getElementById("active-key-label");
  const vecLabel = document.getElementById("active-vector-label");
  const resLabel = document.getElementById("active-result-label");

  if (!keyTable || !vecTable || !resTable) return;

  const isEncrypt = AppState.isEncryptMode;
  const size = AppState.matrixSize;
  const activeKey = (isEncrypt || !AppState.decryptionKeyInfo || !AppState.decryptionKeyInfo.isValid)
    ? AppState.encryptionKey
    : AppState.decryptionKeyInfo.finalDecKey;

  // Atualiza Rótulos da Mesa
  if (isEncrypt) {
    keyLabel.className = "matrix-label-pill key-enc";
    keyLabel.textContent = "Matriz Chave K (Encriptação)";
    resLabel.className = "matrix-label-pill result-label";
    resLabel.textContent = "Vetor Cifrado mod 26";
  } else {
    keyLabel.className = "matrix-label-pill key-dec";
    keyLabel.textContent = "Matriz Inversa K⁻¹ (Decriptação)";
    resLabel.className = "matrix-label-pill key-dec";
    resLabel.textContent = "Vetor Decifrado mod 26";
  }

  // 1. Renderiza Matriz Chave na Mesa com Células Espaçosas
  keyTable.innerHTML = "";
  for (let r = 0; r < size; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < size; c++) {
      const td = document.createElement("td");
      const div = document.createElement("div");
      div.className = "matrix-cell wb-cell-key readonly";
      div.id = `wb-key-cell-${r}-${c}`;
      div.textContent = activeKey[r] ? activeKey[r][c] : 0;
      td.appendChild(div);
      tr.appendChild(td);
    }
    keyTable.appendChild(tr);
  }

  // 2. Renderiza Vetor do Bloco Ativo
  const text = AppState.cleanedText;
  const blockIndex = AppState.activeBlockIndex;
  const chunk = text.slice(blockIndex * size, (blockIndex + 1) * size);
  vecLabel.textContent = `Bloco ${blockIndex + 1}: "${chunk}"`;

  vecTable.innerHTML = "";
  const inNums = chunk.split("").map(ch => ch.charCodeAt(0) - 65);
  for (let r = 0; r < size; r++) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const div = document.createElement("div");
    div.className = "cell-pill wb-cell-vec vec";
    div.id = `wb-vec-cell-${r}`;
    div.innerHTML = `<span style="font-size:0.8rem; color:var(--text-dim); margin-right:4px;">${chunk[r] || '?'}:</span>${inNums[r] !== undefined ? inNums[r] : 0}`;
    td.appendChild(div);
    tr.appendChild(td);
    vecTable.appendChild(tr);
  }

  // 3. Renderiza Vetor Resultado na Mesa (Com espaço para número e letra sem overflow)
  resTable.innerHTML = "";
  const currentStep = AppState.steps[AppState.currentStepIndex];
  for (let r = 0; r < size; r++) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const div = document.createElement("div");
    div.className = "cell-pill wb-cell-res res";
    div.id = `wb-res-cell-${r}`;

    let isCalculated = false;
    let charVal = "?";
    let numVal = "?";

    if (currentStep && currentStep.blockIndex === blockIndex && currentStep.rowIndex >= r) {
      isCalculated = true;
      const stepForThisRow = AppState.steps.find(s => s.blockIndex === blockIndex && s.rowIndex === r);
      if (stepForThisRow) {
        charVal = stepForThisRow.resChar;
        numVal = stepForThisRow.modVal;
      }
    } else if (currentStep && currentStep.blockIndex > blockIndex) {
      isCalculated = true;
      const stepForThisRow = AppState.steps.find(s => s.blockIndex === blockIndex && s.rowIndex === r);
      if (stepForThisRow) {
        charVal = stepForThisRow.resChar;
        numVal = stepForThisRow.modVal;
      }
    }

    if (isCalculated) {
      div.innerHTML = `<span style="color:#6ee7b7; font-weight:800;">${numVal}</span> <span style="color:#a7f3d0; margin-left:4px;">('${charVal}')</span>`;
    } else {
      div.textContent = "...";
    }

    td.appendChild(div);
    tr.appendChild(td);
    resTable.appendChild(tr);
  }

  // Destaque da linha ativa na Matriz Chave
  if (currentStep && currentStep.blockIndex === blockIndex) {
    const activeRow = currentStep.rowIndex;
    for (let c = 0; c < size; c++) {
      const cell = document.getElementById(`wb-key-cell-${activeRow}-${c}`);
      if (cell) cell.classList.add("highlight-row");
    }
  }
}

// Renderiza a esteira horizontal de blocos clicáveis
function renderTextBlocks() {
  const container = document.getElementById("text-blocks-container");
  if (!container) return;
  container.innerHTML = "";
  const text = AppState.cleanedText;
  const size = AppState.matrixSize;
  const blockCount = Math.floor(text.length / size);

  document.getElementById("conveyor-dim-label").textContent = `${size} letras por bloco (N = ${size})`;

  for (let b = 0; b < blockCount; b++) {
    const chunk = text.slice(b * size, (b + 1) * size);
    const nums = chunk.split("").map(ch => ch.charCodeAt(0) - 65);

    const card = document.createElement("div");
    card.className = "conveyor-card";
    card.id = `conveyor-card-${b}`;
    if (b === AppState.activeBlockIndex) card.classList.add("active");

    card.innerHTML = `
      <div class="conveyor-num">Bloco ${b + 1}</div>
      <div class="conveyor-letters">${chunk}</div>
      <div class="conveyor-vec">[${nums.join(", ")}]ᵀ</div>
    `;

    card.addEventListener("click", () => {
      AppState.activeBlockIndex = b;
      const firstStepOfBlock = AppState.steps.findIndex(s => s.blockIndex === b);
      if (firstStepOfBlock !== -1) {
        AppState.currentStepIndex = firstStepOfBlock;
      }
      updateStepperUI();
    });

    container.appendChild(card);
  }
}

// Prepara texto de entrada e cria blocos de tamanho N
function prepareCleanText() {
  const inputEl = document.getElementById("cipher-input-text");
  if (!inputEl) return;
  const raw = inputEl.value.toUpperCase();
  const cleaned = raw.replace(/[^A-Z]/g, "");
  const size = AppState.matrixSize;
  const remainder = cleaned.length % size;
  let padded = cleaned;
  let padCount = 0;

  if (remainder !== 0) {
    padCount = size - remainder;
    padded += "X".repeat(padCount);
  }

  if (AppState.isEncryptMode) {
    AppState.plainText = raw;
  } else {
    AppState.cipherText = raw;
  }
  AppState.cleanedText = padded;

  const padNotice = document.getElementById("padding-notice");
  if (padNotice) {
    if (padCount > 0) {
      padNotice.style.display = "block";
      padNotice.innerHTML = `Texto ajustado com padding de <strong>${padCount} caractere(s) 'X'</strong> para fechar blocos de tamanho ${size}. Texto a processar: <code>${padded}</code>`;
    } else {
      padNotice.style.display = "none";
    }
  }

  renderTextBlocks();
}

// Constrói a lista completa de passos da multiplicação para o Stepper
function buildStepByStepProcess() {
  prepareCleanText();
  const valid = updateMatrixDiagnostics();
  if (!valid) {
    AppState.steps = [];
    AppState.currentStepIndex = -1;
    updateStepperUI();
    return;
  }

  const isEncrypt = AppState.isEncryptMode;
  const key = isEncrypt ? AppState.encryptionKey : AppState.decryptionKeyInfo.finalDecKey;
  const text = AppState.cleanedText;
  const size = AppState.matrixSize;
  const blockCount = Math.floor(text.length / size);

  const steps = [];

  for (let b = 0; b < blockCount; b++) {
    const chunk = text.slice(b * size, (b + 1) * size);
    const inVector = chunk.split("").map(ch => ch.charCodeAt(0) - 65);
    const outVector = new Array(size).fill(0);
    const outLetters = new Array(size).fill("");

    for (let r = 0; r < size; r++) {
      let sum = 0;
      let terms = [];
      for (let c = 0; c < size; c++) {
        let termVal = key[r][c] * inVector[c];
        sum += termVal;
        terms.push(`(${key[r][c]} &times; ${inVector[c]})`);
      }
      let modVal = mod26(sum);
      let resChar = String.fromCharCode(65 + modVal);
      outVector[r] = modVal;
      outLetters[r] = resChar;

      steps.push({
        blockIndex: b,
        blockChunk: chunk,
        inVector: [...inVector],
        rowIndex: r,
        keyRow: [...key[r]],
        termsStr: terms.join(" + "),
        sum,
        modVal,
        resChar,
        outLettersSoFar: [...outLetters],
        isLastOfBlock: r === size - 1,
        mode: isEncrypt ? "Encriptação (K)" : "Decriptação (K⁻¹)"
      });
    }
  }

  AppState.steps = steps;
  AppState.currentStepIndex = -1;
  AppState.activeBlockIndex = 0;
  updateStepperUI();
  updateFullOutputs();
}

function updateStepperUI() {
  const currentStep = AppState.steps[AppState.currentStepIndex];
  const stepInfoEl = document.getElementById("step-counter-info");
  const formulaBox = document.getElementById("step-formula-box");
  const btnPrev = document.getElementById("btn-step-prev");
  const btnNext = document.getElementById("btn-step-next");

  if (currentStep) {
    AppState.activeBlockIndex = currentStep.blockIndex;
  }

  // Destaque nos cards da esteira
  document.querySelectorAll(".conveyor-card").forEach((c, idx) => {
    c.classList.toggle("active", idx === AppState.activeBlockIndex);
    if (currentStep) {
      c.classList.toggle("done", idx < currentStep.blockIndex);
    } else {
      c.classList.remove("done");
    }
  });

  // Renderiza a mesa de operação com os dados sincronizados
  renderWorkbenchStage();

  if (!currentStep) {
    stepInfoEl.innerHTML = `Pronto. Total: <strong>${AppState.steps.length} passos</strong> de cálculo. Clique em "Próximo Passo" para iniciar.`;
    formulaBox.innerHTML = `
      <div style="color:var(--text-dim); text-align:center;">
        Pressione <strong>"▶ Próximo Passo"</strong> ou <strong>"⏯ Auto-play"</strong> para ver a Matriz Chave multiplicando o Bloco atual!
      </div>
    `;
    btnPrev.disabled = true;
    btnNext.disabled = AppState.steps.length === 0;
    updatePartialOutput();
    return;
  }

  btnPrev.disabled = AppState.currentStepIndex <= 0;
  btnNext.disabled = AppState.currentStepIndex >= AppState.steps.length - 1;

  stepInfoEl.innerHTML = `
    Passo <strong>${AppState.currentStepIndex + 1}</strong> de <strong>${AppState.steps.length}</strong> 
    | Bloco <strong>${currentStep.blockIndex + 1}</strong> ("${currentStep.blockChunk}") 
    | Linha <strong>${currentStep.rowIndex + 1}</strong> &bull; <span style="color:var(--accent-cyan); font-weight:600;">${currentStep.mode}</span>
  `;

  // Caixa da Fórmula Linha a Linha
  formulaBox.innerHTML = `
    <div class="live-calc-formula">
      <span style="color:var(--accent-purple); font-weight:700;">[Linha ${currentStep.rowIndex + 1} da Chave &times; Vetor Bloco ${currentStep.blockIndex + 1}]</span>:
      ${currentStep.termsStr} = <strong>${currentStep.sum}</strong>
    </div>
    <div style="margin-top:4px;">
      &rarr; ${currentStep.sum} mod 26 = <span style="color:var(--accent-cyan); font-weight:700;">${currentStep.modVal}</span>
      &implies; Caractere: <strong>${currentStep.modVal} + 'A' = <span class="live-calc-result">'${currentStep.resChar}'</span></strong>
    </div>
  `;

  updatePartialOutput();
}

function updatePartialOutput() {
  const resultDisplay = document.getElementById("result-display");
  if (!resultDisplay) return;

  if (AppState.currentStepIndex === -1) {
    resultDisplay.textContent = "(Aguardando execução...)";
    return;
  }

  let textSoFar = "";
  for (let i = 0; i <= AppState.currentStepIndex; i++) {
    textSoFar += AppState.steps[i].resChar;
  }
  resultDisplay.textContent = textSoFar;
}

function updateFullOutputs() {
  const isEncrypt = AppState.isEncryptMode;
  const key = isEncrypt ? AppState.encryptionKey : (AppState.decryptionKeyInfo ? AppState.decryptionKeyInfo.finalDecKey : null);
  if (!key) return;

  const text = AppState.cleanedText;
  const size = AppState.matrixSize;

  let fullResult = "";
  for (let i = 0; i < text.length; i += size) {
    let inVec = [];
    for (let r = 0; r < size; r++) {
      inVec.push([text.charCodeAt(i + r) - 65]);
    }
    let mult = multiplyMatrix(key, inVec);
    for (let r = 0; r < size; r++) {
      fullResult += String.fromCharCode(65 + mod26(mult[r][0]));
    }
  }

  const fullDisplay = document.getElementById("full-output-display");
  if (fullDisplay) {
    fullDisplay.textContent = fullResult;
  }

  // Se estiver em modo de encriptação, guarda o texto cifrado gerado para poder decifrar depois
  if (isEncrypt) {
    AppState.cipherText = fullResult;
  }
}

// Navegação do Stepper
function nextStep() {
  if (AppState.currentStepIndex < AppState.steps.length - 1) {
    AppState.currentStepIndex++;
    updateStepperUI();
  } else {
    stopPlay();
  }
}

function prevStep() {
  if (AppState.currentStepIndex > 0) {
    AppState.currentStepIndex--;
    updateStepperUI();
  }
}

function resetStep() {
  stopPlay();
  AppState.currentStepIndex = -1;
  AppState.activeBlockIndex = 0;
  updateStepperUI();
}

function jumpToEnd() {
  stopPlay();
  AppState.currentStepIndex = AppState.steps.length - 1;
  updateStepperUI();
}

function togglePlay() {
  if (AppState.isPlaying) {
    stopPlay();
  } else {
    startPlay();
  }
}

function startPlay() {
  if (AppState.currentStepIndex >= AppState.steps.length - 1) {
    AppState.currentStepIndex = -1;
  }
  AppState.isPlaying = true;
  const btn = document.getElementById("btn-play-pause");
  if (btn) {
    btn.innerHTML = `
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
      Pausar
    `;
  }
  AppState.playTimer = setInterval(() => {
    if (AppState.currentStepIndex < AppState.steps.length - 1) {
      nextStep();
    } else {
      stopPlay();
    }
  }, AppState.speedMs);
}

function stopPlay() {
  AppState.isPlaying = false;
  if (AppState.playTimer) clearInterval(AppState.playTimer);
  const btn = document.getElementById("btn-play-pause");
  if (btn) {
    btn.innerHTML = `
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg>
      Auto-play
    `;
  }
}

// Configuração de Modo Inteligente (Encriptar vs Decriptar)
function setMode(isEncrypt) {
  AppState.isEncryptMode = isEncrypt;
  const btnEnc = document.getElementById("btn-mode-encrypt");
  const btnDec = document.getElementById("btn-mode-decrypt");
  const inputEl = document.getElementById("cipher-input-text");
  const inputLabel = document.getElementById("input-field-label");
  const outputFullLabel = document.getElementById("output-full-label");
  const btnUseResult = document.getElementById("btn-use-result-as-input");
  const resDisplay = document.getElementById("result-display");
  const fullDisplay = document.getElementById("full-output-display");

  stopPlay();

  if (isEncrypt) {
    if (btnEnc) btnEnc.className = "mode-switch-btn active encrypt";
    if (btnDec) btnDec.className = "mode-switch-btn";
    if (inputLabel) inputLabel.textContent = "Texto Original (Plano) a ser Criptografado com a Matriz K:";
    if (outputFullLabel) outputFullLabel.textContent = "Texto Cifrado Resultante:";
    if (btnUseResult) btnUseResult.textContent = "👉 Testar Decriptação: Carregar este Cifrotexto e Decifrar com K⁻¹";
    if (inputEl) inputEl.value = AppState.plainText || "RETREAT";
    if (resDisplay) { resDisplay.className = "result-display cipher"; }
    if (fullDisplay) { fullDisplay.className = "result-display cipher"; }
  } else {
    if (btnEnc) btnEnc.className = "mode-switch-btn";
    if (btnDec) btnDec.className = "mode-switch-btn active decrypt";
    if (inputLabel) inputLabel.textContent = "Texto Cifrado a ser Decifrado com a Matriz Inversa K⁻¹:";
    if (outputFullLabel) outputFullLabel.textContent = "Mensagem Original Recuperada (Decifrada):";
    if (btnUseResult) btnUseResult.textContent = "👈 Voltar para Encriptação com o Texto Original";
    if (inputEl) inputEl.value = AppState.cipherText || "JHRQZSNNY";
    if (resDisplay) { resDisplay.className = "result-display plain"; }
    if (fullDisplay) { fullDisplay.className = "result-display plain"; }
  }

  buildStepByStepProcess();
}

// Configuração de Preset
function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  AppState.matrixSize = preset.size;
  AppState.encryptionKey = cloneMatrix(preset.key);

  document.querySelectorAll(".preset-btn").forEach(btn => {
    if (btn.dataset.preset) {
      btn.classList.toggle("active", btn.dataset.preset === presetKey);
    }
  });

  renderMatrixInputs();
  buildStepByStepProcess();
}

// --- Demonstração do Passo 3 da Trilha Didática ---

function runTutorialDemo(word, v0, v1) {
  document.getElementById("tut-block-label").textContent = `"${word}"`;
  document.getElementById("tut-vec-0").textContent = v0;
  document.getElementById("tut-vec-1").textContent = v1;

  // Matriz Chave 2x2 do tutorial: [[3, 3], [2, 5]]
  const r0Raw = 3 * v0 + 3 * v1;
  const r1Raw = 2 * v0 + 5 * v1;
  const r0Mod = mod26(r0Raw);
  const r1Mod = mod26(r1Raw);
  const ch0 = String.fromCharCode(65 + r0Mod);
  const ch1 = String.fromCharCode(65 + r1Mod);

  document.getElementById("tut-res-0").innerHTML = `<span style="color:#6ee7b7; font-weight:800;">${r0Mod}</span> <span style="color:#a7f3d0; margin-left:4px;">('${ch0}')</span>`;
  document.getElementById("tut-res-1").innerHTML = `<span style="color:#6ee7b7; font-weight:800;">${r1Mod}</span> <span style="color:#a7f3d0; margin-left:4px;">('${ch1}')</span>`;

  document.getElementById("tut-detail-math").innerHTML = `
    <div style="color: #e0e7ff; margin-bottom: 6px;">
      <span style="color: var(--accent-purple); font-weight: 700;">Linha 1 (Roxa) &times; Vetor:</span> (3 &times; ${v0}) + (3 &times; ${v1}) = ${r0Raw} &implies; ${r0Raw} mod 26 = <strong>${r0Mod} &rarr; Letra '${ch0}'</strong>
    </div>
    <div style="color: #fef3c7;">
      <span style="color: var(--accent-amber); font-weight: 700;">Linha 2 (Amarela) &times; Vetor:</span> (2 &times; ${v0}) + (5 &times; ${v1}) = ${r1Raw} &implies; ${r1Raw} mod 26 = <strong>${r1Mod} &rarr; Letra '${ch1}'</strong>
    </div>
  `;

  document.querySelectorAll("[id^='demo-btn-']").forEach(b => b.classList.remove("active"));
  const clickedBtn = document.getElementById(`demo-btn-${word.toLowerCase()}`);
  if (clickedBtn) clickedBtn.classList.add("active");
}


// Renderiza a explicação didática do truque de Tanayseven
function renderDecryptionTrace(info) {
  const traceBox = document.getElementById("decryption-math-trace");
  if (!traceBox) return;

  if (!info || !info.isValid) {
    traceBox.innerHTML = "<p class='text-muted'>Configure uma matriz invertível para ver a decomposição passo a passo.</p>";
    return;
  }

  let tableRows = "";
  const size = AppState.matrixSize;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let adjVal = info.adjoint[r][c];
      let times26 = info.added26Count[r][c];
      let afterAdd = info.afterAddition[r][c];
      let divVal = info.divided[r][c];
      let finalVal = info.finalDecKey[r][c];

      tableRows += `
        <tr>
          <td style="font-family:var(--font-mono); color:var(--accent-cyan); text-align:center;">(${r+1},${c+1})</td>
          <td style="font-family:var(--font-mono); text-align:center;">${adjVal}</td>
          <td style="font-family:var(--font-mono); text-align:center; color:var(--accent-amber);">+ ${times26} &times; 26</td>
          <td style="font-family:var(--font-mono); text-align:center;">${afterAdd}</td>
          <td style="font-family:var(--font-mono); text-align:center;">${afterAdd} / ${info.det} = <strong>${divVal}</strong></td>
          <td style="font-family:var(--font-mono); text-align:center; color:var(--accent-emerald); font-weight:700;">${finalVal}</td>
        </tr>
      `;
    }
  }

  traceBox.innerHTML = `
    <div style="margin-bottom:1rem;">
      <p style="font-size:0.92rem; color:var(--text-muted); margin-bottom:0.5rem;">
        No arquivo <code class="c-fn">tanayseven/hill_cipher.c</code>, a função <code class="c-fn">Hill_calculate_decrypyion_key</code> implementa uma técnica direta e fascinante: em vez do Algoritmo Estendido de Euclides, ela soma repetidamente <strong>26</strong> a cada elemento da matriz adjunta até que ele seja exatamente divisível pelo determinante (<code class="c-num">${info.det}</code>).
      </p>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:0.86rem; text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--border-color); color:var(--text-muted);">
            <th style="padding:6px; text-align:center;">Pos</th>
            <th style="padding:6px; text-align:center;">Adjunta (transp. de cofatores)</th>
            <th style="padding:6px; text-align:center;">Mat_add_num_till_divisible</th>
            <th style="padding:6px; text-align:center;">Valor Divisível</th>
            <th style="padding:6px; text-align:center;">Mat_divide_by_number</th>
            <th style="padding:6px; text-align:center;">Chave Decriptação mod 26</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function renderAlphabetStrip() {
  const strip = document.getElementById("interactive-alpha-strip");
  if (!strip) return;
  strip.innerHTML = "";
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    const div = document.createElement("div");
    div.className = "alpha-item";
    div.innerHTML = `
      <span class="alpha-letter">${letter}</span>
      <span class="alpha-num">${i}</span>
    `;
    strip.appendChild(div);
  }
}

// --- Inicialização e Event Listeners ---

document.addEventListener("DOMContentLoaded", () => {
  // Configura abas
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.add("active");
    });
  });

  // Presets
  document.querySelectorAll(".preset-btn").forEach(btn => {
    if (btn.dataset.preset) {
      btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
    }
  });

  // Switch de tamanho de matriz
  const sizeSelect = document.getElementById("matrix-size-select");
  if (sizeSelect) {
    sizeSelect.addEventListener("change", (e) => {
      const newSize = parseInt(e.target.value);
      AppState.matrixSize = newSize;
      if (newSize === 2) {
        applyPreset("2x2-classic");
      } else {
        applyPreset("3x3-tanay");
      }
    });
  }

  // Input de Texto
  const textInput = document.getElementById("cipher-input-text");
  if (textInput) {
    textInput.addEventListener("input", (e) => {
      if (AppState.isEncryptMode) {
        AppState.plainText = e.target.value;
      } else {
        AppState.cipherText = e.target.value;
      }
      buildStepByStepProcess();
    });
  }

  // Modo Encriptar / Decriptar
  const btnEnc = document.getElementById("btn-mode-encrypt");
  const btnDec = document.getElementById("btn-mode-decrypt");

  if (btnEnc) {
    btnEnc.addEventListener("click", () => setMode(true));
  }
  if (btnDec) {
    btnDec.addEventListener("click", () => setMode(false));
  }

  // Botão de transição / atalho entre Encriptar e Decriptar
  const btnUseResult = document.getElementById("btn-use-result-as-input");
  if (btnUseResult) {
    btnUseResult.addEventListener("click", () => {
      if (AppState.isEncryptMode) {
        setMode(false);
      } else {
        setMode(true);
      }
    });
  }

  // Stepper Controls
  document.getElementById("btn-step-next").addEventListener("click", nextStep);
  document.getElementById("btn-step-prev").addEventListener("click", prevStep);
  document.getElementById("btn-step-reset").addEventListener("click", resetStep);
  document.getElementById("btn-step-end").addEventListener("click", jumpToEnd);
  document.getElementById("btn-play-pause").addEventListener("click", togglePlay);

  // Speed slider
  const speedSlider = document.getElementById("stepper-speed");
  if (speedSlider) {
    speedSlider.addEventListener("input", (e) => {
      AppState.speedMs = parseInt(e.target.value);
      document.getElementById("stepper-speed-val").textContent = `${AppState.speedMs}ms`;
      if (AppState.isPlaying) {
        clearInterval(AppState.playTimer);
        startPlay();
      }
    });
  }

  // Inicializa tudo
  renderAlphabetStrip();
  renderMatrixInputs();
  setMode(true);
});
