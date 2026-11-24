# 🔐 Cifra de Hill Paralela (PCD - UNIFESP)

> Projeto desenvolvido para a disciplina de **Programação Concorrente e Distribuída (PCD)** da Universidade Federal de São Paulo (**UNIFESP**).
> **Objetivo atual:** comparar diferentes estratégias de processamento da **Cifra de Hill aplicada a imagens e vídeos**: execução sequencial, paralelismo em CPU com OpenMP e Pthreads, paralelismo distribuído com MPI e processamento em GPU CUDA. O simulador de texto continua como introdução didática.

## ⚙️ Requisitos

| Para quê | O que instalar |
|---|---|
| Programas C de imagem e vídeo | GCC com OpenMP (Linux/WSL) **ou** Visual Studio / Build Tools 2022 com o componente C++ (Windows) |
| **Execução MPI de vídeo (Linux/WSL)** | MPICH ou Open MPI, incluindo `mpicc` e `mpirun` |
| **Tudo que envolve vídeo** (programas `video_hill`/`video_hill_mpi` e aba 5 do site) | **FFmpeg 5.1 ou superior, com `ffmpeg` e `ffprobe` no PATH** |
| Site e aba de vídeo | Python 3.10 ou superior (somente a biblioteca padrão) |
| Modos GPU das abas de imagens e vídeo/benchmark | GPU NVIDIA compatível, driver NVIDIA e CUDA Toolkit (`nvcc`); no Windows, Visual Studio Build Tools 2022 com MSVC |

**O FFmpeg é obrigatório para o vídeo.** Os programas C não decodificam MP4 sozinhos: utilizam o `ffmpeg` para extrair os quadros e gravar o resultado, e o `ffprobe` para consultar resolução e taxa de quadros.

No Windows, instale o FFmpeg pelo winget (abra um terminal novo depois da instalação):

```powershell
winget install Gyan.FFmpeg.Essentials
```

No Ubuntu/WSL, instale as dependências para vídeo e MPI com uma das opções abaixo.

**Opção A — MPICH:**

```bash
sudo apt update
sudo apt install build-essential ffmpeg mpich libmpich-dev
```

**Opção B — Open MPI:**

```bash
sudo apt update
sudo apt install build-essential ffmpeg openmpi-bin libopenmpi-dev
```

Confira as ferramentas instaladas:

```bash
ffmpeg -version
ffprobe -version
mpicc --version
mpirun --version
```

Também é possível testar a instalação MPI com o programa mínimo incluído no repositório:

```bash
mpicc -O2 -std=c11 hello_mpi.c -o hello_mpi
mpirun -np 4 ./hello_mpi
```

O resultado deve mostrar os ranks de 0 a 3 e o total de quatro processos. O `server.py` também encontra uma instalação do FFmpeg feita pelo winget que ainda não esteja no PATH do terminal atual.

## 🚀 Início rápido (vídeo)

### Linux / WSL

Na raiz do repositório, compile os programas de vídeo:

```bash
# Versões sequencial, OpenMP e pipeline
gcc -O2 -std=c11 -fopenmp HillCypherCode/video_hill.c -o video_hill

# Versão MPI (requer MPICH ou Open MPI)
mpicc -O2 -std=c11 HillCypherCode/video_hill_mpi.c -o video_hill_mpi
```

Inicie o servidor web:

```bash
python3 server.py
```

### Windows

A versão sequencial/OpenMP/pipeline pode ser compilada no **Prompt de Desenvolvedor do Visual Studio**, na pasta do projeto:

```text
cl /O2 /std:c11 /openmp HillCypherCode\video_hill.c /Fe:video_hill.exe
```

A execução MPI está documentada e validada neste projeto em Linux/WSL. Não tratamos a compilação MPI nativa no Windows como requisito validado.

Depois, abra **http://localhost:8085** e vá até a aba **5. Vídeo & Benchmarks**. O vídeo de teste `video.mp4` (1920×1080, 29,97 qps, aproximadamente 79 s, H.264) está no repositório.

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

### Modos GPU CUDA na interface

