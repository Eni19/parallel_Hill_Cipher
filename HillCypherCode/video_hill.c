/* Cifra de Hill auto-invertivel aplicada a videos, quadro a quadro.
 * Uso: video_hill <seq|omp|pipeline> <threads> <seed> <entrada> <saida.mkv> [yuv420p|yuv444p|rgb24|gray] [raw|ffv1]
 * O FFmpeg decodifica a entrada em quadros brutos; a saida e gravada sem perdas: quadros brutos (raw)
 * ou FFV1. Quadros cifrados parecem ruido e nao comprimem, entao raw e o padrao.
 * A mesma operacao cifra e decifra; finalidade didatica, sem seguranca moderna.
 */
#define _CRT_SECURE_NO_WARNINGS
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "hill_block.h"

#ifdef _OPENMP
#include <omp.h>
#endif
#ifdef _WIN32
#define popen _popen
#define pclose _pclose
#define PIPE_R "rb"
#define PIPE_W "wb"
#define QUOTE '"'
#define FORBIDDEN "\"%"
#else
#include <signal.h>
#include <sys/wait.h>
#define PIPE_R "r"
#define PIPE_W "w"
#define QUOTE '\''
#define FORBIDDEN "'"
#endif

#define CMD_MAX 4096

/* Formato dos quadros no pipe e formato armazenado no FFV1 (que nao aceita rgb24; bgr0 e equivalente sem perdas). */
typedef struct { const char *name, *stored; } PixFmt;
static const PixFmt formats[] = {
    {"yuv420p", "yuv420p"}, {"yuv444p", "yuv444p"}, {"rgb24", "bgr0"}, {"gray", "gray"}
};

typedef struct {
    FILE *in, *out;
    size_t bytes, blocks;  /* por quadro */
    uint64_t seed;
} Video;

typedef struct { unsigned long long frames; double read, cipher, write; } Stats;

static int number(const char *s, uint64_t *v) {
    char *end;
    errno = 0;
    *v = strtoull(s, &end, 10);
    return s[0] != '-' && s[0] && !*end && !errno;
}

static double now(void) {
#ifdef _OPENMP
    return omp_get_wtime();
#else
    struct timespec t;
    timespec_get(&t, TIME_UTC);
    return (double)t.tv_sec + (double)t.tv_nsec * 1e-9;
#endif
}

static int ends_with_mkv(const char *path) {
    size_t n = strlen(path);
    return n >= 4 && !strcmp(path + n - 4, ".mkv");
}

/* Coloca o caminho entre aspas para o shell; recusa caracteres que escapariam das aspas. */
static int quote(char *dst, size_t cap, const char *path) {
    if (strpbrk(path, FORBIDDEN)) return 0;
    return snprintf(dst, cap, "%c%s%c", QUOTE, path, QUOTE) < (int)cap;
}

static int exited_ok(int status) {
#ifdef _WIN32
    return status == 0;
#else
    return status != -1 && WIFEXITED(status) && WEXITSTATUS(status) == 0;
#endif
}

/* Le largura, altura e taxa de quadros do primeiro fluxo de video com o ffprobe. */
static int probe(const char *quoted, int *w, int *h, char *fps, size_t cap) {
    char cmd[CMD_MAX], line[256];
    FILE *p;
    *w = *h = 0;
    fps[0] = 0;
    snprintf(cmd, sizeof cmd, "ffprobe -v error -select_streams v:0 "
             "-show_entries stream=width,height,r_frame_rate -of default=noprint_wrappers=1 %s", quoted);
    if (!(p = popen(cmd, PIPE_R))) return 0;
    while (fgets(line, sizeof line, p)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!strncmp(line, "width=", 6)) *w = atoi(line + 6);
        else if (!strncmp(line, "height=", 7)) *h = atoi(line + 7);
        else if (!strncmp(line, "r_frame_rate=", 13) && strlen(line + 13) < cap) strcpy(fps, line + 13);
    }
    if (!exited_ok(pclose(p))) return 0;
    return *w > 0 && *h > 0 && *w <= 16384 && *h <= 16384 &&
           fps[0] && strspn(fps, "0123456789/") == strlen(fps) && fps[0] != '0';
}

