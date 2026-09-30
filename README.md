# 🔐 Cifra de Hill Paralela (PCD - UNIFESP)

> Projeto desenvolvido para a disciplina de **Programação Concorrente e Distribuída (PCD)** da Universidade Federal de São Paulo (**UNIFESP**).  
> **Objetivo atual:** comparar a execução sequencial, OpenMP e Pthreads da **Cifra de Hill aplicada a imagens** em memória compartilhada. O simulador de texto continua como introdução didática.

## Experimento com imagens

O arquivo [HillCypherCode/image_hill.c](HillCypherCode/image_hill.c) transforma imagens **PGM P5 ou PPM P6 de 8 bits**, sem compressão. Cada bloco de quatro bytes recebe uma matriz gerada de uma semente numérica e do índice do bloco:

$$K=\begin{bmatrix}A&I-A^2\\I&-A\end{bmatrix}\pmod{256},\qquad K^2=I\pmod{256}.$$

A mesma operação cifra e decifra. Os blocos finais de 1 a 3 bytes usam matrizes auto-invertíveis menores. O resultado independe da quantidade de threads. O programa preserva dimensões e pixels recuperados, mas reescreve o cabeçalho PNM e não preserva comentários/metadados.

Compilação em Linux ou outro ambiente POSIX com GCC:

```bash
gcc -O2 -std=c11 -fopenmp -pthread HillCypherCode/image_hill.c -o image_hill
```

No Prompt de Desenvolvedor do Visual Studio no Windows, a versão sequencial e OpenMP podem ser compiladas com:

```text
cl /O2 /std:c11 /openmp HillCypherCode\image_hill.c /Fe:image_hill.exe
```

Uso (a mesma semente decimal nas duas chamadas):

```bash
./image_hill seq 1 123 entrada.ppm cifrada.ppm
./image_hill omp 4 123 cifrada.ppm recuperada.ppm
./image_hill pthread 4 123 entrada.ppm cifrada_pthreads.ppm
```

O programa imprime o tempo **somente da transformação em memória**; leitura e escrita ficam fora dessa medida. O teste [tests/test_image_hill.py](tests/test_image_hill.py) verifica recuperação exata e equivalência entre modos. Sequencial e OpenMP foram compilados e testados no Windows; a execução Pthreads ainda precisa de validação em ambiente POSIX. A semente e a cifra têm finalidade experimental e não constituem proteção criptográfica moderna. O [esboço atualizado do artigo](Artigo_PCD_SBC_Esboço_Imagens.docx) descreve o plano de medições, ainda sem resultados.

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

### Recursos do Site (4 Módulos Didáticos):
1. **1. O que é & Como Funciona (Aprenda do Zero):**
   - Explicação histórica e intuitiva do objetivo da cifra poligráfica.
   - Régua interativa do alfabeto ($A=0 \dots Z=25$).
   - Demonstração visual da multiplicação matricial com botões de teste interativo ("CA", "OI", "PA").
   - O relógio de 26 horas ilustrando a aritmética modular $\pmod{26}$.
2. **2. Laboratório Interativo (Mesa de Operação):**
   - Matrizes espaçosas e de alta visibilidade, sem aperto ou vazamento de texto.
   - Esteira de blocos clicáveis.
   - **Fluxo inteligente e intuitivo de Encriptação & Decriptação:**
     - *Modo Encriptação:* Texto original $\to$ multiplicado por $K$ $\to$ gera o texto cifrado.
     - *Modo Decriptação:* O texto cifrado gerado é carregado na entrada $\to$ multiplicado por $K^{-1}$ $\to$ revela a mensagem original restaurada!
   - Execução passo a passo manual e reprodução automática (*auto-play*) com velocidade configurável.
3. **3. Como Desfazer a Cifra (A Inversa em C Explicada):**
   - O Dilema da Divisão em Criptografia (por que frações como $8/25 = 0.32$ não existem no alfabeto).
   - A Solução do Relógio (+26) e como a função `Mat_add_num_till_divisible` em C resolve isso sem aproximações.
   - Os 4 passos matemáticos da inversão (Determinante, Cofatores, Adjunta e Ajuste).
   - Tabela de rastreamento ao vivo para as 9 posições da matriz ativa.
4. **4. Imagens e Paralelismo:**
   - Guia para iniciantes sobre pixels, canais RGB, blocos, módulo 256, matriz auto invertível e threads.
   - Carregamento de PNG/JPEG/PGM/PPM ou imagem de exemplo, com prévias de entrada e saída.
   - Cifragem e decifragem em Web Workers, usando a mesma geração de matrizes do código C.
   - Matriz e multiplicação linha por linha do bloco selecionado, divisão estática dos blocos entre workers e download em PNG ou PGM/PPM.
   - O tempo mostrado pertence ao navegador; os benchmarks do artigo devem usar o programa C.

### Como rodar a aplicação web:
```bash
# Opção 1: Usando Python
python -m http.server 8085

# Opção 2: Usando Node.js
npx serve .
```
Acesse no navegador: **`http://localhost:8085`**. A aba de imagens usa módulos JavaScript e Web Workers, por isso precisa de um servidor local.

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

## 📁 Estrutura de Arquivos
```text
parallel_Hill_Cipher/
├── index.html                  # Interface gráfica do simulador e tutorial
├── style.css                   # Design system dark mode com glassmorphism
├── app.js                      # Motor JS fiel às funções C de Tanayseven
├── image-core.mjs              # Matrizes e transformação de bytes compatíveis com C
├── image-worker.mjs            # Execução paralela no navegador
├── image-demo.mjs              # Interface do laboratório de imagens
├── tanayseven_hill_cipher.c    # Código em C de referência compilável
├── HillCypherCode/
│   ├── hillcypherOMP.c         # Experimento anterior com texto modulo 26
│   └── image_hill.c            # Cifra experimental de imagens seq/OMP/Pthreads
├── tests/test_image_hill.py    # Testes de recuperacao e equivalencia
├── Artigo_PCD_SBC_Esboço_Imagens.docx # Esboço do artigo atualizado
├── README.md                   # Guia do projeto
└── .gitignore                  # Filtro para binários e temporários
```

---

## 👥 Autores & Créditos
- **Disciplina:** Programação Concorrente e Distribuída (PCD) &bull; UNIFESP
- **Código C Base:** Tanay PrabhuDesai ([Gist 9491684](https://gist.github.com/tanayseven/9491684))
- **Referência Matricial:** Markus Perlet ([matrix_multiplication](https://github.com/mperlet/matrix_multiplication))
