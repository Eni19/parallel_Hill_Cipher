/* Cifra de Hill auto-invertivel para PNG/PGM/PPM de 8 bits.
 * Uso: image_hill (menu) ou image_hill <seq|omp|pthread> <threads> <seed> <entrada> <saida>
 * A mesma operacao cifra e decifra; finalidade didatica, sem seguranca moderna.
 */
#define _CRT_SECURE_NO_WARNINGS
#include <ctype.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <limits.h>

#define STBI_ONLY_PNG
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#ifdef _OPENMP
#include <omp.h>
#endif
#ifndef _WIN32
#include <pthread.h>
#endif

typedef struct { uint8_t *data; size_t first, last; uint64_t seed; } Job;

static uint64_t mix(uint64_t *s) {
    uint64_t z = (*s += UINT64_C(0x9e3779b97f4a7c15));
    z = (z ^ (z >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)) * UINT64_C(0x94d049bb133111eb);
    return z ^ (z >> 31);
}

static void block(uint8_t *p, size_t n, uint64_t seed, size_t index) {
    uint64_t state = seed ^ ((uint64_t)index * UINT64_C(0x9e3779b97f4a7c15));
    uint32_t a[2][2], a2[2][2], k[4][4] = {{0}};
    uint8_t v[4] = {0};
    size_t i, j, t;
    for (i = 0; i < n; ++i) v[i] = p[i];
    if (n == 1) { p[0] = (uint8_t)(0u - v[0]); return; }
    if (n == 2 || n == 3) {
        uint32_t x = (uint8_t)mix(&state);
        p[0] = (uint8_t)(x * v[0] + (1u - x * x) * v[1]);
        p[1] = (uint8_t)(v[0] - x * v[1]);
        if (n == 3) p[2] = (uint8_t)(0u - v[2]);
        return;
    }
    for (i = 0; i < 2; ++i)
        for (j = 0; j < 2; ++j) a[i][j] = (uint8_t)mix(&state);
    for (i = 0; i < 2; ++i) for (j = 0; j < 2; ++j) {
        a2[i][j] = a[i][0] * a[0][j] + a[i][1] * a[1][j];
        k[i][j] = a[i][j];
        k[i][j + 2] = (uint8_t)((i == j) - a2[i][j]);
        k[i + 2][j] = (i == j);
        k[i + 2][j + 2] = (uint8_t)(0u - a[i][j]);
    }
    for (i = 0; i < 4; ++i) {
        uint32_t sum = 0;
        for (t = 0; t < 4; ++t) sum += k[i][t] * v[t];
        p[i] = (uint8_t)sum;
    }
}

static void run(Job *j, size_t bytes) {
    size_t b;
    for (b = j->first; b < j->last; ++b) {
        size_t off = b * 4, n = bytes - off;
        block(j->data + off, n < 4 ? n : 4, j->seed, b);
    }
}

#ifndef _WIN32
typedef struct { Job job; size_t bytes; } ThreadJob;
static void *worker(void *arg) {
    ThreadJob *t = arg;
    run(&t->job, t->bytes);
    return NULL;
}
#endif

static int token(FILE *f, char *s, size_t cap) {
    int c; size_t n = 0;
    do {
        c = fgetc(f);
        if (c == '#') while (c != '\n' && c != EOF) c = fgetc(f);
    } while (c != EOF && isspace((unsigned char)c));
    if (c == EOF) return 0;
    do {
        if (n + 1 >= cap) return 0;
        s[n++] = (char)c;
        c = fgetc(f);
    } while (c != EOF && !isspace((unsigned char)c));
    if (c == '\r') { c = fgetc(f); if (c != '\n' && c != EOF) ungetc(c, f); }
    s[n] = 0;
    return 1;
}

static int number(const char *s, uint64_t *v) {
    char *end;
    errno = 0;
    *v = strtoull(s, &end, 10);
    return s[0] != '-' && s[0] && !*end && !errno;
}