static size_t frame_bytes(const char *fmt, size_t w, size_t h) {
    if (!strcmp(fmt, "gray")) return w * h;
    if (!strcmp(fmt, "yuv420p")) return w * h + 2 * ((w + 1) / 2) * ((h + 1) / 2);
    return 3 * w * h;
}

/* 1 = quadro completo, 0 = fim do video, -1 = quadro truncado ou erro. */
static int read_frame(FILE *f, uint8_t *buf, size_t n) {
    size_t got = fread(buf, 1, n, f);
    if (got == n) return 1;
    return got == 0 && feof(f) ? 0 : -1;
}

/* Blocos [b0, b1) do quadro; o indice global (first + b) continua de um quadro para o outro. */
static void cipher(uint8_t *frame, size_t bytes, uint64_t seed, uint64_t first, size_t b0, size_t b1) {
    size_t b;
    for (b = b0; b < b1; ++b) {
        size_t off = b * 4, n = bytes - off;
        block(frame + off, n < 4 ? n : 4, seed, first + b);
    }
}

/* seq e omp: le um quadro, cifra no proprio buffer e grava, uma etapa depois da outra. */
static int run_simple(Video *v, int threads, int parallel, Stats *st) {
    uint8_t *buf = malloc(v->bytes);
    int r = -1;
    if (!buf) return 0;
    for (;;) {
        uint64_t first = st->frames * (uint64_t)v->blocks;
        double t = now();
        r = read_frame(v->in, buf, v->bytes);
        st->read += now() - t;
        if (r <= 0) break;
        t = now();
        if (parallel) {
#ifdef _OPENMP
            long long b;
            #pragma omp parallel for schedule(static) num_threads(threads)
            for (b = 0; b < (long long)v->blocks; ++b) {
                size_t off = (size_t)b * 4, n = v->bytes - off;
                block(buf + off, n < 4 ? n : 4, v->seed, first + (uint64_t)b);
            }
#endif
        } else cipher(buf, v->bytes, v->seed, first, 0, v->blocks);
        st->cipher += now() - t;
        t = now();
        if (fwrite(buf, 1, v->bytes, v->out) != v->bytes) { r = -1; break; }
        st->write += now() - t;
        st->frames++;
    }
    (void)threads;
    free(buf);
    return r == 0;
}

#ifdef _OPENMP
/* pipeline: 3 buffers em rodizio. No passo s, ao mesmo tempo:
 *   thread 0 le o quadro s       no buffer s%3
 *   threads 2.. cifram o quadro s-1 no buffer (s-1)%3, cada uma com sua fatia de blocos
 *   thread 1 grava o quadro s-2  do buffer (s-2)%3
 * Uma barreira separa os passos, e o quadro e sobrescrito no proprio buffer. */
