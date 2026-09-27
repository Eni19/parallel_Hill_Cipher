#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#define MOD 26
#define RANDOM_SEED 12345U

typedef struct {
    int rows;
    int cols;
    int **v;
} Matrix;

static void matrix_init(Matrix *m)
{
    m->rows = 0;
    m->cols = 0;
    m->v = NULL;
}

static void matrix_free(Matrix *m)
{
    if (m->v != NULL) {
        for (int i = 0; i < m->rows; ++i)
            free(m->v[i]);
        free(m->v);
    }
    matrix_init(m);
}

static int matrix_create(Matrix *m, int rows, int cols)
{
    matrix_free(m);

    if (rows <= 0 || cols <= 0)
        return 0;

    m->v = malloc((size_t)rows * sizeof(int *));
    if (m->v == NULL)
        return 0;

    for (int i = 0; i < rows; ++i) {
        m->v[i] = calloc((size_t)cols, sizeof(int));

        if (m->v[i] == NULL) {
            m->rows = rows;
            m->cols = cols;
            matrix_free(m);
            return 0;
        }
    }

    m->rows = rows;
    m->cols = cols;
    return 1;
}

static void matrix_print(const Matrix *m)
{
    printf("Matrix: %dX%d\n", m->rows, m->cols);

    for (int i = 0; i < m->rows; ++i) {
        for (int j = 0; j < m->cols; ++j)
            printf("%d ", m->v[i][j]);
        printf("\n");
    }
}

static int mod26(int x)
{
    x %= MOD;

    if (x < 0)
        x += MOD;

    return x;
}

static int gcd_int(int a, int b)
{
    a = abs(a);
    b = abs(b);

    while (b != 0) {
        int t = a % b;
        a = b;
        b = t;
    }

    return a;
}

static int mod_inverse(int a)
{
    a = mod26(a);

    for (int x = 1; x < MOD; ++x) {
        if ((a * x) % MOD == 1)
            return x;
    }

    return -1;
}

static long long determinant(const Matrix *m);

static int generate_random_key(Matrix *key, int n)
{
    if (!matrix_create(key, n, n))
        return 0;

    srand(RANDOM_SEED);

    do {
        for (int i = 0; i < n; ++i) {
            for (int j = 0; j < n; ++j)
                key->v[i][j] = rand() % MOD;
        }
    } while (gcd_int(mod26((int)(determinant(key) % MOD)), MOD) != 1);

    return 1;
}

static int matrix_multiply(const Matrix *a, const Matrix *b, Matrix *result)
{
    if (a->cols != b->rows)
        return 0;

    Matrix temp;
    matrix_init(&temp);

    if (!matrix_create(&temp, a->rows, b->cols))
        return 0;

    for (int i = 0; i < a->rows; ++i) {
        for (int j = 0; j < b->cols; ++j) {
            int sum = 0;

            for (int k = 0; k < a->cols; ++k)
                sum += a->v[i][k] * b->v[k][j];

            temp.v[i][j] = mod26(sum);
        }
    }

    matrix_free(result);
    *result = temp;

    return 1;
}

static int matrix_minor(const Matrix *m, int skip_row, int skip_col,
                        Matrix *minor)
{
    if (m->rows != m->cols || m->rows < 2)
        return 0;

    int n = m->rows;

    if (!matrix_create(minor, n - 1, n - 1))
        return 0;

    int r2 = 0;

    for (int r = 0; r < n; ++r) {
        if (r == skip_row)
            continue;

        int c2 = 0;

        for (int c = 0; c < n; ++c) {
            if (c == skip_col)
                continue;

            minor->v[r2][c2] = m->v[r][c];
            ++c2;
        }

        ++r2;
    }

    return 1;
}

