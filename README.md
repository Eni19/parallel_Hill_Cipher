# 🔐 Cifra de Hill Paralela (PCD - UNIFESP)

> Projeto desenvolvido para a disciplina de **Programação Concorrente e Distribuída (PCD)** da Universidade Federal de São Paulo (**UNIFESP**).  
> **Objetivo:** Compreender, implementar, analisar e paralelizar o algoritmo de criptografia e decriptografia da **Cifra de Hill** em arquiteturas multicore e distribuídas.

---

## 📌 Repositórios & Links de Referência
- **Repositório do Projeto:** [github.com/Eni19/parallel_Hill_Cipher](https://github.com/Eni19/parallel_Hill_Cipher.git)
- **Implementação Base em C (Tanay PrabhuDesai):** [Gist 9491684](https://gist.github.com/tanayseven/9491684)
- **Repositório Guia de Multiplicação de Matrizes:** [mperlet/matrix_multiplication](https://github.com/mperlet/matrix_multiplication)

---

## 📖 1. O que é a Cifra de Hill e qual o seu objetivo?

Criada em 1929 pelo matemático Lester S. Hill, a **Cifra de Hill** é a primeira cifra criptográfica prática baseada em **Álgebra Linear (Matrizes)**.

### ❌ O problema que ela resolveu:
Cifras clássicas antigas (como a Cifra de César ou cifras de substituição simples) trocam cada letra individualmente por outra fixa. Em línguas naturais, letras como `'A'` e `'E'` aparecem com alta frequência; portanto, um atacante pode quebrar a mensagem em poucos minutos contando a repetição de caracteres (**análise de frequência**).

### 💡 A Solução de Hill:
A Cifra de Hill é uma cifra **poligráfica**: ela agrupa o texto em **blocos de $N$ letras** (duplas, trios, etc.) e multiplica cada bloco por uma **Matriz Chave $K$** de dimensão $N \times N$:
$$\mathbf{C} = (\mathbf{K} \times \mathbf{P}) \pmod{26}$$

Dessa forma, a mesma letra `'A'` se transformará em caracteres cifrados completamente diferentes dependendo de suas letras vizinhas no bloco, neutralizando a análise de frequência direta.

---

## 🧩 2. Como Funciona o Algoritmo (Passo a Passo)

1. **Mapeamento de Caracteres para $\mathbb{Z}_{26}$:**  
   As letras do alfabeto são convertidas para números de $0$ a $25$:
   $$\text{A}=0, \text{B}=1, \dots, \text{Z}=25$$
2. **Divisão em Blocos (Vetores $N \times 1$):**  
   O texto limpo é fatiado em blocos de tamanho $N$. Se o comprimento do texto não for múltiplo de $N$, adiciona-se preenchimento (*padding*, comumente `'X'`).
3. **Encriptação Matricial:**  
   Cada vetor bloco $\mathbf{P}$ é multiplicado pela Matriz Chave $\mathbf{K}$:
   $$c_i = \left( \sum_{j=0}^{N-1} k_{i,j} \cdot p_j \right) \pmod{26}$$
4. **Decriptação com a Matriz Inversa ($\mathbf{K}^{-1}$):**  
   Para recuperar o texto original, multiplica-se o bloco cifrado pela matriz inversa modular:
   $$\mathbf{P} = (\mathbf{K}^{-1} \times \mathbf{C}) \pmod{26}$$

### 🔍 O "Truque" da Inversa no Código C de Tanayseven:
Em aritmética modular, não podemos fazer divisão por float. Na função `Mat_add_num_till_divisible`, o código de referência soma repetidamente $26$ a cada elemento da matriz adjunta até que a divisão inteira pelo determinante seja exata:
```c
while ((int)Mat_get_element(mat, row, col) % (int)divisor)
    Mat_set_element(mat, row, col, Mat_get_element(mat, row, col) + 26);
```
Como $26 \equiv 0 \pmod{26}$, o valor modular é preservado e a divisão inteira em C se torna $100\%$ exata.

---

## 🌐 3. Aplicação Web Visual & Didática

Para permitir que qualquer integrante do grupo (ou o professor) compreenda o algoritmo antes de inspecionar o código, criamos uma aplicação web completa e interativa:

### Recursos do Site:
- **Trilha Didática "Aprenda do Zero":**
  - Explicação histórica e intuitiva sem jargões.
  - Régua interativa do alfabeto ($A=0 \dots Z=25$).
  - Diagrama visual de produto de matrizes com botões de teste interativo ("CA", "OI", "PA").
  - O relógio de 26 horas ilustrando a aritmética $\pmod{26}$.
- **Mesa de Operação Integrada (Laboratório):**
  - Matrizes espaçosas e de alta visibilidade, sem vazamento de texto.
  - Esteira de blocos clicáveis.
  - **Fluxo inteligente de Encriptação & Decriptação:**
    - *Modo Encriptação:* Texto original $\to$ multiplicado por $K$ $\to$ gera o texto cifrado.
    - *Modo Decriptação:* O texto cifrado gerado é carregado na entrada $\to$ multiplicado por $K^{-1}$ $\to$ revela a mensagem original restaurada!
  - Execução passo a passo manual e reprodução automática (*auto-play*) com velocidade ajustável.
- **Simulador PCD:** Estimativa de Speedup segundo a Lei de Amdahl com visualização gráfica da divisão de blocos por threads (1 a 16 threads).

### Como rodar a aplicação web:
```bash
# Opção 1: Usando Python
python -m http.server 8085

# Opção 2: Usando Node.js
npx serve .
```
Acesse no navegador: **`http://localhost:8085`** (ou abra `index.html` diretamente).

---

## 💻 4. Código C de Referência (`tanayseven_hill_cipher.c`)

O arquivo [tanayseven_hill_cipher.c](tanayseven_hill_cipher.c) contém a versão em C baseada no código de Tanay PrabhuDesai com documentação, modularização e testes prontos.

### Compilação e Execução:
```bash
# Compilar com GCC (MinGW / Linux)
gcc -O2 tanayseven_hill_cipher.c -o hill_test.exe

# Executar
./hill_test.exe
```

**Saída esperada:**
```text
=== Cifra de Hill (Referência Tanayseven) ===

Matriz Chave de Encriptação:
Matrix: 3x3
   6.0   24.0    1.0 
  13.0   16.0   10.0 
  20.0   17.0   15.0 

Matriz Chave de Decriptação:
Matrix: 3x3
   8.0    5.0   10.0 
  21.0    8.0   21.0 
  21.0   12.0    8.0 

Texto Original: RETREATXX
Texto Cifrado : JHRQZSNNY
Texto Decifrado: RETREATXX
```

---

## ⚡ 5. Roteiro de Paralelização para PCD

A Cifra de Hill opera nativamente no modo **ECB (Electronic Codebook)**: a encriptação de um bloco $i$ é totalmente independente do bloco $j$. Trata-se de um problema **embaraçosamente paralelo** (*embarrassingly parallel*).

### Estratégias Planejadas:
1. **Paralelismo de Dados em Loop 1D (OpenMP):**
   ```c
   #pragma omp parallel for schedule(static)
   for (int b = 0; b < total_blocos; ++b) {
       multiplicar_bloco_chave(K, &texto[b * N], N);
   }
   ```
2. **Formulação Matricial Geral GEMM (Conexão com `mperlet/matrix_multiplication`):**
   - Agrupar todo o texto de $M$ blocos em uma grande matriz $\mathbf{P}_{N \times M}$.
   - A encriptação inteira vira uma única multiplicação:
     $$\mathbf{C}_{N \times M} = (\mathbf{K}_{N \times N} \times \mathbf{P}_{N \times M}) \pmod{26}$$
   - Aplicar **cache blocking (tiling)**, vetorização SIMD (AVX2/AVX-512) e escalonamento dinâmico.
3. **Métricas a Medir:**
   - **Speedup:** $S_p = \frac{T_1}{T_p}$
   - **Eficiência:** $E_p = \frac{S_p}{p}$
   - Testes de escalabilidade com 1, 2, 4, 8 e 16 threads para volumes de 100 KB, 1 MB, 10 MB e 100 MB de texto.

---

## 📁 Estrutura de Arquivos
```text
parallel_Hill_Cipher/
├── index.html                  # Interface gráfica do simulador e tutorial
├── style.css                   # Design system dark mode com glassmorphism
├── app.js                      # Motor JS fiel às funções C de Tanayseven
├── tanayseven_hill_cipher.c    # Código em C de referência compilável
├── README.md                   # Documentação completa do projeto
└── .gitignore                  # Filtro para binários e temporários
```

---

## 👥 Autores & Créditos
- **Disciplina:** Programação Concorrente e Distribuída (PCD) &bull; UNIFESP
- **Código C Base:** Tanay PrabhuDesai ([Gist 9491684](https://gist.github.com/tanayseven/9491684))
- **Referência Matricial:** Markus Perlet ([matrix_multiplication](https://github.com/mperlet/matrix_multiplication))