static int run_pipeline(Video *v, int workers, Stats *st) {
    uint8_t *slot[3] = {NULL, NULL, NULL};
    int filled[3] = {0, 0, 0};
    int read_failed = 0, write_failed = 0, too_few = 0, halt = 0, i;
    double *step = calloc((size_t)workers + 2, sizeof *step);  /* tempo de cada thread no passo atual */
    double read_time = 0, cipher_time = 0, write_time = 0;
    unsigned long long frames = 0;
    for (i = 0; i < 3; ++i) slot[i] = malloc(v->bytes);
    if (!step || !slot[0] || !slot[1] || !slot[2]) {
        for (i = 0; i < 3; ++i) free(slot[i]);
        free(step);
        return 0;
    }
    omp_set_dynamic(0);
    #pragma omp parallel num_threads(workers + 2)
    {
        int id = omp_get_thread_num(), team = omp_get_num_threads();
        int w = id - 2, nw = team - 2, eof = 0, stop = 0;
        long long s;
        if (team < 3) {
            #pragma omp single
            too_few = 1;
            stop = 1;
        }
        for (s = 0; !stop; ++s) {
            double t = now();
            if (id == 0) {
                int r = 0;
                if (!eof) {
                    r = read_frame(v->in, slot[s % 3], v->bytes);
                    if (r < 0) read_failed = 1;
                    if (r != 1) eof = 1;
                }
                filled[s % 3] = r == 1;
            } else if (id == 1) {
                if (s >= 2 && filled[(s - 2) % 3] && !write_failed) {
                    if (fwrite(slot[(s - 2) % 3], 1, v->bytes, v->out) != v->bytes) write_failed = 1;
                    else ++frames;
                }
            } else if (s >= 1 && filled[(s - 1) % 3]) {
                cipher(slot[(s - 1) % 3], v->bytes, v->seed, (uint64_t)(s - 1) * v->blocks,
                       v->blocks * (size_t)w / (size_t)nw, v->blocks * (size_t)(w + 1) / (size_t)nw);
            }
            step[id] = now() - t;
            #pragma omp barrier
            /* Uma thread soma os tempos do passo e decide se para, enquanto as outras esperam
             * (barreira implicita do single). A cifra do passo vale o tempo da thread de cifra
             * mais lenta, como no modo omp. Sem mais quadros, o passo s+1 nao tem trabalho. */
            #pragma omp single
            {
                double slowest = 0;
                int k;
                for (k = 2; k < team; ++k) if (step[k] > slowest) slowest = step[k];
                read_time += step[0];
                write_time += step[1];
                cipher_time += slowest;
                halt = read_failed || write_failed || (s >= 1 && !filled[(s - 1) % 3]);
            }
            stop = halt;
        }
    }
    st->frames = frames;
    st->read = read_time;
    st->write = write_time;
    st->cipher = cipher_time;
    for (i = 0; i < 3; ++i) free(slot[i]);
    free(step);
    if (too_few) fprintf(stderr, "O pipeline precisa de pelo menos 3 threads OpenMP\n");
    return !too_few && !read_failed && !write_failed;
}
#endif