static long long determinant(const Matrix *m)
{
    if (m->rows != m->cols || m->rows == 0)
        return 0;

    if (m->rows == 1)
        return m->v[0][0];

    if (m->rows == 2)
        return (long long)m->v[0][0] * m->v[1][1]
             - (long long)m->v[0][1] * m->v[1][0];

    long long det = 0;

    for (int c = 0; c < m->cols; ++c) {
        Matrix minor;
        matrix_init(&minor);

        if (!matrix_minor(m, 0, c, &minor))
            return 0;

        long long term = (long long)m->v[0][c] * determinant(&minor);

        if (c % 2 == 0)
            det += term;
        else
            det -= term;

        matrix_free(&minor);
    }

    return det;
}

static int matrix_inverse_mod26(const Matrix *key, Matrix *inverse)
{
    if (key->rows != key->cols || key->rows < 2)
        return 0;

    int n = key->rows;
    long long det = determinant(key);
    int det_mod = mod26((int)(det % MOD));

    if (gcd_int(det_mod, MOD) != 1)
        return 0;

    int det_inv = mod_inverse(det_mod);

    if (det_inv < 0)
        return 0;

    Matrix adj;
    matrix_init(&adj);

    if (!matrix_create(&adj, n, n))
        return 0;

    /* adj(A) = transpose(cofactor(A)) */
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            Matrix minor;
            matrix_init(&minor);

            if (!matrix_minor(key, i, j, &minor)) {
                matrix_free(&adj);
                return 0;
            }

            long long minor_det = determinant(&minor);

            int cofactor = ((i + j) % 2 == 0)
                         ? (int)minor_det
                         : (int)-minor_det;

            adj.v[j][i] = mod26(cofactor);

            matrix_free(&minor);
        }
    }

    Matrix temp;
    matrix_init(&temp);

    if (!matrix_create(&temp, n, n)) {
        matrix_free(&adj);
        return 0;
    }

    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j)
            temp.v[i][j] = mod26(det_inv * adj.v[i][j]);
    }

    matrix_free(&adj);
    matrix_free(inverse);
    *inverse = temp;

    return 1;
}

static int hill_transform(const Matrix *key, const char *input,
                          char *output, size_t length)
{
    int n = key->rows;

    if (key->rows != key->cols || n < 2)
        return 0;

    if (length % (size_t)n != 0)
        return 0;

    Matrix block;
    Matrix result;
    matrix_init(&block);
    matrix_init(&result);

    if (!matrix_create(&block, n, 1))
        return 0;

    for (size_t pos = 0; pos < length; pos += (size_t)n) {

        for (int i = 0; i < n; ++i)
            block.v[i][0] = input[pos + (size_t)i] - 'A';

        if (!matrix_multiply(key, &block, &result)) {
            matrix_free(&block);
            matrix_free(&result);
            return 0;
        }

        for (int i = 0; i < n; ++i)
            output[pos + (size_t)i] =
                (char)('A' + result.v[i][0]);
    }

    output[length] = '\0';

    matrix_free(&block);
    matrix_free(&result);

    return 1;
}

/*
 * Reads the entire text file into memory.
 *
 * Only letters and whitespace are accepted. Whitespace is converted
 * to X for the Hill calculation. The whitespace mask is used to
 * reconstruct the decrypted text.
 */
static int read_text_file(const char *filename,
                          char **text,
                          unsigned char **space_mask,
                          size_t *length)
{
    FILE *file = fopen(filename, "rb");

    if (file == NULL) {
        perror("Error opening input file");
        return 0;
    }

    size_t capacity = 1024;
    size_t used = 0;

    char *buffer = malloc(capacity);

    if (buffer == NULL) {
        fclose(file);
        return 0;
    }

    int c;

    while ((c = fgetc(file)) != EOF) {
        if (used + 1 >= capacity) {
            size_t new_capacity = capacity * 2;
            char *tmp = realloc(buffer, new_capacity);

            if (tmp == NULL) {
                free(buffer);
                fclose(file);
                return 0;
            }

            buffer = tmp;
            capacity = new_capacity;
        }

        buffer[used++] = (char)c;
    }

    fclose(file);

    while (used > 0 &&
           (buffer[used - 1] == '\n' || buffer[used - 1] == '\r')) {
        --used;
    }

    if (used == 0) {
        free(buffer);
        fprintf(stderr, "Error: input file is empty.\n");
        return 0;
    }

    unsigned char *mask = calloc(used, sizeof(unsigned char));

    if (mask == NULL) {
        free(buffer);
        return 0;
    }

    for (size_t i = 0; i < used; ++i) {
        unsigned char ch = (unsigned char)buffer[i];

        if (isspace(ch)) {
            mask[i] = 1;
            buffer[i] = 'X';
        } else if (isalpha(ch)) {
            buffer[i] = (char)toupper(ch);
        } else {
            fprintf(stderr,
                    "Error: input contains unsupported character "
                    "at position %zu.\n", i);

            free(buffer);
            free(mask);
            return 0;
        }
    }

    *text = buffer;
    *space_mask = mask;
    *length = used;

    return 1;
}

