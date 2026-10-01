/* Nucleo da cifra de Hill auto-invertivel, com a mesma aritmetica de image_hill.c.
 * block() multiplica os n bytes de p (n = 1..4) pela matriz K derivada de (seed, index),
 * com K^2 = I (mod 256): aplicar duas vezes devolve o original.
 */
#ifndef HILL_BLOCK_H
#define HILL_BLOCK_H

#include <stddef.h>
#include <stdint.h>

static uint64_t mix(uint64_t *s) {
    uint64_t z = (*s += UINT64_C(0x9e3779b97f4a7c15));
    z = (z ^ (z >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)) * UINT64_C(0x94d049bb133111eb);
    return z ^ (z >> 31);
}

static void block(uint8_t *p, size_t n, uint64_t seed, uint64_t index) {
    uint64_t state = seed ^ (index * UINT64_C(0x9e3779b97f4a7c15));
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

#endif
