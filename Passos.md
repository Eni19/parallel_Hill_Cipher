# Passo a passo para concluir o artigo

Este roteiro parte de `Artigo_PCD_SBC_Esboço_Imagens.docx` e do programa `HillCypherCode/image_hill.c`. A pergunta central já está definida: **como o tamanho da imagem e o número de threads afetam o desempenho da cifra de Hill auto-invertível?** O que falta é produzir evidência experimental e escrever a análise correspondente.

## 1. Fechar o escopo antes das medições

- [ ] Manter a comparação principal entre **sequencial, OpenMP e Pthreads** sobre a mesma transformação de blocos de 4 bytes.
- [ ] Decidir com a professora se a expansão **caótica** faz parte deste artigo. **O código atual não usa mapa logístico**: a função `mix` gera valores determinísticos a partir da semente e do índice do bloco. Se a variante caótica entrar no estudo, implementá-la e validá-la antes dos benchmarks, explicitando o custo adicional e como cada bloco reproduz sua matriz independentemente do número de threads. Se ficar para trabalho futuro, retirar qualquer afirmação de que ela já foi implementada.
- [ ] Não apresentar a semente numérica ou a auto-inversão como prova de segurança criptográfica. O foco do artigo é **correção e desempenho paralelo**.

**Pronto quando:** título, objetivo, hipótese e implementação descrevem exatamente a mesma experiência.

## 2. Validar as três versões no mesmo ambiente

- [ ] Usar uma máquina Linux/POSIX para compilar e executar os três modos. No Windows, o programa oferece sequencial e OpenMP; Pthreads está protegido por `#ifndef _WIN32`.
- [ ] Compilar todas as versões a partir do mesmo arquivo e registrar o comando:

```bash
gcc -O2 -std=c11 -fopenmp -pthread HillCypherCode/image_hill.c -o image_hill
```

- [ ] Testar PGM P5 e PPM P6 de 8 bits, dimensões pequenas e grandes, e entradas cujo total de bytes deixe blocos finais de 1, 2 e 3 bytes.
- [ ] Para cada entrada, cifrar e decifrar com a **mesma semente**; comparar os bytes dos pixels recuperados com os originais. O cabeçalho PNM é reescrito, então uma comparação do arquivo inteiro pode acusar diferença mesmo quando os pixels são idênticos.
- [ ] Confirmar que `seq`, `omp` e `pthread` produzem exatamente os mesmos bytes cifrados para a mesma entrada e semente, inclusive com diferentes quantidades de threads.
- [ ] Automatizar esses testes. O `README.md` cita `tests/test_image_hill.py`, mas esse arquivo **não está presente nesta pasta**; criá-lo ou corrigir essa referência antes da entrega.

**Pronto quando:** os testes passam nos três modos e os resultados não dependem da contagem de threads.

## 3. Definir um protocolo experimental fixo

- [ ] Registrar CPU, núcleos físicos e lógicos, RAM, sistema operacional, versão do GCC e opções de compilação. Guardar também a versão do código usada nas medições.
- [ ] Preparar imagens sem compressão de tamanhos pequeno, médio e grande; por exemplo, PGM `512 × 512` e PPM `2048 × 2048` e `4096 × 4096`, ajustando o maior tamanho à RAM disponível. Fixar e registrar a semente e os arquivos de entrada.
- [ ] Medir `seq` e `omp`/`pthread` com `1, 2, 4, ...` threads até a quantidade de núcleos lógicos da máquina. Usar o mesmo equipamento, compilador, entradas e opções para todas as versões; não comparar diretamente tempos obtidos em Windows e Linux como se fossem o mesmo ambiente.
- [ ] Fazer algumas execuções de aquecimento e pelo menos 20 repetições por configuração. Alternar ou embaralhar a ordem das configurações para reduzir o efeito da temperatura e da carga do sistema. Registrar todas as amostras, não só o melhor tempo.
- [ ] Usar o campo `tempo_transformacao` impresso pelo programa: ele cobre a transformação em memória; em Pthreads inclui criação e junção das threads. Leitura, escrita e preparação da entrada ficam fora desse campo. Se medir tempo total também, apresentá-lo em coluna separada.

**Pronto quando:** outra pessoa consegue repetir a medição apenas com o protocolo, os arquivos de entrada e o código.

## 4. Coletar e analisar os dados

- [ ] Executar a linha de comando para cada combinação de imagem, modo e número de threads; o menu interativo é útil para demonstração, mas a linha de comando facilita a automação:

```bash
./image_hill seq 1 123 entrada.ppm saida_seq.ppm
./image_hill omp 4 123 entrada.ppm saida_omp.ppm
./image_hill pthread 4 123 entrada.ppm saida_pthread.ppm
```

- [ ] Salvar os tempos brutos em CSV com `imagem,bytes,modo,threads,repeticao,tempo_s` e calcular mediana e dispersão (por exemplo, intervalo interquartil) por configuração.
- [ ] Calcular `speedup(p) = T_seq / T_modo(p)`, `eficiencia(p) = speedup(p) / p` e `vazao_MB_s = bytes / tempo_s / 1_000_000`. Usar a mesma imagem e o mesmo tipo de mediana em cada comparação.
- [ ] Produzir ao menos uma tabela com tempos e métricas e dois gráficos: **tempo × threads** e **speedup × threads**, com curvas separadas por modo e tamanho de imagem. Indicar a dispersão ou mostrar as amostras.
- [ ] Descrever onde há ganho, saturação ou perda, comparando imagens pequenas e grandes. Relacionar o comportamento observado ao custo de criar threads, ao trabalho por bloco e a possíveis limites de memória; identificar essas causas como hipóteses quando não houver medição específica.
- [ ] Só acrescentar consumo de energia se houver instrumento e método confiáveis. Não inferir economia de energia apenas a partir de menor tempo.

**Pronto quando:** cada conclusão de desempenho aponta para uma medição ou gráfico específico.

## 5. Transformar o esboço em artigo final

- [ ] Trocar os verbos no futuro do resumo, metodologia e conclusão por descrições do que foi realmente executado. Inserir os principais números no resumo **após** a análise.
- [ ] Completar **Resultados e discussão** com ambiente, protocolo, tabelas, gráficos, interpretação e comparação explícita entre OpenMP e Pthreads.
- [ ] Atualizar **Ameaças à validade** com limitações observadas: uma máquina, formatos P5/P6 sem compressão, blocos de 4 bytes, variação de carga, compilador e ausência de avaliação de segurança.
- [ ] Explicar no texto a matriz `K = [A, I − A²; I, −A] (mod 256)` e por que `K² = I`; deixar claro como são tratados os blocos finais. Descrever o gerador realmente usado no código.
- [ ] Revisar referências, citações no texto, legendas, unidades, símbolos, autoria e exigências do modelo da SBC fornecido pela disciplina. Referenciar implementações de terceiros como base, sem atribuir a elas resultados produzidos neste projeto.
- [ ] Fazer uma leitura final verificando se pergunta, método, resultados e conclusão respondem uns aos outros, sem números inventados nem afirmações de segurança não testadas.

**Pronto quando:** o artigo contém resultados reproduzíveis, responde à pergunta de pesquisa e está no formato pedido pela disciplina.

## Ordem recomendada

**Escopo → validação POSIX → protocolo → coleta → gráficos → redação final → revisão SBC.** O site serve como demonstração didática; seus tempos de Web Workers não devem entrar nas tabelas do artigo sobre o programa em C.