int main(int argc, char **argv) {
    const PixFmt *fmt = &formats[0];
    char qin[1100], qout[1100], fps[32], cmd_in[CMD_MAX], cmd_out[CMD_MAX];
    uint64_t parsed, seed;
    int threads, width, height, ok = 0, ok_in, ok_out;
    size_t i;
    double start, elapsed;
    Video v = {NULL, NULL, 0, 0, 0};
    Stats st = {0, 0, 0, 0};
    const char *mode = argc > 1 ? argv[1] : "";
    int ffv1 = 0, discard = argc > 5 && !strcmp(argv[5], "-");

    if (argc < 6 || argc > 8 || (strcmp(mode, "seq") && strcmp(mode, "omp") && strcmp(mode, "pipeline")) ||
        !number(argv[2], &parsed) || parsed < 1 || parsed > 1024 || !number(argv[3], &seed)) {
        fprintf(stderr, "uso: %s <seq|omp|pipeline> <threads> <seed> <entrada> <saida.mkv|-> [formato] [raw|ffv1]\n"
                "formatos: yuv420p (padrao), yuv444p, rgb24, gray; codec: raw (padrao) ou ffv1\n"
                "saida '-': descarta os quadros (mede sem gravar em disco)\n", argv[0]);
        return 1;
    }
    threads = strcmp(mode, "seq") ? (int)parsed : 1;
    if (argc >= 7) {
        for (fmt = NULL, i = 0; i < sizeof formats / sizeof formats[0]; ++i)
            if (!strcmp(argv[6], formats[i].name)) fmt = &formats[i];
        if (!fmt) { fprintf(stderr, "Formato de pixel desconhecido: %s\n", argv[6]); return 1; }
    }
    if (argc == 8) {
        ffv1 = !strcmp(argv[7], "ffv1");
        if (!ffv1 && strcmp(argv[7], "raw")) { fprintf(stderr, "Codec desconhecido: %s\n", argv[7]); return 1; }
    }
#ifndef _OPENMP
    if (strcmp(mode, "seq")) { fprintf(stderr, "OpenMP indisponivel nesta compilacao\n"); return 1; }
#endif
    if (!discard && !ends_with_mkv(argv[5])) { fprintf(stderr, "A saida precisa ser .mkv (gravada sem perdas)\n"); return 1; }
    if (!strcmp(argv[4], argv[5])) { fprintf(stderr, "Use outro nome para preservar a entrada\n"); return 1; }
    if (!quote(qin, sizeof qin, argv[4]) || (!discard && !quote(qout, sizeof qout, argv[5]))) {
        fprintf(stderr, "Caminho com caractere nao suportado\n");
        return 1;
    }
    if (!probe(qin, &width, &height, fps, sizeof fps)) {
        fprintf(stderr, "ffprobe falhou: verifique se o FFmpeg esta no PATH e se a entrada e um video\n");
        return 1;
    }
    v.bytes = frame_bytes(fmt->name, (size_t)width, (size_t)height);
    v.blocks = v.bytes / 4 + (v.bytes % 4 != 0);
    v.seed = seed;

    /* passthrough: cada quadro decodificado sai uma unica vez, sem duplicar nem descartar. */
    snprintf(cmd_in, sizeof cmd_in, "ffmpeg -v error -nostdin -i %s -map 0:v:0 -fps_mode passthrough "
             "-f rawvideo -pix_fmt %s pipe:1", qin, fmt->name);
    /* Com saida "-", o FFmpeg recebe os quadros e os descarta: o pipe continua, o disco sai da medicao. */
    snprintf(cmd_out, sizeof cmd_out, "ffmpeg -v error -nostdin -y -f rawvideo -pix_fmt %s -s %dx%d "
             "-framerate %s -i pipe:0 %s%s %s", fmt->name, width, height, fps,
             discard ? "-f null" : ffv1 ? "-c:v ffv1 -level 3 -g 1 -pix_fmt " : "-c:v rawvideo -pix_fmt ",
             discard ? "" : ffv1 ? fmt->stored : fmt->name, discard ? "-" : qout);
#ifndef _WIN32
    signal(SIGPIPE, SIG_IGN);
#endif
    start = now();
    v.in = popen(cmd_in, PIPE_R);
    v.out = popen(cmd_out, PIPE_W);
    if (v.in && v.out) {
        setvbuf(v.in, NULL, _IOFBF, 1 << 20);
        setvbuf(v.out, NULL, _IOFBF, 1 << 20);
        if (!strcmp(mode, "pipeline")) {
#ifdef _OPENMP
            ok = run_pipeline(&v, threads, &st);
#endif
        } else ok = run_simple(&v, threads, !strcmp(mode, "omp"), &st);
    }
    ok_in = v.in && exited_ok(pclose(v.in));
    ok_out = v.out && exited_ok(pclose(v.out));
    elapsed = now() - start;
    if (!ok || !ok_in || !ok_out) {
        fprintf(stderr, "Erro: leitura, cifra ou gravacao do video falhou (%s)\n",
                !ok_in ? "decodificacao" : !ok_out ? "codificacao" : "processamento");
        if (!discard) remove(argv[5]);
        return 1;
    }
    printf("modo=%s threads=%d%s quadros=%llu resolucao=%dx%d formato=%s bytes_quadro=%zu "
           "codec=%s tempo_total=%.3f s leitura=%.3f s cifra=%.3f s gravacao=%.3f s fps=%.1f\n",
           mode, threads, strcmp(mode, "pipeline") ? "" : "+2", st.frames, width, height, fmt->name,
           v.bytes, discard ? "descartado" : ffv1 ? "ffv1" : "raw", elapsed, st.read, st.cipher, st.write, (double)st.frames / elapsed);
    return 0;
}
