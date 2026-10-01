# 🔐 Cifra de Hill Paralela (PCD - UNIFESP)

> Projeto desenvolvido para a disciplina de **Programação Concorrente e Distribuída (PCD)** da Universidade Federal de São Paulo (**UNIFESP**).
> **Objetivo atual:** comparar execuções sequenciais e paralelas (OpenMP e Pthreads) da **Cifra de Hill aplicada a imagens e vídeos** em memória compartilhada. O simulador de texto continua como introdução didática.

## ⚙️ Requisitos

| Para quê | O que instalar |
|---|---|
| Programas C de imagem e vídeo | GCC com OpenMP (Linux/WSL) **ou** Visual Studio / Build Tools 2022 com o componente C++ (Windows) |
| **Tudo que envolve vídeo** (programa `video_hill` e aba 5 do site) | **FFmpeg 5.1 ou superior, com `ffmpeg` e `ffprobe` no PATH** |
| Site e aba de vídeo | Python 3.10 ou superior (só a biblioteca padrão) |

**O FFmpeg é obrigatório para o vídeo.** O programa C não decodifica MP4 sozinho: ele chama o `ffmpeg` para extrair os quadros e para gravar o resultado, e o `ffprobe` para ler resolução e taxa de quadros. Para instalar:

```bash
# Windows (depois, abra um terminal novo para o PATH ser atualizado)
winget install Gyan.FFmpeg.Essentials

# Ubuntu / WSL
sudo apt install ffmpeg
```

Confira com `ffmpeg -version`. O `server.py` também encontra uma instalação feita pelo winget que ainda não esteja no PATH do terminal atual.

## 🚀 Início rápido (vídeo)

```bash
# 1. Compilar (Linux/WSL)
gcc -O2 -std=c11 -fopenmp HillCypherCode/video_hill.c -o video_hill

# 2. Abrir o site com o laboratório de vídeo
python server.py
```

No Windows, compile no **Prompt de Desenvolvedor do Visual Studio**, na pasta do projeto:

```text
cl /O2 /std:c11 /openmp HillCypherCode\video_hill.c /Fe:video_hill.exe
```

Depois, abra **http://localhost:8085** e vá até a aba **5. Vídeo & Benchmarks**. O vídeo de teste `video.mp4` (1920×1080, 29,97 qps, 79 s, H.264) já está no repositório.

---

## 🖼️ Experimento com imagens

O arquivo [HillCypherCode/image_hill.c](HillCypherCode/image_hill.c) transforma imagens **PNG, PGM P5 ou PPM P6 de 8 bits**. A imagem é tratada como uma fila de bytes: todos os valores de canal (R, G, B…), pixel após pixel. Essa fila é cortada em blocos de 4 bytes, e cada bloco recebe uma matriz gerada a partir de uma semente numérica e do índice do bloco:

$$K=\begin{bmatrix}A&I-A^2\\I&-A\end{bmatrix}\pmod{256},\qquad K^2=I\pmod{256}.$$

- **Cifrar e decifrar são a mesma operação**, porque K² = I.
- **Os blocos não coincidem com pixels:** num RGB, o bloco 0 é `R0 G0 B0 R1`.
- **Blocos finais menores:** os de 1 a 3 bytes usam matrizes auto-invertíveis menores.
- **O resultado independe da quantidade de threads.**
- **Formato do arquivo:** dimensões e pixels são preservados, mas o cabeçalho PNM é reescrito e comentários/metadados se perdem.

Compilação em Linux ou outro ambiente POSIX com GCC:

```bash
gcc -O2 -std=c11 -fopenmp -pthread HillCypherCode/image_hill.c -o image_hill
```

No Prompt de Desenvolvedor do Visual Studio no Windows, as versões sequencial e OpenMP podem ser compiladas com:

```text
cl /O2 /std:c11 /openmp HillCypherCode\image_hill.c /Fe:image_hill.exe
```

Uso (a mesma semente decimal nas duas chamadas):

```bash
./image_hill seq 1 123 entrada.ppm cifrada.ppm
./image_hill omp 4 123 cifrada.ppm recuperada.ppm
./image_hill pthread 4 123 entrada.ppm cifrada_pthreads.ppm
```