Na aba **4. Imagens & Paralelismo**, escolha `GPU · <modelo>` no seletor **Processador**. O servidor local compila `HillCypherCode/image_hill_cuda.cu` na primeira consulta e gera código nativo para a arquitetura CUDA detectada com `nvidia-smi`. O controle de VRAM limita a alocação CUDA a 10%–80% da **memória atualmente livre** (60% por padrão); a imagem é processada em lotes alinhados a blocos de quatro bytes. A alocação também fica limitada ao tamanho dos dados, portanto o percentual é um teto, não uma reserva que será sempre totalmente ocupada. A interface envia somente os bytes dos pixels ao servidor local e recebe a imagem transformada. O endpoint limita uploads a 64 MiB; para entradas maiores, use o caminho de vídeo em streaming ou aumente esse limite conscientemente.

No Windows, instale o CUDA Toolkit e o compilador host MSVC:

```powershell
winget install --id Nvidia.CUDA --exact --source winget
```

No Visual Studio Installer, modifique **Build Tools 2022** e selecione a carga **Desenvolvimento para desktop com C++**, incluindo MSVC v143 e um Windows SDK. Depois inicie ou reinicie `python server.py`. O servidor procura `nvcc.exe` e `VsDevCmd.bat`, inicializando o ambiente MSVC para compilar automaticamente; não é necessário iniciar o servidor em um Developer PowerShell. Se o compilador ou a GPU não estiverem disponíveis, os controles CUDA ficam desativados e a interface mostra o motivo. A resposta GPU deve ser comparada com a CPU usando os mesmos bytes e a mesma semente; os tempos de imagem no navegador incluem transferência local e comunicação com o servidor.

Na aba **5. Vídeo & Benchmarks**, o modo `cuda` conecta FFmpeg → backend CUDA → FFmpeg por pipes. O backend processa quadros brutos `yuv420p` em streaming; mantém uma alocação CUDA reutilizável e divide cada quadro em lotes limitados à porcentagem escolhida da VRAM livre. O índice da chave usa `quadro × blocos_por_quadro + bloco`, igual aos modos CPU e MPI. A demonstração cifra e decifra, grava a saída sem perdas e compara os hashes dos quadros. Leitura, cifra (cópias host↔GPU e kernel) e gravação são cronometradas separadamente. O benchmark descarta a saída quando essa opção está selecionada; caso contrário, cifra em raw e remove os arquivos intermediários ao terminar.

No painel **Benchmark**, marque `cuda` em **Modos** para incluí-lo. O baseline `seq` sempre entra. OpenMP e pipeline usam as contagens de threads selecionadas; MPI usa as quantidades escolhidas em **Processos MPI**; CUDA é uma configuração GPU única. O benchmark faz aquecimentos próprios para CPU, MPI e CUDA quando selecionados e depois intercala aleatoriamente cada configuração em cada repetição. Os gráficos e a tabela incluem tempo total, leitura, cifra, gravação, quadros/s, medianas, mínimos/máximos e speedups sobre `seq`. MPI é identificado pelo número de processos, OpenMP/pipeline pelo número de threads, e CUDA pela categoria `GPU`. A eficiência é calculada por thread nos modos OpenMP/pipeline e por processo no MPI; CUDA não possui eficiência por thread/processo CPU. O slider define o teto de memória CUDA como percentual da VRAM livre no início de cada execução. A estimativa na interface conta medições e aquecimentos.