static int png_name(const char *path) {
    size_t n = strlen(path);
    return n >= 4 && path[n - 4] == '.' &&
           tolower((unsigned char)path[n - 3]) == 'p' &&
           tolower((unsigned char)path[n - 2]) == 'n' &&
           tolower((unsigned char)path[n - 1]) == 'g';
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

static int ask(const char *question, char *value, size_t cap) {
    size_t len;
    for (;;) {
        fputs(question, stdout);
        fflush(stdout);
        if (!fgets(value, (int)cap, stdin)) return 0;
        len = strcspn(value, "\r\n");
        if (value[len] == 0) {
            int c = getchar();
            if (c != EOF) {
                while (c != '\n' && c != EOF) c = getchar();
                puts("Entrada muito longa. Tente novamente.");
                continue;
            }
        }
        value[len] = 0;
        while (len && isspace((unsigned char)value[len - 1])) value[--len] = 0;
        if (len >= 2 && value[0] == '"' && value[len - 1] == '"') {
            memmove(value, value + 1, len - 2);
            value[len - 2] = 0;
        }
        if (value[0]) return 1;
        puts("Digite um valor.");
    }
}

int main(int argc, char **argv) {
    FILE *in = NULL, *out = NULL;
    uint8_t *data = NULL;
    void (*release_data)(void *) = free;
    unsigned char signature[8];
    const unsigned char png_signature[8] = {137, 80, 78, 71, 13, 10, 26, 10};
    char s[64];
    uint64_t parsed, seed;
    size_t width, height, bytes, blocks;
    int channels, threads, ok = 0;
    double start, elapsed;
    Job whole;
    char choice[16], thread_text[32], seed_text[32], input_path[1024], output_path[1024];
    char *interactive_args[6];
    int interactive = argc == 1;
    int decrypt = 0;
    if (interactive) {
        const char *mode;
        uint64_t value;
        FILE *probe;
        int found;
        puts("Cifra de Hill para imagens PNG / PGM P5 / PPM P6 (8 bits)");
        puts("A mesma operacao serve para cifrar e decifrar.\n");
        do {
            if (!ask("Operacao [1=cifrar, 2=decifrar]: ", choice, sizeof choice)) return 1;
            if (strcmp(choice, "1") && strcmp(choice, "2")) puts("Escolha 1 ou 2.");
        } while (strcmp(choice, "1") && strcmp(choice, "2"));
        decrypt = !strcmp(choice, "2");
        puts("Modos: 1=sequencial"
#ifdef _OPENMP
             ", 2=OpenMP"
#endif
#ifndef _WIN32
             ", 3=Pthreads"
#endif
        );
        do {
            if (!ask("Escolha o modo: ", choice, sizeof choice)) return 1;
            mode = !strcmp(choice, "1") ? "seq" :
#ifdef _OPENMP
                   !strcmp(choice, "2") ? "omp" :
#endif
#ifndef _WIN32
                   !strcmp(choice, "3") ? "pthread" :
#endif
                   NULL;
            if (!mode) puts("Escolha uma das opcoes mostradas.");
        } while (!mode);
        if (!strcmp(mode, "seq")) strcpy(thread_text, "1");
        else do {
            if (!ask("Numero de threads: ", thread_text, sizeof thread_text)) return 1;
            if (number(thread_text, &value) && value >= 1 && value <= INT_MAX) break;
            puts("Digite um inteiro positivo.");
        } while (1);
        do {
            if (!ask("Semente decimal (use a mesma na volta): ", seed_text, sizeof seed_text)) return 1;
            if (number(seed_text, &value)) break;
            puts("Digite um inteiro decimal de 0 a 18446744073709551615.");
        } while (1);
        do {
            if (!ask("Caminho da imagem de entrada (.png/.pgm/.ppm): ", input_path, sizeof input_path)) return 1;
            probe = fopen(input_path, "rb");
            found = probe != NULL;
            if (probe) fclose(probe);
            else puts("Arquivo nao encontrado. Tente novamente.");
        } while (!found);
        do {
            if (!ask("Caminho da imagem de saida (.png/.pgm/.ppm): ", output_path, sizeof output_path)) return 1;
            if (!strcmp(input_path, output_path)) puts("Use outro nome para preservar a entrada.");
        } while (!strcmp(input_path, output_path));
        interactive_args[0] = argv[0]; interactive_args[1] = (char *)mode;
        interactive_args[2] = thread_text; interactive_args[3] = seed_text;
        interactive_args[4] = input_path; interactive_args[5] = output_path;
        argv = interactive_args;
        argc = 6;
        puts(decrypt ? "\nDecifrando..." : "\nCifrando...");
    }
    if (argc != 6 || (strcmp(argv[1], "seq") && strcmp(argv[1], "omp") && strcmp(argv[1], "pthread")) ||
        !number(argv[2], &parsed) || parsed < 1 || parsed > INT_MAX) {
        fprintf(stderr, "uso: %s <seq|omp|pthread> <threads> <seed> <entrada.png/pgm/ppm> <saida.png/pgm/ppm>\nsem argumentos: menu interativo\n", argv[0]);
        return 1;
    }
    threads = (int)parsed;
    if (!number(argv[3], &seed) || !(in = fopen(argv[4], "rb"))) goto done;
    if (fread(signature, 1, sizeof signature, in) == sizeof signature &&
        !memcmp(signature, png_signature, sizeof signature)) {
        int w, h;
        fclose(in); in = NULL;
        if (stbi_is_16_bit(argv[4]) || !(data = stbi_load(argv[4], &w, &h, &channels, 0))) goto done;
        release_data = stbi_image_free;
        if (w < 1 || h < 1 || channels < 1 || channels > 4) goto done;
        width = (size_t)w; height = (size_t)h;
    } else {
        rewind(in);
        if (!token(in, s, sizeof s) || (strcmp(s, "P5") && strcmp(s, "P6"))) goto done;
        channels = s[1] == '6' ? 3 : 1;
        if (!token(in, s, sizeof s) || !number(s, &parsed) || !parsed || parsed > SIZE_MAX) goto done;
        width = (size_t)parsed;
        if (!token(in, s, sizeof s) || !number(s, &parsed) || !parsed || parsed > SIZE_MAX) goto done;
        height = (size_t)parsed;
        if (!token(in, s, sizeof s) || strcmp(s, "255")) goto done;
    }
    if (width > SIZE_MAX / height / (size_t)channels) goto done;
    bytes = width * height * (size_t)channels;
    blocks = bytes / 4 + (bytes % 4 != 0);
    if (blocks > LLONG_MAX) goto done;
    if (in) {
        if (!(data = malloc(bytes)) || fread(data, 1, bytes, in) != bytes || fgetc(in) != EOF) goto done;
        fclose(in); in = NULL;
    }
    whole = (Job){data, 0, blocks, seed};
    start = now();
    if (!strcmp(argv[1], "seq")) run(&whole, bytes);
    else if (!strcmp(argv[1], "omp")) {
#ifdef _OPENMP
        long long b;
        #pragma omp parallel for schedule(static) num_threads(threads)
        for (b = 0; b < (long long)blocks; ++b) {
            size_t off = (size_t)b * 4, n = bytes - off;
            block(data + off, n < 4 ? n : 4, seed, (size_t)b);
        }
#else
        fprintf(stderr, "OpenMP indisponivel nesta compilacao\n"); goto done;
#endif
    } else {
#ifndef _WIN32
        pthread_t *ids;
        ThreadJob *jobs;
        size_t i;
        int created = 0;
        if ((size_t)threads > blocks) threads = (int)blocks;
        ids = calloc((size_t)threads, sizeof *ids);
        jobs = calloc((size_t)threads, sizeof *jobs);
        if (!ids || !jobs) { free(ids); free(jobs); goto done; }
        for (i = 0; i < (size_t)threads; ++i) {
            jobs[i] = (ThreadJob){{data, blocks * i / threads, blocks * (i + 1) / threads, seed}, bytes};
            if (pthread_create(&ids[i], NULL, worker, &jobs[i])) break;
            ++created;
        }
        for (int t = 0; t < created; ++t) pthread_join(ids[t], NULL);
        free(ids); free(jobs);
        if (created != threads) { fprintf(stderr, "Falha ao criar threads\n"); goto done; }
#else
        fprintf(stderr, "Pthreads requer ambiente POSIX\n"); goto done;
#endif
    }
    elapsed = now() - start;
    if (png_name(argv[5])) {
        if (width > INT_MAX / (size_t)channels || height > INT_MAX ||
            !stbi_write_png(argv[5], (int)width, (int)height, channels, data, (int)(width * (size_t)channels))) goto done;
    } else {
        if (channels != 1 && channels != 3) goto done;
        if (!(out = fopen(argv[5], "wb"))) goto done;
        if (fprintf(out, "P%d\n%zu %zu\n255\n", channels == 3 ? 6 : 5, width, height) < 0 ||
            fwrite(data, 1, bytes, out) != bytes) goto done;
        if (fclose(out)) { out = NULL; goto done; }
        out = NULL;
    }
    printf("modo=%s threads=%d bytes=%zu tempo_transformacao=%.6f s\n", argv[1], threads, bytes, elapsed);
    if (interactive) printf("Imagem %s salva em: %s\n", decrypt ? "decifrada" : "cifrada", argv[5]);
    ok = 1;
done:
    if (!ok) fprintf(stderr, "Erro: imagem PNG/PGM/PPM invalida, saida incompativel, E/S falhou ou modo indisponivel\n");
    if (in) fclose(in);
    if (out) fclose(out);
    release_data(data);
    return !ok;
}
