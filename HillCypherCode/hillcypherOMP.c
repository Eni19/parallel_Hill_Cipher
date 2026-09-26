/*
 * hill_cipher_openmp.c
 *
 * Versão OpenMP baseada no hill_cipher.c fornecido.
 *
 * Principais paralelizações:
 *   1) inicialização/cópia/operações elemento a elemento em matrizes;
 *   2) multiplicação de matrizes;
 *   3) transposição;
 *   4) matriz de cofatores;
 *   5) processamento independente dos blocos de texto.
 *
 * Observação:
 * O cálculo do determinante continua recursivo e serial para evitar
 * criar regiões paralelas recursivas em cada chamada.
 */

#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <string.h>
#include <math.h>
#include <omp.h>

#define VAL(PTR) (*PTR)

typedef float** FLOAT_2D_ARR;
typedef float* FLOAT_1D_ARR;
typedef char* STRING;
typedef char** STRING_REF;

typedef struct {
    FLOAT_2D_ARR element;
    int rows, columns;
} Matrix;

typedef Matrix* MatrixRef;

/* ============================================================
 * Operações básicas de matriz
 * ============================================================ */

void Mat_set_new_matrix(MatrixRef matrix, int rows, int columns) {
    int row_iter, col_iter;

    matrix->rows = rows;
    matrix->columns = columns;

    if (rows <= 0 || columns <= 0) {
        matrix->element = NULL;
        return;
    }

    matrix->element = (FLOAT_2D_ARR)malloc(sizeof(FLOAT_1D_ARR) * rows);
    if (!matrix->element) {
        perror("malloc");
        exit(EXIT_FAILURE);
    }

    for (row_iter = 0; row_iter < rows; ++row_iter) {
        matrix->element[row_iter] =
            (FLOAT_1D_ARR)malloc(sizeof(float) * columns);

        if (!matrix->element[row_iter]) {
            perror("malloc");
            exit(EXIT_FAILURE);
        }
    }

    /* Cada posição é independente. */
    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < rows; ++row_iter) {
        for (col_iter = 0; col_iter < columns; ++col_iter) {
            matrix->element[row_iter][col_iter] = 0.0f;
        }
    }
}

void Mat_set_element(Matrix mat, int row, int column, float value) {
    if (row < 0 || row >= mat.rows || column < 0 || column >= mat.columns) {
        printf("Matrix element out of bounds error.\n");
        exit(EXIT_FAILURE);
    }

    mat.element[row][column] = value;
}

float Mat_get_element(Matrix mat, int row, int column) {
    if (row < 0 || row >= mat.rows || column < 0 || column >= mat.columns) {
        printf("Matrix element out of bounds error.\n");
        exit(EXIT_FAILURE);
    }

    return mat.element[row][column];
}

void Mat_print_matrix(Matrix mat) {
    int row_iter, col_iter;

    printf("Matrix: %dX%d\n", mat.rows, mat.columns);

    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            printf("%f ", mat.element[row_iter][col_iter]);
        }
        printf("\n");
    }
}

void Mat_delete_matrix(MatrixRef matrix) {
    int row_iter;

    if (!matrix || matrix->rows <= 0 || matrix->columns <= 0 ||
        matrix->element == NULL) {
        if (matrix) {
            matrix->rows = matrix->columns = 0;
            matrix->element = NULL;
        }
        return;
    }

    for (row_iter = 0; row_iter < matrix->rows; ++row_iter) {
        free(matrix->element[row_iter]);
    }

    free(matrix->element);
    matrix->element = NULL;
    matrix->rows = matrix->columns = 0;
}

/* ============================================================
 * Multiplicação de matrizes
 * ============================================================ */

void Mat_multiply_matrix(MatrixRef result, Matrix mat1, Matrix mat2) {
    int i, j, k;

    if (mat1.columns != mat2.rows) {
        printf("Matrix multiplication error.\n");
        exit(EXIT_FAILURE);
    }

    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat1.rows, mat2.columns);

    /*
     * Cada C[i][j] é independente dos demais.
     * O k permanece dentro da thread porque a soma de um elemento
     * depende sequencialmente de seus termos.
     */
    #pragma omp parallel for collapse(2)
    for (i = 0; i < mat1.rows; ++i) {
        for (j = 0; j < mat2.columns; ++j) {
            float temp_res_element = 0.0f;

            for (k = 0; k < mat1.columns; ++k) {
                temp_res_element +=
                    mat1.element[i][k] * mat2.element[k][j];
            }

            result->element[i][j] = temp_res_element;
        }
    }
}