> Os headers `stb_image.h` e `stb_image_write.h`, da biblioteca [stb](https://github.com/nothings/stb), estão versionados em `HillCypherCode/` e são utilizados pelo suporte a imagens PNG/JPEG.

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

Para OpenMP e pipeline, a estratégia escolhida é dividir cada quadro entre as threads de cifra. Isso mantém poucos quadros em memória, preserva a ordem de saída e evita precisar reordenar quadros processados independentemente.

| Estratégia | Vantagens | Desvantagens |
|---|---|---|
| **Dividir cada quadro entre as threads/processos** (escolhida) | pouca memória, saída já em ordem, baixa latência por quadro | sincronização e comunicação a cada quadro |
| Uma thread por quadro inteiro | pouca sincronização entre participantes | vários quadros em memória e necessidade de reordenar a saída |

Em alta resolução, o custo de sincronização deve ser avaliado em relação ao custo de cifrar o quadro. Além da divisão da cifra, o **pipeline** sobrepõe leitura, cifra e gravação. Na versão MPI, os processos possuem espaços de memória independentes e trocam as partes do quadro por operações coletivas.

### Os modos de execução e as unidades de processamento

| Comando | Unidades de processamento | Quem faz o quê |
|---|---:|---|
| `seq` | 1 thread | a mesma thread lê, cifra e grava, um quadro depois do outro |
| `omp N` | N threads | as N threads dividem a cifra de cada quadro (`#pragma omp parallel for schedule(static)`); a thread principal também lê e grava |
| `pipeline N` (**N+2**) | N + 2 threads | N threads cifram; uma lê e outra grava, sobrepondo as etapas |
| `mpirun -np N ./video_hill_mpi ...` | N processos MPI | o rank 0 coordena a leitura/distribuição/reunião/gravação e também cifra sua parcela; os demais ranks cifram suas respectivas parcelas |

Em `omp N` e `pipeline N`, o número selecionado representa as **threads de cifra**. No pipeline, são acrescentadas duas threads de E/S; portanto, `pipeline 3` cria cinco threads. No MPI, `N` é o total de processos, incluindo o rank 0. O rank 0 **não é apenas coordenador**: também processa sua parte do quadro.

### Como funciona a distribuição MPI

Para cada quadro, o processo de rank 0 lê os bytes recebidos do FFmpeg e divide o quadro em parcelas de blocos. Todos os ranks participam das operações coletivas:

1. **Distribuição — `MPI_Scatterv`:** o rank 0 envia a cada processo a parcela que lhe foi atribuída. O rank 0 também mantém e processa sua própria parcela; os demais ranks recebem as suas.
2. **Cifragem:** todos os processos cifram independentemente somente os blocos de sua parcela. O índice dos blocos permanece global, seguindo `quadro × blocos_por_quadro + bloco`.
3. **Reunião — `MPI_Gatherv`:** os processos enviam suas parcelas cifradas e o rank 0 reúne os dados na ordem original, reconstruindo o quadro completo.
4. **Gravação:** o rank 0 encaminha o quadro reconstruído ao FFmpeg.

O programa também usa `MPI_Bcast` para compartilhar metadados e estados de leitura/execução, `MPI_Allreduce` para confirmar que todos os ranks conseguiram alocar os buffers e `MPI_Reduce` para obter o tempo de cifragem mais lento. Essas operações mantêm os ranks sincronizados e permitem registrar as estatísticas. O FFmpeg é iniciado somente pelo rank 0; os outros processos não abrem pipes de vídeo. Nesta integração, `mpirun` inicia os processos no mesmo computador Linux/WSL; a configuração de execução em múltiplos nós não faz parte do laboratório web.

### O que cada modo significa visualmente

A linha do tempo da interface é esquemática. `Cifra Q0/3`, por exemplo, indica a parcela do quadro Q0 processada por um dos três participantes da cifragem. No modo sequencial aparece `Cifra Q0`, pois uma única thread processa o quadro inteiro. No MPI, as etapas de comunicação representam a distribuição das parcelas (`MPI_Scatterv`) e a reunião dos resultados (`MPI_Gatherv`). As larguras dos blocos são ilustrativas e não representam tempos reais nem tamanhos necessariamente iguais.

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

**Versões sequencial, OpenMP e pipeline:**

```bash
./video_hill <seq|omp|pipeline> <threads> <semente> <entrada> <saida.mkv|-> [formato] [raw|ffv1]

./video_hill pipeline 3 123 video.mp4 cifrado.mkv                       # cifrar
./video_hill pipeline 3 123 cifrado.mkv recuperado.mkv yuv420p ffv1     # decifrar
./video_hill omp 4 123 video.mp4 -                                      # medir sem gravar em disco
```

**Versão MPI (Linux/WSL):**

```bash
mpirun -np <processos> ./video_hill_mpi <semente> <entrada> <saida.mkv|-|hash> [formato] [raw|ffv1]

# Cifrar com 4 processos
mpirun -np 4 ./video_hill_mpi 123 video.mp4 cifrado.mkv yuv420p raw

# Decifrar com os mesmos 4 processos e a mesma semente
mpirun -np 4 ./video_hill_mpi 123 cifrado.mkv recuperado.mkv yuv420p ffv1

# Processar e descartar a saída, sem gravar o vídeo cifrado
mpirun -np 4 ./video_hill_mpi 123 video.mp4 - yuv420p raw

# Calcular SHA-256 dos quadros cifrados, sem gerar arquivo de vídeo
mpirun -np 4 ./video_hill_mpi 123 video.mp4 hash yuv420p
```

O número passado a `-np` é a quantidade **total de processos MPI**, incluindo o rank 0. O processo de rank 0 também participa da cifragem; ele não é um processo exclusivamente dedicado à coordenação.

- **Formato de pixel:** `yuv420p` (padrão, nativo da maioria dos vídeos), `yuv444p`, `rgb24` ou `gray`. Use o mesmo formato para cifrar e decifrar.
- **Codec `raw` (padrão):** grava os quadros sem compressão. Quadros cifrados parecem ruído e não comprimem. Num trecho 1080p de 301 quadros, o FFV1 gerou 948 MB contra 893 MB do raw e levou cerca de 23 s para codificar, contra 2,4 s.
- **Codec `ffv1`:** compressão sem perdas. Vale a pena para o vídeo **decifrado**. Como o FFV1 não aceita `rgb24`, esse formato é guardado como `bgr0`, sem perda.
- **Saída `-`:** os quadros são descartados (`ffmpeg -f null`). Isso tira o disco da medição.
- **Saída `hash` (MPI):** calcula SHA-256 dos quadros cifrados, sem gravar o arquivo de vídeo.

O programa sequencial/OpenMP/pipeline imprime uma linha como esta:

```text
modo=pipeline threads=3+2 quadros=241 resolucao=1920x1080 formato=yuv420p bytes_quadro=3110400 codec=raw tempo_total=4.811 s leitura=1.436 s cifra=2.515 s gravacao=0.786 s fps=50.1
```

A versão MPI imprime, entre outros campos, `modo=mpi processos=N`:

```text
modo=mpi processos=4 quadros=241 resolucao=1920x1080 formato=yuv420p bytes_quadro=3110400 codec=raw tempo_total=... s leitura=... s cifra=... s gravacao=... s fps=...
```

- **`cifra`:** nos modos OpenMP/pipeline, considera o tempo da thread de cifra mais lenta por quadro; no MPI, considera o maior tempo de cifragem entre os ranks por quadro, obtido por redução MPI com `MPI_MAX`.
- **`leitura` e `gravacao`:** representam os tempos associados à leitura e à gravação dos quadros pelo FFmpeg, coordenadas pelo rank 0 no MPI.
- **`tempo_total`:** vai da abertura dos pipes até o fim do FFmpeg. No MPI, inclui também o trabalho de comunicação e coordenação dentro do intervalo medido.

### Como verificar que nada se perdeu

Compare o SHA-256 dos quadros brutos do original com os do vídeo recuperado:

```bash
ffmpeg -v error -i video.mp4 -f rawvideo -pix_fmt yuv420p - | sha256sum
ffmpeg -v error -i recuperado.mkv -f rawvideo -pix_fmt yuv420p - | sha256sum
```

Já verificado:

| Verificação | Resultado |
|---|---|
| Ida e volta em `yuv420p`, `rgb24` e `gray`, com codecs `raw` e `ffv1` nos modos CPU testados | hashes idênticos |
| `seq`, `omp` e `pipeline` com diferentes quantidades de threads | geram o mesmo arquivo cifrado nos testes realizados |
| MPI com 2 processos pela API e 3 processos pela interface web | ida e volta com hashes idênticos nos casos testados |
| Benchmark comparativo com `seq`, OpenMP e MPI | execuções concluídas e métricas registradas para 2 e 4 threads/processos |
| Decifrar com a semente errada | não recupera o vídeo |
| Quadro truncado | é recusado, e a saída parcial é apagada |

A versão MPI foi compilada com `mpicc` e executada com MPICH 4.3.2 no Ubuntu/WSL 2. A integração MPI foi validada na demonstração web e no benchmark. A versão sequencial/OpenMP foi testada no Windows com MSVC 2022 e FFmpeg 9.0.1, e compilada sem avisos no GCC em WSL nos testes anteriores.

---

## 📊 Análises

A aba **5. Vídeo & Benchmarks** do site (`python3 server.py` no Linux/WSL ou `python server.py` no Windows) executa os programas C, MPI/CUDA e o FFmpeg localmente, gerando as análises abaixo. Tudo que ela produz vai para `video_lab/`, que o git ignora.

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

### 2. Benchmark: CPU × CUDA e OpenMP × MPI

O benchmark sempre inclui `seq` como referência. Pode executar `omp` e `pipeline` com as quantidades de threads selecionadas, MPI com as quantidades de processos selecionadas e, opcionalmente, uma configuração CUDA na GPU detectada. OpenMP/pipeline e MPI são séries distintas nos gráficos, mas usam o mesmo eixo numérico para facilitar a comparação entre, por exemplo, 4 threads e 4 processos. CUDA aparece como uma categoria GPU separada, não como quantidade de threads ou processos CPU.

- **Execução:** as configurações selecionadas são executadas várias vezes em **ordem embaralhada**. O benchmark realiza aquecimento da CPU e aquecimentos próprios de MPI e CUDA quando esses modos são selecionados.
- **Configurações:** para OpenMP e pipeline, são usadas as quantidades marcadas em **Threads de cifra**; para MPI, são usadas as quantidades marcadas em **Processos MPI**. A quantidade MPI inclui o rank 0, que também participa da cifragem.
- **Registro:** cada rodada é salva em `video_lab/benchmarks.json`.
- **Métricas:** tempo total, leitura, cifra, gravação, quadros por segundo e speedups total e da cifra sobre `seq`. O tempo de cifra CUDA inclui cópias host↔GPU e execução do kernel.
- **Gráficos:** tempo por configuração (mediana, com mínimo e máximo), speedup sobre `seq` e divisão do tempo por etapa, com o tempo total marcado. Os tooltips identificam threads ou processos. A eficiência é calculada separadamente por quantidade de threads OpenMP ou processos MPI; CUDA aparece como GPU e não possui eficiência por thread/processo CPU.
- **Dados dinâmicos:** **os gráficos são gerados a partir das execuções reais** e mudam a cada rodada. As rodadas anteriores continuam disponíveis para comparação.

Rodada histórica de referência CPU: trecho de 8 s em 1080p (241 quadros), 5 repetições, sem gravar em disco, num Intel i5-4670K com 4 núcleos e Windows 10. Essa tabela registra somente `seq`, OpenMP e pipeline; **não inclui MPI nem CUDA**. Ela é mantida como referência histórica, não como comparação dos resultados MPI atuais.

| Configuração | Tempo total | Speedup total | Tempo da cifra | Speedup da cifra | Quadros/s |
|---|---|---|---|---|---|
| `seq` | 7,74 s | 1,00× | 6,02 s | 1,00× | 31,1 |
| `omp 2` | 6,22 s | 1,24× | 4,69 s | 1,28× | 38,7 |
| `omp 4` | 5,41 s | 1,43× | 3,70 s | 1,62× | 44,6 |
| `pipeline 2+2` | 5,23 s | 1,48× | 3,93 s | 1,53× | 46,1 |
| `pipeline 4+2` | **4,99 s** | **1,55×** | 2,17 s | 2,77× | **48,3** |

O que os números mostram:

1. **A cifra domina o tempo.** Na rodada CPU `seq`, ela ocupa 78% do total, então é a parte certa para paralelizar.
2. **O pipeline é o melhor modo CPU medido.** Ele ganha porque leitura e gravação passam a acontecer ao mesmo tempo que a cifra. No gráfico de etapas, as barras do pipeline somam mais que o tempo total, e é justamente a sobreposição que faz isso.
3. **O ganho CPU fica bem abaixo do ideal** (4× com 4 threads). Com as 2 threads de E/S, o `pipeline 4+2` cria 6 threads para 4 núcleos, e elas ainda disputam o processador com os processos do FFmpeg. Mesmo isolada, sem FFmpeg, a cifra escalou só 2,1× a 2,4× nesta máquina. A causa ainda precisa ser investigada: vale repetir no Linux, com o computador sem outros programas abertos.
4. **Os tempos variam entre execuções.** Outros programas, a temperatura e a frequência do processador interferem. Por isso cada configuração é repetida e o gráfico usa a mediana. Diferenças dentro da faixa entre mínimo e máximo não devem virar conclusão. Para CUDA, compare também o tempo total, pois inclui FFmpeg e as transferências entre CPU e GPU.

### 3. O que descobrimos no caminho

- **O disco atrapalhava as medições.** Gravando cerca de 900 MB por execução num SSD SATA sem DRAM, o tempo de gravação oscilava entre 1 e 9 s. A saída `-` resolve isso para os benchmarks.
- **O FFV1 não compensa no vídeo cifrado.** Ruído não comprime, e o codec virou o gargalo. Por isso o codec `raw` passou a ser o padrão.
- **A medida do pipeline foi corrigida.** A primeira versão somava o tempo de cada thread de cifra separadamente, o que favorecia o pipeline (1,83 s em vez de 2,38 s). Hoje os dois modos medem a cifra pela thread mais lenta de cada quadro.
- **Uma hipótese foi descartada.** Suspeitamos que as threads do `omp` demoravam a "acordar" entre quadros (o relógio do Windows tem resolução de 15,6 ms). Um teste com e sem pausa entre as regiões paralelas deu o mesmo tempo, então não era isso.

### 4. Protocolo do artigo (tempo + energia na mesma máquina)

Os experimentos do artigo rodam pela linha de comando, sem o site, para atender à revisão do WPADS: mesmo escopo de tempo nas versões incluídas no protocolo, energia da CPU e da GPU na mesma janela, verificação de que descartar a saída não muda os bytes cifrados, e média ± dispersão com testes estatísticos. Esta seção documenta o fluxo de medição já existente para `seq`, OpenMP, pipeline e CUDA. A comparação MPI descrita neste README corresponde ao benchmark da interface web (`server.py` e `video_lab/benchmarks.json`); não se deve presumir que os scripts de tempo/energia desta seção já incluam MPI.

**Preparar a máquina.** Os experimentos rodam no **Ubuntu do WSL 2**. No Windows 11 com o Controle Inteligente de Aplicativos ligado, o instalador do CUDA e os `.exe` sem assinatura são bloqueados; no WSL, nada disso acontece. Só o HWiNFO roda no Windows, porque o WSL não expõe o RAPL da CPU.

```powershell
winget install --id REALiX.HWiNFO --exact                      # Windows: potência do pacote da CPU
wsl -d Ubuntu -u root -- apt install -y ffmpeg nvidia-cuda-toolkit rsync g++-13
wsl -d Ubuntu -- bash preparar_wsl.sh                          # copia para ~/pcd e compila (GCC + nvcc)
```

O `preparar_wsl.sh` copia o projeto para `~/pcd`, porque ler o vídeo por `/mnt/c` mediria o compartilhamento de arquivos. Ele grava o commit em `.commit`, compila o `video_hill` com GCC e o backend CUDA com `NVCC_CCBIN=g++-13`, já que o CUDA 12.4 do Ubuntu não aceita o GCC 15. Rode de novo a cada mudança no código.

**Rodar:**

1. Notebook na tomada, plano de energia de alto desempenho, outros programas fechados.
2. No HWiNFO (*Sensors only*), ajuste o intervalo de leitura para 100 ms e ative **Logging** em CSV.
3. Lote principal (saída descartada, trecho de 30 s ≈ 900 quadros, para que até as execuções mais rápidas durem alguns segundos):
   ```powershell
   wsl -d Ubuntu -- bash -lc "cd ~/pcd && NVCC_CCBIN=g++-13 python3 benchmark.py --modos seq omp pipeline cuda --threads 1 2 4 6 8 10 12 14 16 --reps 10 --segundos 30 --rotulo principal"
   ```
4. Pare o log do HWiNFO e analise. O `analisar.py` usa o fuso do Windows e a diferença entre os relógios, registrados em `meta.json`:
   ```powershell
   wsl -d Ubuntu -- bash -lc "cd ~/pcd && python3 analisar.py resultados/<id>-principal --hwinfo /mnt/c/caminho/hwinfo.csv"
   ```
5. Lote de sensibilidade (gravando em disco), com a melhor configuração de cada modo segundo o passo 4, usando `--saida disco --rotulo disco`.
6. Copie `~/pcd/resultados/` de volta para o repositório (`\\wsl$\Ubuntu\root\pcd\resultados`).

**O que cada script faz:**

- `benchmark.py`: antes de medir, roda cada configuração com a saída `hash` (SHA-256 dos quadros cifrados, sem disco) e só continua se todas derem o mesmo hash do `seq` e se a ida e volta devolver os quadros originais. Depois mede 30 s ocioso, faz o aquecimento e as repetições em ordem embaralhada, com pausa entre execuções. Também amostra a potência da GPU (`nvidia-smi`, `power.draw.instant`, a cada 100 ms) e mede mais 30 s ocioso no fim. Cada execução vai para `resultados/<id>/execucoes.csv` com `inicio_epoch`/`fim_epoch`, e `meta.json` guarda a máquina, as versões, o commit e o resultado da verificação.
- `analisar.py`: integra a potência da CPU (HWiNFO) e da GPU na janela de cada execução e desconta a potência ociosa para a energia líquida. Calcula média, dp, CV, IC95 (t), speedup com IC95 (bootstrap) e testes de Welch com correção de Holm. Gera `resumo.csv`, `comparacoes.csv` e `tabelas.tex`, e também aceita `video_lab/benchmarks.json` ou um CSV com uma linha por execução.

**Escopo das medidas:** `tempo_total` vai da abertura do FFmpeg de leitura até o fim do FFmpeg de saída, nas quatro versões. No `cuda`, ele também inclui iniciar o processo e criar o contexto da GPU, que vêm separados em `init_gpu`; o analisador calcula `tempo_sem_init`. No `cuda`, `cifra` = cópia→GPU + kernel + cópia←GPU, com cada parte em `copia_h2d`, `kernel` e `copia_d2h` (eventos CUDA).

### Limitações

- A tabela histórica acima foi obtida em uma máquina Windows com 4 núcleos. As novas rodadas do laboratório web são medidas no computador em que o servidor local é executado; resultados de máquinas diferentes não devem ser misturados sem considerar as diferenças de hardware e ambiente.
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
**1. O que é & Como Funciona (Aprenda do Zero):**
   - Explicação histórica e intuitiva do objetivo da cifra poligráfica.
   - Régua interativa do alfabeto ($A=0 \dots Z=25$).
   - Demonstração visual da multiplicação matricial com botões de teste interativo ("CA", "OI", "PA").
   - O relógio de 26 horas ilustrando a aritmética modular $\pmod{26}$.
**2. Laboratório Interativo (Mesa de Operação):**
   - Matrizes espaçosas e de alta visibilidade, sem aperto ou vazamento de texto.
   - Esteira de blocos clicáveis.
   - **Fluxo inteligente e intuitivo de Encriptação & Decriptação:**
     - *Modo Encriptação:* Texto original $\to$ multiplicado por $K$ $\to$ gera o texto cifrado.
     - *Modo Decriptação:* O texto cifrado gerado é carregado na entrada $\to$ multiplicado por $K^{-1}$ $\to$ revela a mensagem original restaurada!
   - Execução passo a passo manual e reprodução automática (*auto-play*) com velocidade configurável.
**3. Como Desfazer a Cifra (A Inversa em C Explicada):**
   - O Dilema da Divisão em Criptografia (por que frações como $8/25 = 0.32$ não existem no alfabeto).
   - A Solução do Relógio (+26) e como a função `Mat_add_num_till_divisible` em C resolve isso sem aproximações.
   - Os 4 passos matemáticos da inversão (Determinante, Cofatores, Adjunta e Ajuste).
   - Tabela de rastreamento ao vivo para as 9 posições da matriz ativa.
**4. Imagens e Paralelismo:**
   - Guia para iniciantes sobre pixels, canais RGB, blocos, módulo 256, matriz auto invertível e threads.
   - Carregamento de PNG/JPEG/PGM/PPM ou imagem de exemplo, com prévias de entrada e saída.
   - Cifragem e decifragem em Web Workers, usando a mesma geração de matrizes do código C.
   - Matriz e multiplicação linha por linha do bloco selecionado, divisão estática dos blocos entre workers e download em PNG ou PGM/PPM.
   - O tempo mostrado pertence ao navegador; os benchmarks do artigo devem usar o programa C.
**5. Vídeo & Benchmarks** (precisa de `server.py`, FFmpeg e `video_hill` compilado; MPI requer também `video_hill_mpi`, `mpirun` e `mpicc`; CUDA é opcional):
   - Explicação dos modos `seq`, `omp`, `pipeline` e `mpi`, com linhas do tempo que ilustram a divisão dos quadros entre threads/processos, além do modo `cuda`.
   - Laboratório: cifra e decifra um trecho do `video.mp4`, mostra original, cifrado e decifrado sincronizados e confere o SHA-256 dos quadros.
   - Análise visual de um quadro: histogramas, entropia e correlação dos planos Y, U e V, com detecção do vazamento.
   - Benchmark: baseline `seq`, configurações OpenMP/pipeline por threads, MPI por processos e CUDA GPU opcional; compara tempo total, etapas, FPS, speedup, eficiência e faixas de variação a partir das execuções reais.

### Como rodar a aplicação web:

No Linux/WSL:
```bash
python3 server.py
```

No Windows:
```powershell
python server.py
```

Acesse no navegador: **`http://localhost:8085`**. O `server.py` serve o site e atende a aba **5. Vídeo & Benchmarks**, executando os programas `video_hill`/FFmpeg, o programa `video_hill_mpi` por meio de `mpirun` e o backend CUDA/FFmpeg quando CUDA estiver disponível. O servidor usa somente a biblioteca padrão do Python e escuta em `127.0.0.1`. As abas 1 a 4 também funcionam com `python3 -m http.server 8085` ou `npx serve .`; porém, a demonstração de vídeo, as APIs e os benchmarks precisam de `server.py`. A aba de imagens usa módulos JavaScript e Web Workers, por isso também precisa de um servidor local.

A aba de vídeo precisa de:
- `video.mp4` na pasta do projeto;
- FFmpeg instalado (o servidor também encontra a instalação feita pelo winget);
- `video_hill` compilado na raiz do projeto para `seq`, OpenMP e pipeline;
- para MPI, `video_hill_mpi` compilado na raiz do projeto e `mpirun` disponível no PATH. A compilação MPI está documentada para Linux/WSL.

O modo GPU de imagem e vídeo e o benchmark CUDA são opcionais: exigem GPU NVIDIA compatível, driver, CUDA Toolkit e MSVC no Windows, conforme a seção *Modos GPU CUDA na interface*. O baseline `seq` continua obrigatório em cada rodada de benchmark, então os modos CPU permanecem necessários para a comparação.

O que a aba faz:
- **Laboratório:** recorta um trecho do vídeo, cifra, decifra, compara o SHA-256 dos quadros e mostra os três vídeos sincronizados (original, cifrado e decifrado). Também mostra os tempos impressos pelo programa e a análise de um quadro: histogramas, entropia e correlação entre vizinhos dos planos Y, U e V.
- **Demonstração MPI:** executa cifragem e decifragem com a quantidade de processos escolhida. O rank 0 lê os quadros, distribui as parcelas com `MPI_Scatterv`, reúne as parcelas processadas com `MPI_Gatherv` e grava os quadros; todos os ranks, inclusive o rank 0, participam da cifra.
- **Benchmark:** sempre roda `seq`; também pode rodar `omp` e `pipeline` com as quantidades de threads escolhidas, MPI com as quantidades de processos escolhidas e, opcionalmente, uma configuração `cuda`. Faz aquecimentos próprios e repetições em ordem embaralhada. Os resultados ficam em `video_lab/benchmarks.json` e aparecem em gráficos de tempo por configuração, speedup e divisão por leitura/cifra/gravação. A tabela e os tooltips distinguem threads de processos; CUDA é mostrado como GPU. A opção *Descartar a saída* evita manter a saída de vídeo no disco durante a medição.

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
├── video-lab.mjs               # Aba de vídeo: laboratório, análise, demonstração MPI e benchmark
├── server.py                   # Servidor local: site + APIs de imagem, vídeo CPU/MPI/CUDA e benchmarks
├── video.mp4                   # Video de teste (1080p, 79 s)
├── video_lab/                  # Saidas do laboratorio e benchmarks.json (gerado, ignorado pelo git)
├── hello_mpi.c                 # Programa mínimo para testar a instalação MPI
├── tanayseven_hill_cipher.c    # Código em C de referência compilável
├── HillCypherCode/
│   ├── hillcypherOMP.c         # Experimento anterior com texto modulo 26
│   ├── image_hill.c            # Cifra experimental de imagens seq/OMP/Pthreads
│   ├── image_hill_cuda.cu      # Backend CUDA: imagens em lotes e vídeo em streaming
│   ├── hill_block.h            # Núcleo da cifra (mix e block) usado pelo vídeo
│   ├── video_hill.c            # Cifra de vídeo quadro a quadro: seq/OMP/pipeline
│   ├── video_hill_mpi.c        # Versão MPI: distribuição dos blocos entre processos
│   ├── stb_image.h             # Leitura de imagens (biblioteca stb)
│   └── stb_image_write.h       # Escrita de imagens (biblioteca stb)
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