O programa imprime o tempo **somente da transformação em memória**; leitura e escrita ficam fora dessa medida. Sequencial e OpenMP foram compilados e testados no Windows; a execução Pthreads ainda precisa de validação em ambiente POSIX. A semente e a cifra têm finalidade experimental e não constituem proteção criptográfica moderna. O [esboço atualizado do artigo](Artigo_PCD_SBC_Esboço_Imagens.docx) descreve o plano de medições.

> ⚠️ Para compilar com suporte a PNG, o `image_hill.c` precisa de `stb_image.h` e `stb_image_write.h` em `HillCypherCode/` ([nothings/stb](https://github.com/nothings/stb)). Esses arquivos ainda não estão no repositório.

---

## 🎬 Experimento com vídeos

### A ideia

Um vídeo é uma sequência de quadros, e cada quadro é uma imagem. O programa [HillCypherCode/video_hill.c](HillCypherCode/video_hill.c) aplica a mesma cifra do `image_hill` a **cada quadro**. O núcleo da cifra (`mix` e `block`) fica em [HillCypherCode/hill_block.h](HillCypherCode/hill_block.h), com a mesma aritmética do `image_hill.c`.

```text
video.mp4 ──► ffmpeg (decodifica) ──pipe──► video_hill (cifra quadro a quadro) ──pipe──► ffmpeg (grava sem perdas) ──► cifrado.mkv
```

- **Decodificação e gravação:** o FFmpeg roda como processo separado, ligado ao programa por *pipes*. Um processo entrega os quadros brutos e outro grava a saída.
- **A saída precisa ser sem perdas** (`.mkv`). Um codec com perdas, como H.264, alteraria os bytes cifrados e impediria a decifração.
- **Índice global de blocos:** `quadro × blocos_por_quadro + bloco`. Assim, dois quadros idênticos recebem matrizes diferentes, e o quadro 0 é cifrado exatamente como o `image_hill` cifraria os mesmos bytes.
- **Sobrescrita do quadro:** cada quadro é cifrado dentro do próprio buffer, sem cópia de saída. O arquivo de vídeo original nunca é sobrescrito, porque o FFmpeg ainda o está lendo e porque a saída sem perdas costuma ser maior que o MP4.
- **Áudio:** não é copiado.

### Como a paralelização foi pensada

Antes de implementar, comparamos duas estratégias:

| Estratégia | Vantagens | Desvantagens |
|---|---|---|
| **Dividir cada quadro entre as threads** (escolhida) | pouca memória (1 a 3 quadros), saída já em ordem, baixa latência por quadro | uma barreira por quadro |
| Uma thread por quadro inteiro | quase nenhuma sincronização | T quadros em memória, saída precisa ser reordenada, o decodificador entrega quadros em sequência |

Em alta resolução, o custo da barreira (microssegundos) é desprezível perto do custo de cifrar um quadro (milissegundos). Além disso, ler e gravar costumam pesar tanto quanto a cifra. Por isso escolhemos a primeira estratégia e acrescentamos um **pipeline** que sobrepõe leitura, cifra e gravação.

### Os três modos e o número de threads

| Comando | Threads criadas | Quem faz o quê |
|---|---|---|
| `seq` | 1 | a mesma thread lê, cifra e grava, um quadro depois do outro |
| `omp N` | N | as N threads dividem a cifra de cada quadro (`#pragma omp parallel for schedule(static)`); a thread principal também lê e grava, e enquanto isso as outras esperam |
| `pipeline N` (**N+2**) | N + 2 | N só cifram, 1 só lê e 1 só grava, **todas ao mesmo tempo** |

O número digitado é sempre o de **threads de cifra**. Por exemplo, `pipeline 3+2` cria 5 threads.

No pipeline, cada passo *s* é assim:

```text
passo:         1           2           3           4
leitora:   [lê Q0]     [lê Q1]     [lê Q2]     [lê Q3]
cifra:         —       [cifra Q0]  [cifra Q1]  [cifra Q2]
gravadora:     —           —       [grava Q0]  [grava Q1]
```

- **Buffers:** três buffers se revezam (`s % 3`), um para cada etapa.
- **Barreira:** uma barreira OpenMP separa os passos.
- **Decisão de parar:** um `#pragma omp single` decide se o processamento termina, para que todas as threads tomem a mesma decisão sem condição de corrida.

Cada passo dura o tempo da etapa mais lenta, e não a soma das três.

### Uso

```bash
./video_hill <seq|omp|pipeline> <threads> <semente> <entrada> <saida.mkv|-> [formato] [raw|ffv1]

./video_hill pipeline 3 123 video.mp4 cifrado.mkv                       # cifrar
./video_hill pipeline 3 123 cifrado.mkv recuperado.mkv yuv420p ffv1     # decifrar (mesma operação, mesma semente)
./video_hill omp 4 123 video.mp4 -                                      # medir sem gravar em disco
```

- **Formato de pixel:** `yuv420p` (padrão, nativo da maioria dos vídeos), `yuv444p`, `rgb24` ou `gray`. Use o mesmo formato para cifrar e decifrar.
- **Codec `raw` (padrão):** grava os quadros sem compressão. Quadros cifrados parecem ruído e não comprimem. Num trecho 1080p de 301 quadros, o FFV1 gerou 948 MB contra 893 MB do raw e levou cerca de 23 s para codificar, contra 2,4 s.
- **Codec `ffv1`:** compressão sem perdas. Vale a pena para o vídeo **decifrado** (90 MB no mesmo trecho). Como o FFV1 não aceita `rgb24`, esse formato é guardado como `bgr0`, sem perda.
- **Saída `-`:** os quadros são descartados (`ffmpeg -f null`). Isso tira o disco da medição.

O programa imprime uma linha como esta:

```text
modo=pipeline threads=3+2 quadros=241 resolucao=1920x1080 formato=yuv420p bytes_quadro=3110400 codec=raw tempo_total=4.811 s leitura=1.436 s cifra=2.515 s gravacao=0.786 s fps=50.1
```

- **`cifra`:** soma, quadro a quadro, o tempo da thread de cifra **mais lenta**. É medida igual nos modos `omp` e `pipeline`.
- **`leitura` e `gravacao`:** incluem a espera pelo FFmpeg.
- **`tempo_total`:** vai da abertura dos pipes até o fim do FFmpeg.

### Como verificar que nada se perdeu

Compare o SHA-256 dos quadros brutos do original com os do vídeo recuperado:

```bash
ffmpeg -v error -i video.mp4 -f rawvideo -pix_fmt yuv420p - | sha256sum
ffmpeg -v error -i recuperado.mkv -f rawvideo -pix_fmt yuv420p - | sha256sum
```

Já verificado:

| Verificação | Resultado |
|---|---|
| Ida e volta em `yuv420p`, `rgb24` e `gray`, com codecs `raw` e `ffv1` | hashes idênticos |
| `seq`, `omp` e `pipeline` com 1 a 8 threads | geram o mesmo arquivo cifrado |
| Decifrar com a semente errada | não recupera o vídeo |
| Quadro truncado | é recusado, e a saída parcial é apagada |

Testado no Windows com MSVC 2022 e FFmpeg 9.0.1, e compilado sem avisos no GCC 13 (WSL) com `-Wall -Wextra`.

---

## 📊 Análises

A aba **5. Vídeo & Benchmarks** do site (`python server.py`) executa o programa C de verdade e gera as análises abaixo. Tudo que ela produz vai para `video_lab/`, que o git ignora.

### 1. Análise visual da cifra (um quadro)

O laboratório recorta um trecho, cifra, decifra e mostra **original, cifrado e decifrado lado a lado**, tocando sincronizados. Em seguida, analisa o quadro do meio do trecho, plano a plano (Y = brilho; U e V = cor):

- **Histograma:** uma boa cifra espalha os valores por toda a faixa de 0 a 255.
- **Entropia:** o ideal é ficar perto de 8 bits por byte.
- **Correlação entre pixels vizinhos:** o original fica perto de 1. Uma boa cifra fica perto de 0.

Resultado no trecho de teste (`video.mp4`, a partir de 20 s, semente 123):

| Plano | Entropia (original → cifrado) | Correlação entre vizinhos (original → cifrado) |
|---|---|---|
| Y | 6,91 → **7,99** bits | 0,944 → **0,002** |
| U | 6,04 → **7,90** bits | 0,960 → **0,017** |
| V | 6,79 → **7,99** bits | 0,956 → **0,002** |

**Vazamento encontrado.** No plano U, o histograma do cifrado tem picos em 0 e 128, e uma mancha fica visível no vídeo cifrado. A causa está na própria cifra de Hill, que é linear (C = K·P):

- em regiões de cor neutra, U e V valem 128;
- um bloco `[128, 128, 128, 128]` multiplicado por qualquer K dá `128 × (soma da linha)`, que módulo 256 só pode ser 0 ou 128;
- da mesma forma, um bloco `[0, 0, 0, 0]` continua zero com qualquer matriz.

É uma limitação da cifra, não do paralelismo. Uma correção possível seria torná-la afim, somando um vetor pseudoaleatório b derivado da semente e do índice: C = K·P + b. Isso não foi implementado, porque mudaria o algoritmo descrito no artigo.

### 2. Benchmark: tempo × número de threads

O benchmark roda `seq`, `omp` e `pipeline` com os números de threads escolhidos:

- **Execução:** as configurações rodam várias vezes, em **ordem embaralhada**, depois de uma execução de aquecimento.
- **Registro:** cada rodada é salva em `video_lab/benchmarks.json`.
- **Gráficos:** tempo × threads (mediana, com mínimo e máximo), speedup sobre o `seq` (com a linha ideal) e divisão do tempo por etapa (leitura, cifra e gravação, com o tempo total marcado).
- **Dados dinâmicos:** **os gráficos são gerados a partir das execuções reais** e mudam a cada rodada. As rodadas anteriores continuam disponíveis para comparação.

Rodada de referência: trecho de 8 s em 1080p (241 quadros), 5 repetições, sem gravar em disco, num Intel i5-4670K com 4 núcleos e Windows 10. Os valores são medianas.

| Configuração | Tempo total | Speedup total | Tempo da cifra | Speedup da cifra | Quadros/s |
|---|---|---|---|---|---|
| `seq` | 7,74 s | 1,00× | 6,02 s | 1,00× | 31,1 |
| `omp 2` | 6,22 s | 1,24× | 4,69 s | 1,28× | 38,7 |
| `omp 4` | 5,41 s | 1,43× | 3,70 s | 1,62× | 44,6 |
| `pipeline 2+2` | 5,23 s | 1,48× | 3,93 s | 1,53× | 46,1 |
| `pipeline 4+2` | **4,99 s** | **1,55×** | 2,17 s | 2,77× | **48,3** |

O que os números mostram:

1. **A cifra domina o tempo.** No `seq`, ela ocupa 78% do total, então é a parte certa para paralelizar.
2. **O pipeline é o melhor modo.** Ele ganha porque leitura e gravação passam a acontecer ao mesmo tempo que a cifra. No gráfico de etapas, as barras do pipeline somam mais que o tempo total, e é justamente a sobreposição que faz isso.
3. **O ganho fica bem abaixo do ideal** (4× com 4 threads). Com as 2 threads de E/S, o `pipeline 4+2` cria 6 threads para 4 núcleos, e elas ainda disputam o processador com os processos do FFmpeg. Mesmo isolada, sem FFmpeg, a cifra escalou só 2,1× a 2,4× nesta máquina. A causa ainda precisa ser investigada: vale repetir no Linux, com o computador sem outros programas abertos.
4. **Os tempos variam entre execuções.** Outros programas, a temperatura e a frequência do processador interferem. Por isso cada configuração é repetida e o gráfico usa a mediana. Diferenças dentro da faixa entre mínimo e máximo não devem virar conclusão.

### 3. O que descobrimos no caminho

- **O disco atrapalhava as medições.** Gravando cerca de 900 MB por execução num SSD SATA sem DRAM, o tempo de gravação oscilava entre 1 e 9 s. A saída `-` resolve isso para os benchmarks.
- **O FFV1 não compensa no vídeo cifrado.** Ruído não comprime, e o codec virou o gargalo. Por isso o codec `raw` passou a ser o padrão.
- **A medida do pipeline foi corrigida.** A primeira versão somava o tempo de cada thread de cifra separadamente, o que favorecia o pipeline (1,83 s em vez de 2,38 s). Hoje os dois modos medem a cifra pela thread mais lenta de cada quadro.
- **Uma hipótese foi descartada.** Suspeitamos que as threads do `omp` demoravam a "acordar" entre quadros (o relógio do Windows tem resolução de 15,6 ms). Um teste com e sem pausa entre as regiões paralelas deu o mesmo tempo, então não era isso.

### Limitações

- Todas as medições foram feitas em uma única máquina Windows, com 4 núcleos.
- O áudio não é copiado.
- A cifra é didática e vaza informação em regiões uniformes.
- O teste `tests/test_image_hill.py`, citado abaixo, ainda não existe no repositório.

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

### Recursos do Site (5 Módulos):
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
5. **5. Vídeo & Benchmarks** (precisa de `python server.py`, do FFmpeg e do `video_hill` compilado):
   - Explicação dos modos `seq`, `omp` e `pipeline`, com linhas do tempo de cada um e o significado de “3+2”.
   - Laboratório: cifra e decifra um trecho do `video.mp4`, mostra original, cifrado e decifrado sincronizados e confere o SHA-256 dos quadros.
   - Análise visual de um quadro: histogramas, entropia e correlação dos planos Y, U e V, com detecção do vazamento.
   - Benchmark: tempo × threads, speedup e divisão do tempo por etapa, gerados a partir das execuções reais.

### Como rodar a aplicação web:
```bash
python server.py
```
Acesse no navegador: **`http://localhost:8085`**. O `server.py` serve o site e atende a aba **5. Vídeo & Benchmarks**, que executa o `video_hill` e o FFmpeg na sua máquina. Ele usa só a biblioteca padrão do Python e escuta apenas em `127.0.0.1`. As abas 1 a 4 também funcionam com `python -m http.server 8085` ou `npx serve .`. A aba de imagens usa módulos JavaScript e Web Workers, por isso precisa de um servidor local.

A aba de vídeo precisa de três coisas:
- `video.mp4` na pasta do projeto;
- FFmpeg instalado (o servidor também encontra a instalação feita pelo winget);
- `video_hill` compilado na raiz do projeto (`video_hill.exe` no Windows), com os comandos da seção *Experimento com vídeos*.

O que a aba faz:
- **Laboratório:** recorta um trecho do vídeo, cifra, decifra, compara o SHA-256 dos quadros e mostra os três vídeos sincronizados (original, cifrado e decifrado). Também mostra os tempos impressos pelo programa e a análise de um quadro: histogramas, entropia e correlação entre vizinhos dos planos Y, U e V.
- **Benchmark:** roda `seq`, `omp` e `pipeline` com os números de threads escolhidos, em ordem embaralhada e com repetições. Os resultados ficam em `video_lab/benchmarks.json` e aparecem em gráficos de tempo × threads, speedup e divisão do tempo por etapa. A opção *Descartar a saída* (`video_hill ... -`) tira o disco da medição.

Tudo que é gerado vai para `video_lab/`, que o git ignora.

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
├── video-lab.mjs               # Aba de vídeo: laboratório, análise do quadro e gráficos do benchmark
├── server.py                   # Servidor local: site + API que executa video_hill e FFmpeg
├── video.mp4                   # Video de teste (1080p, 79 s)
├── video_lab/                  # Saidas do laboratorio e benchmarks.json (gerado, ignorado pelo git)
├── tanayseven_hill_cipher.c    # Código em C de referência compilável
├── HillCypherCode/
│   ├── hillcypherOMP.c         # Experimento anterior com texto modulo 26
│   ├── image_hill.c            # Cifra experimental de imagens seq/OMP/Pthreads
│   ├── hill_block.h            # Núcleo da cifra (mix e block) usado pelo vídeo
│   └── video_hill.c            # Cifra de vídeo quadro a quadro: seq/OMP/pipeline
├── tests/test_image_hill.py    # Testes de recuperacao e equivalencia (planejado, ainda nao existe)
├── Artigo_PCD_SBC_Esboço_Imagens.docx # Esboço do artigo atualizado
├── README.md                   # Guia do projeto
└── .gitignore                  # Filtro para binários e temporários
```

---

## 👥 Autores & Créditos
- **Disciplina:** Programação Concorrente e Distribuída (PCD) &bull; UNIFESP
- **Código C Base:** Tanay PrabhuDesai ([Gist 9491684](https://gist.github.com/tanayseven/9491684))
- **Referência Matricial:** Markus Perlet ([matrix_multiplication](https://github.com/mperlet/matrix_multiplication))