/* ============================================================
 * Transposição
 * ============================================================ */

void Mat_matrix_transpose(MatrixRef result, Matrix mat) {
    int row_iter, col_iter;

    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.columns, mat.rows);

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            result->element[col_iter][row_iter] =
                mat.element[row_iter][col_iter];
        }
    }
}

/* ============================================================
 * Matriz menor
 * ============================================================ */

void Mat_get_minor_matrix(MatrixRef result, Matrix mat, int row, int col) {
    int row_iter, col_iter, res_row_iter, res_col_iter;

    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.rows - 1, mat.columns - 1);

    res_row_iter = 0;

    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        if (row_iter == row)
            continue;

        res_col_iter = 0;

        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            if (col_iter == col)
                continue;

            result->element[res_row_iter][res_col_iter] =
                mat.element[row_iter][col_iter];

            ++res_col_iter;
        }

        ++res_row_iter;
    }
}

/* ============================================================
 * Determinante
 *
 * Mantido serial devido à recursão. Os termos da expansão são
 * independentes, mas paralelizar recursivamente cada chamada
 * poderia criar muitas regiões OpenMP.
 * ============================================================ */

float Mat_get_matrix_determinant(Matrix mat) {
    Matrix tempMatrix;
    int col_iter, flag;
    float determinant = 0.0f;

    if (mat.rows != mat.columns) {
        printf("Determinant requires a square matrix.\n");
        exit(EXIT_FAILURE);
    }

    if (mat.rows == 0) {
        return 1.0f;
    }

    if (mat.rows == 1) {
        return mat.element[0][0];
    }

    if (mat.rows == 2) {
        return mat.element[0][0] * mat.element[1][1] -
               mat.element[0][1] * mat.element[1][0];
    }

    Mat_set_new_matrix(&tempMatrix, 0, 0);

    for (col_iter = 0, flag = 1; col_iter < mat.columns; ++col_iter) {
        Mat_get_minor_matrix(&tempMatrix, mat, 0, col_iter);

        if (flag) {
            determinant +=
                mat.element[0][col_iter] *
                Mat_get_matrix_determinant(tempMatrix);
        } else {
            determinant -=
                mat.element[0][col_iter] *
                Mat_get_matrix_determinant(tempMatrix);
        }

        flag ^= 1;
    }

    Mat_delete_matrix(&tempMatrix);

    return determinant;
}

/* ============================================================
 * Matriz de cofatores
 * ============================================================ */

void Mat_get_cofactor_matrix(MatrixRef result, Matrix mat) {
    int row_iter, col_iter;

    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.rows, mat.columns);

    /*
     * Cada cofator C[i][j] depende apenas da matriz original
     * e do seu próprio minor. Cada thread possui seu próprio
     * Matrix local, evitando compartilhamento de temp_matrix.
     */
    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            Matrix temp_matrix;
            float determinant;
            float sign = ((row_iter + col_iter) % 2 == 0) ? 1.0f : -1.0f;

            Mat_set_new_matrix(&temp_matrix,
                               mat.rows - 1,
                               mat.columns - 1);

            Mat_get_minor_matrix(&temp_matrix, mat, row_iter, col_iter);

            determinant = Mat_get_matrix_determinant(temp_matrix);

            result->element[row_iter][col_iter] =
                sign * determinant;

            Mat_delete_matrix(&temp_matrix);
        }
    }
}

/* ============================================================
 * Operações elemento a elemento
 * ============================================================ */

void Mat_matix_mod_with_number(Matrix mat, int num) {
    int row_iter, col_iter;

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            mat.element[row_iter][col_iter] =
                (int)mat.element[row_iter][col_iter] % num;
        }
    }
}

void Mat_add_num_till_positive(Matrix mat, float num) {
    int row_iter, col_iter;

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            while (mat.element[row_iter][col_iter] < 0.0f) {
                mat.element[row_iter][col_iter] += num;
            }
        }
    }
}