static int write_text_file(const char *filename,
                           const char *text,
                           size_t length)
{
    FILE *file = fopen(filename, "wb");

    if (file == NULL) {
        perror("Error creating output file");
        return 0;
    }

    if (fwrite(text, 1, length, file) != length) {
        fclose(file);
        return 0;
    }

    fclose(file);
    return 1;
}

int main(int argc, char *argv[])
{
    Matrix key;
    Matrix inverse;
    matrix_init(&key);
    matrix_init(&inverse);

    int n;

    printf("Enter n for a nXn matrix for encryption key: ");

    if (scanf("%d", &n) != 1 || n < 2) {
        fprintf(stderr, "Invalid matrix size.\n");
        return EXIT_FAILURE;
    }

    if (n > 10) {
        fprintf(stderr,
                "Warning: n=%d may make key inversion very expensive.\n",
                n);
    }

    if (!generate_random_key(&key, n)) {
        fprintf(stderr, "Memory allocation error.\n");
        return EXIT_FAILURE;
    }

    if (!matrix_inverse_mod26(&key, &inverse)) {
        fprintf(stderr,
                "Internal error: generated key is not invertible.\n");
        matrix_free(&key);
        return EXIT_FAILURE;
    }

    printf("\nRandom encryption key generated automatically:\n");
    matrix_print(&key);

    printf("\nDecryption key:\n");
    matrix_print(&inverse);

    char filename[1024];

    /*
     * If a filename was supplied on the command line, use it.
     * Otherwise ask the user.
     */
    if (argc >= 2) {
        strncpy(filename, argv[1], sizeof(filename) - 1);
        filename[sizeof(filename) - 1] = '\0';
    } else {
        int ch;

        while ((ch = getchar()) != '\n' && ch != EOF)
            ;

        printf("\nEnter input .txt filename: ");

        if (fgets(filename, sizeof(filename), stdin) == NULL) {
            fprintf(stderr, "Invalid filename.\n");
            matrix_free(&key);
            matrix_free(&inverse);
            return EXIT_FAILURE;
        }

        filename[strcspn(filename, "\r\n")] = '\0';
    }

    char *input = NULL;
    unsigned char *space_mask = NULL;
    size_t original_length = 0;

    if (!read_text_file(filename, &input, &space_mask, &original_length)) {
        matrix_free(&key);
        matrix_free(&inverse);
        return EXIT_FAILURE;
    }

    /*
     * Pad with X until the number of characters is divisible by n.
     */
    size_t padding = (size_t)n - (original_length % (size_t)n);

    if (padding == (size_t)n)
        padding = 0;

    size_t padded_length = original_length + padding;

    char *padded_input = realloc(input, padded_length + 1);

    if (padded_input == NULL) {
        fprintf(stderr, "Memory allocation error.\n");
        free(input);
        free(space_mask);
        matrix_free(&key);
        matrix_free(&inverse);
        return EXIT_FAILURE;
    }

    input = padded_input;

    for (size_t i = original_length; i < padded_length; ++i)
        input[i] = 'X';

    input[padded_length] = '\0';

    char *encrypted = malloc(padded_length + 1);
    char *decrypted = malloc(padded_length + 1);

    if (encrypted == NULL || decrypted == NULL) {
        fprintf(stderr, "Memory allocation error.\n");
        free(input);
        free(space_mask);
        free(encrypted);
        free(decrypted);
        matrix_free(&key);
        matrix_free(&inverse);
        return EXIT_FAILURE;
    }

    printf("\nInput file: %s\n", filename);
    printf("Characters read: %zu\n", original_length);
    printf("Padding added: %zu\n", padding);

    /*
     * Measure only the encryption and decryption calculations.
     * File I/O, key generation and matrix inversion are not included
     * in these measurements.
     */
    struct timespec inicio_criptografia, fim_criptografia;
    struct timespec inicio_descriptografia, fim_descriptografia;

    timespec_get(&inicio_criptografia, TIME_UTC);

    if (!hill_transform(&key, input, encrypted, padded_length)) {
        fprintf(stderr, "Encryption error.\n");
        free(input);
        free(space_mask);
        free(encrypted);
        free(decrypted);
        matrix_free(&key);
        matrix_free(&inverse);
        return EXIT_FAILURE;
    }

    timespec_get(&fim_criptografia, TIME_UTC);

    timespec_get(&inicio_descriptografia, TIME_UTC);

    if (!hill_transform(&inverse, encrypted, decrypted, padded_length)) {
        fprintf(stderr, "Decryption error.\n");
        free(input);
        free(space_mask);
        free(encrypted);
        free(decrypted);
        matrix_free(&key);
        matrix_free(&inverse);
        return EXIT_FAILURE;
    }

    timespec_get(&fim_descriptografia, TIME_UTC);

    double tempo_criptografia =
        (double)(fim_criptografia.tv_sec - inicio_criptografia.tv_sec) +
        (double)(fim_criptografia.tv_nsec - inicio_criptografia.tv_nsec) / 1e9;

    double tempo_descriptografia =
        (double)(fim_descriptografia.tv_sec - inicio_descriptografia.tv_sec) +
        (double)(fim_descriptografia.tv_nsec - inicio_descriptografia.tv_nsec) / 1e9;

    double tempo_total = tempo_criptografia + tempo_descriptografia;

    printf("\nTempo de criptografia: %.9f segundos\n", tempo_criptografia);
    printf("Tempo de descriptografia: %.9f segundos\n", tempo_descriptografia);
    printf("Tempo total dos calculos: %.9f segundos\n", tempo_total);

    /*
     * Restore original whitespace in the decrypted text.
     * Padding characters are excluded from the restored output.
     */
    for (size_t i = 0; i < original_length; ++i) {
        if (space_mask[i])
            decrypted[i] = ' ';
    }

    decrypted[original_length] = '\0';

    /*
     * Output files are intentionally created separately so that
     * the sequential/parallel experiment can use the same input
     * and compare the encrypted result.
     */
    char encrypted_filename[1100];
    char decrypted_filename[1100];

    snprintf(encrypted_filename, sizeof(encrypted_filename),
             "%s.encrypted.txt", filename);

    snprintf(decrypted_filename, sizeof(decrypted_filename),
             "%s.decrypted.txt", filename);

    if (!write_text_file(encrypted_filename, encrypted, padded_length)) {
        fprintf(stderr, "Error writing encrypted output.\n");
    }

    if (!write_text_file(decrypted_filename, decrypted, original_length)) {
        fprintf(stderr, "Error writing decrypted output.\n");
    }

    printf("Encrypted file: %s\n", encrypted_filename);
    printf("Decrypted file: %s\n", decrypted_filename);

    /*
     * Do not print the complete text for large experiments.
     */
    size_t preview = original_length < 80 ? original_length : 80;

    printf("\nDecrypted preview: ");
    fwrite(decrypted, 1, preview, stdout);

    if (original_length > preview)
        printf("...");

    printf("\n");

    free(input);
    free(space_mask);
    free(encrypted);
    free(decrypted);

    matrix_free(&key);
    matrix_free(&inverse);

    return EXIT_SUCCESS;
}