void Mat_add_num_till_divisible(Matrix mat, float num, float divisor) {
    int row_iter, col_iter;

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            while ((int)mat.element[row_iter][col_iter] %
                   (int)divisor) {
                mat.element[row_iter][col_iter] += num;
            }
        }
    }
}

void Mat_multiply_by_number(Matrix mat, float num) {
    int row_iter, col_iter;

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            mat.element[row_iter][col_iter] *= num;
        }
    }
}

void Mat_divide_by_number(Matrix mat, float num) {
    int row_iter, col_iter;

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            mat.element[row_iter][col_iter] /= num;
        }
    }
}

void Mat_mod_by_number(Matrix mat, int num) {
    int row_iter, col_iter;

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            mat.element[row_iter][col_iter] =
                (int)mat.element[row_iter][col_iter] % num;
        }
    }
}

/* Protótipo necessário antes de Hill_calculate_decrypyion_key. */
void Mat_get_adjoint_matrix(MatrixRef result, Matrix mat);

/* ============================================================
 * Cifra de Hill
 * ============================================================ */

typedef struct {
    Matrix encryption_key;
    Matrix decryption_key;
} HillCipherKeys;

void Hill_init_keys(HillCipherKeys* key) {
    Mat_set_new_matrix(&key->encryption_key, 0, 0);
    Mat_set_new_matrix(&key->decryption_key, 0, 0);
}

void Hill_set_encryption_key(HillCipherKeys* key, Matrix mat) {
    int row_iter, col_iter;

    Mat_delete_matrix(&key->encryption_key);
    Mat_set_new_matrix(&key->encryption_key, mat.rows, mat.columns);

    #pragma omp parallel for collapse(2)
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            key->encryption_key.element[row_iter][col_iter] =
                mat.element[row_iter][col_iter];
        }
    }
}

void Hill_calculate_decrypyion_key(HillCipherKeys* key) {
    float determinant;

    determinant =
        (int)Mat_get_matrix_determinant(key->encryption_key) % 26;

    if (determinant == 0.0f) {
        printf("Encryption key has no inverse modulo 26.\n");
        exit(EXIT_FAILURE);
    }

    Mat_get_adjoint_matrix(&key->decryption_key,
                           key->encryption_key);

    Mat_add_num_till_divisible(key->decryption_key,
                               26,
                               determinant);

    Mat_divide_by_number(key->decryption_key, determinant);

    Mat_add_num_till_positive(key->decryption_key, 26);

    Mat_mod_by_number(key->decryption_key, 26);
}

void Mat_get_adjoint_matrix(MatrixRef result, Matrix mat) {
    Matrix temp_matrix;

    Mat_set_new_matrix(&temp_matrix, mat.rows, mat.columns);
    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.rows, mat.columns);

    Mat_get_cofactor_matrix(&temp_matrix, mat);
    Mat_matrix_transpose(result, temp_matrix);

    Mat_delete_matrix(&temp_matrix);
}

/* ============================================================
 * Criptografia / descriptografia do texto
 * ============================================================ */

void Hill_encrypt_decrypt_text(HillCipherKeys keys,
                               STRING_REF text_ref,
                               int encrypt) {
    int size = keys.encryption_key.rows;
    int max_char;
    int block_start;

    Matrix key;

    if (size <= 0) {
        printf("Invalid key size.\n");
        exit(EXIT_FAILURE);
    }

    key = encrypt ? keys.encryption_key : keys.decryption_key;

    max_char = (int)strlen(VAL(text_ref));

    /*
     * A validação e conversão são independentes por caractere.
     * Não há escrita concorrente no mesmo caractere.
     */
    #pragma omp parallel for
    for (int i = 0; i < max_char; ++i) {
        unsigned char ch = (unsigned char)VAL(text_ref)[i];

        if (!isalpha(ch)) {
            /*
             * Não fazemos exit() dentro da região paralela.
             * O resultado da validação é tratado por uma segunda
             * passagem abaixo.
             */
        }
    }

    for (int i = 0; i < max_char; ++i) {
        unsigned char ch = (unsigned char)VAL(text_ref)[i];

        if (!isalpha(ch)) {
            printf("Not a valid alphabet error.\n");
            exit(EXIT_FAILURE);
        }

        VAL(text_ref)[i] = (char)toupper(ch);
    }

    /*
     * A implementação original exige que o tamanho do texto seja
     * múltiplo do tamanho da chave. Isso evita acesso além do fim
     * do vetor no processamento dos blocos.
     */
    if (max_char % size != 0) {
        printf("Text length must be a multiple of the key size (%d).\n",
               size);
        exit(EXIT_FAILURE);
    }

    /*
     * Cada bloco é independente:
     *
     * bloco 0 -> key * bloco 0
     * bloco 1 -> key * bloco 1
     * bloco 2 -> key * bloco 2
     *
     * Cada iteração possui suas próprias matrizes locais.
     */
    #pragma omp parallel for schedule(static)
    for (block_start = 0;
         block_start < max_char;
         block_start += size) {

        Matrix char_matrix;
        Matrix result_matrix;

        Mat_set_new_matrix(&char_matrix, size, 1);
        Mat_set_new_matrix(&result_matrix, 0, 0);

        for (int row_cntr = 0; row_cntr < size; ++row_cntr) {
            char_matrix.element[row_cntr][0] =
                (float)(VAL(text_ref)[block_start + row_cntr] - 'A');
        }

        /*
         * Esta função cria apenas estruturas locais de resultado,
         * portanto diferentes threads não compartilham result_matrix.
         */
        Mat_multiply_matrix(&result_matrix, key, char_matrix);
        Mat_matix_mod_with_number(result_matrix, 26);

        for (int row_cntr = 0; row_cntr < size; ++row_cntr) {
            VAL(text_ref)[block_start + row_cntr] =
                (char)(Mat_get_element(result_matrix, row_cntr, 0) + 'A');
        }

        Mat_delete_matrix(&char_matrix);
        Mat_delete_matrix(&result_matrix);
    }
}

/* ============================================================
 * Main
 * ============================================================ */

int main(void) {
    Matrix matrix3x3;
    Matrix result;
    HillCipherKeys keys;

    int length;
    int iter_row = 0;
    int iter_col = 0;
    int mat_size = 0;
    int temp = 0;
    char *str;

    Mat_set_new_matrix(&matrix3x3, 0, 0);
    Mat_set_new_matrix(&result, 0, 0);
    Hill_init_keys(&keys);

    printf("\nEnter n for a nXn matrix for encryption key: ");
    scanf("%d", &mat_size);

    if (mat_size < 2) {
        printf("Matrix size must be at least 2.\n");
        return EXIT_FAILURE;
    }

    Mat_set_new_matrix(&matrix3x3, mat_size, mat_size);

    printf("\nEnter rows and columns of matrix with spaces:\n");

    for (iter_row = 0; iter_row < mat_size; ++iter_row) {
        for (iter_col = 0; iter_col < mat_size; ++iter_col) {
            scanf("%d", &temp);
            Mat_set_element(matrix3x3, iter_row, iter_col, (float)temp);
        }
    }

    Hill_set_encryption_key(&keys, matrix3x3);
    Hill_calculate_decrypyion_key(&keys);

    printf("\nEncryption Key:");
    Mat_print_matrix(keys.encryption_key);

    printf("\nDecryption Key:");
    Mat_print_matrix(keys.decryption_key);

    printf("\n\nEnter the length of the string: ");
    scanf("%d", &length);

    if (length <= 0) {
        printf("Invalid string length.\n");
        return EXIT_FAILURE;
    }

    str = (char*)malloc((length + 1) * sizeof(char));
    if (!str) {
        perror("malloc");
        return EXIT_FAILURE;
    }

    printf("Enter the string: ");
    scanf("%s", str);

    if ((int)strlen(str) != length) {
        printf("Warning: informed length differs from actual string length.\n");
        length = (int)strlen(str);
    }

    printf("\nUsing %d OpenMP threads.\n", omp_get_max_threads());

    printf("\nEncrypted text: ");
    Hill_encrypt_decrypt_text(keys, &str, 1);
    printf("%s\n", str);

    printf("\nDecrypted text: ");
    Hill_encrypt_decrypt_text(keys, &str, 0);
    printf("%s\n", str);

    free(str);

    Mat_delete_matrix(&matrix3x3);
    Mat_delete_matrix(&result);
    Mat_delete_matrix(&keys.encryption_key);
    Mat_delete_matrix(&keys.decryption_key);

    return EXIT_SUCCESS;
}
