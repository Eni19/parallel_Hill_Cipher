/*
 * Implementação de Referência: Cifra de Hill em C
 * Baseado no código de Tanay PrabhuDesai (https://gist.github.com/tanayseven/9491684)
 * Adaptado para a disciplina de Programação Concorrente e Distribuída (PCD) - UNIFESP
 */

#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <string.h>
#include <math.h>

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

void Mat_set_new_matrix(MatrixRef matrix, int rows, int columns) {
    int row_iter = 0, col_iter = 0;
    matrix->rows = rows;
    matrix->columns = columns;
    matrix->element = (FLOAT_2D_ARR) malloc(sizeof(FLOAT_1D_ARR) * rows);
    for (row_iter = 0; row_iter < rows; ++row_iter) {
        matrix->element[row_iter] = (FLOAT_1D_ARR) malloc(sizeof(float) * columns);
        for (col_iter = 0; col_iter < columns; ++col_iter) {
            matrix->element[row_iter][col_iter] = 0.0f;
        }
    }
}

void Mat_set_element(Matrix mat, int row, int column, float value) {
    if (row >= mat.rows || column >= mat.columns) {
        printf("Matrix element out of bounds error.\n");
        exit(EXIT_FAILURE);
    }
    mat.element[row][column] = value;
}

float Mat_get_element(Matrix mat, int row, int column) {
    if (row >= mat.rows || column >= mat.columns) {
        printf("Matrix element out of bounds error.\n");
        exit(EXIT_FAILURE);
    }
    return mat.element[row][column];
}

void Mat_print_matrix(Matrix mat) {
    int row_iter = 0, col_iter = 0;
    printf("Matrix: %dx%d\n", mat.rows, mat.columns);
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            printf("%6.1f ", mat.element[row_iter][col_iter]);
        }
        printf("\n");
    }
}

void Mat_delete_matrix(MatrixRef matrix) {
    int row_iter = 0;
    if (matrix->rows <= 0 && matrix->columns <= 0) {
        return;
    }
    for (row_iter = 0; row_iter < matrix->rows; ++row_iter) {
        free(matrix->element[row_iter]);
    }
    free(matrix->element);
    matrix->rows = matrix->columns = 0;
}

void Mat_multiply_matrix(MatrixRef result, Matrix mat1, Matrix mat2) {
    int mat1_row_iter, mat2_col_iter, mat_common_itr;
    float temp_res_element = 0;
    if (mat1.columns != mat2.rows) {
        printf("Matrix multiplication error: dimensões incompatíveis.\n");
        exit(EXIT_FAILURE);
    }
    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat1.rows, mat2.columns);
    for (mat1_row_iter = 0; mat1_row_iter < mat1.rows; ++mat1_row_iter) {
        for (mat2_col_iter = 0; mat2_col_iter < mat2.columns; ++mat2_col_iter) {
            temp_res_element = 0;
            for (mat_common_itr = 0; mat_common_itr < mat1.columns; ++mat_common_itr) {
                temp_res_element += Mat_get_element(mat1, mat1_row_iter, mat_common_itr) *
                                    Mat_get_element(mat2, mat_common_itr, mat2_col_iter);
            }
            Mat_set_element(*result, mat1_row_iter, mat2_col_iter, temp_res_element);
        }
    }
}

void Mat_matrix_transpose(MatrixRef result, Matrix mat) {
    int row_iter, col_iter;
    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.columns, mat.rows);
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            Mat_set_element(*result, col_iter, row_iter, mat.element[row_iter][col_iter]);
        }
    }
}

void Mat_get_minor_matrix(MatrixRef result, Matrix mat, int row, int col) {
    int row_iter, col_iter, res_row_iter, res_col_iter;
    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.columns - 1, mat.rows - 1);
    for (row_iter = 0, res_row_iter = 0; row_iter < mat.rows; ++row_iter) {
        if (row_iter == row) continue;
        for (col_iter = 0, res_col_iter = 0; col_iter < mat.columns; ++col_iter) {
            if (col_iter == col) continue;
            result->element[res_row_iter][res_col_iter] = mat.element[row_iter][col_iter];
            ++res_col_iter;
        }
        ++res_row_iter;
    }
}

float Mat_get_matrix_determinant(Matrix mat) {
    int row_iter, col_iter, flag;
    Matrix tempMatrix;
    Mat_set_new_matrix(&tempMatrix, 0, 0);
    if (mat.rows == 2) {
        return (mat.element[0][0] * mat.element[1][1] - mat.element[0][1] * mat.element[1][0]);
    }
    float determinant = 0;
    for (col_iter = 0, flag = 1, row_iter = 0; col_iter < mat.columns; ++col_iter) {
        Mat_get_minor_matrix(&tempMatrix, mat, row_iter, col_iter);
        if (flag)
            determinant += mat.element[row_iter][col_iter] * Mat_get_matrix_determinant(tempMatrix);
        else
            determinant -= mat.element[row_iter][col_iter] * Mat_get_matrix_determinant(tempMatrix);
        flag ^= 1;
    }
    Mat_delete_matrix(&tempMatrix);
    return determinant;
}

void Mat_get_cofactor_matrix(MatrixRef result, Matrix mat) {
    Matrix temp_matrix;
    int row_iter, col_iter, flag;
    Mat_delete_matrix(result);
    Mat_set_new_matrix(result, mat.columns, mat.rows);
    Mat_set_new_matrix(&temp_matrix, mat.columns - 1, mat.rows - 1);
    for (row_iter = 0, flag = 1; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            if (flag) {
                Mat_get_minor_matrix(&temp_matrix, mat, row_iter, col_iter);
                Mat_set_element(*result, row_iter, col_iter, Mat_get_matrix_determinant(temp_matrix));
            } else {
                Mat_get_minor_matrix(&temp_matrix, mat, row_iter, col_iter);
                Mat_set_element(*result, row_iter, col_iter, -Mat_get_matrix_determinant(temp_matrix));
            }
            flag ^= 1;
        }
    }
    Mat_delete_matrix(&temp_matrix);
}

void Mat_matix_mod_with_number(Matrix mat, int num) {
    int row_iter, col_iter;
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            int val = (int)mat.element[row_iter][col_iter] % num;
            if (val < 0) val += num;
            Mat_set_element(mat, row_iter, col_iter, val);
        }
    }
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

void Mat_add_num_till_positive(Matrix mat, float num) {
    int row_iter, col_iter;
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            while (Mat_get_element(mat, row_iter, col_iter) < 0.0)
                Mat_set_element(mat, row_iter, col_iter, Mat_get_element(mat, row_iter, col_iter) + num);
        }
    }
}

void Mat_add_num_till_divisible(Matrix mat, float num, float divisor) {
    int row_iter, col_iter;
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            while ((int)Mat_get_element(mat, row_iter, col_iter) % (int)divisor)
                Mat_set_element(mat, row_iter, col_iter, Mat_get_element(mat, row_iter, col_iter) + num);
        }
    }
}

void Mat_divide_by_number(Matrix mat, float num) {
    int row_iter, col_iter;
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            Mat_set_element(mat, row_iter, col_iter, Mat_get_element(mat, row_iter, col_iter) / num);
        }
    }
}

void Mat_mod_by_number(Matrix mat, int num) {
    int row_iter, col_iter;
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            int val = (int)Mat_get_element(mat, row_iter, col_iter) % num;
            if (val < 0) val += num;
            Mat_set_element(mat, row_iter, col_iter, val);
        }
    }
}

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
    for (row_iter = 0; row_iter < mat.rows; ++row_iter) {
        for (col_iter = 0; col_iter < mat.columns; ++col_iter) {
            Mat_set_element(key->encryption_key, row_iter, col_iter, Mat_get_element(mat, row_iter, col_iter));
        }
    }
}

void Hill_calculate_decryption_key(HillCipherKeys* key) {
    float determinant;
    determinant = (int)Mat_get_matrix_determinant(key->encryption_key) % 26;
    if (determinant < 0) determinant += 26;
    Mat_get_adjoint_matrix(&key->decryption_key, key->encryption_key);
    Mat_add_num_till_divisible(key->decryption_key, 26, determinant);
    Mat_divide_by_number(key->decryption_key, determinant);
    Mat_add_num_till_positive(key->decryption_key, 26);
    Mat_mod_by_number(key->decryption_key, 26);
}

void Hill_encrypt_decrypt_text(HillCipherKeys keys, STRING_REF text_ref, int encrypt) {
    int size = keys.encryption_key.rows;
    int cntr_char = 0, max_char = 0, row_cntr = 0;
    Matrix char_matrix;
    Matrix result_matrix;
    Matrix key;
    if (encrypt) {
        key = keys.encryption_key;
    } else {
        key = keys.decryption_key;
    }
    max_char = strlen(VAL(text_ref));
    for (cntr_char = 0; cntr_char < max_char; ++cntr_char) {
        if (!isalpha((VAL(text_ref))[cntr_char])) {
            printf("Not a valid alphabet error at pos %d: '%c'\n", cntr_char, (VAL(text_ref))[cntr_char]);
            exit(EXIT_FAILURE);
        }
        (VAL(text_ref))[cntr_char] = toupper((VAL(text_ref))[cntr_char]);
    }
    Mat_set_new_matrix(&char_matrix, size, 1);
    Mat_set_new_matrix(&result_matrix, 0, 0);
    for (cntr_char = 0; cntr_char < max_char; cntr_char += size) {
        for (row_cntr = 0; row_cntr < size; ++row_cntr) {
            Mat_set_element(char_matrix, row_cntr, 0, (VAL(text_ref))[cntr_char + row_cntr] - 'A');
        }
        Mat_multiply_matrix(&result_matrix, key, char_matrix);
        Mat_matix_mod_with_number(result_matrix, 26);
        for (row_cntr = 0; row_cntr < size; ++row_cntr) {
            (VAL(text_ref))[cntr_char + row_cntr] = (int)Mat_get_element(result_matrix, row_cntr, 0) + 'A';
        }
    }
    Mat_delete_matrix(&char_matrix);
    Mat_delete_matrix(&result_matrix);
}

int main(void) {
    Matrix matrix3x3;
    HillCipherKeys keys;
    int iter_row = 0, iter_col = 0, mat_size = 3;
    char text[] = "RETREAT";
    // Padding para múltiplo de 3
    char padded_text[16] = "RETREATXX";

    printf("=== Cifra de Hill (Referência Tanayseven) ===\n");
    Mat_set_new_matrix(&matrix3x3, mat_size, mat_size);
    // Exemplo clássico 3x3 invertível mod 26:
    // [ 6 24  1 ]
    // [13 16 10 ]
    // [20 17 15 ]
    float sample[3][3] = {
        {6, 24, 1},
        {13, 16, 10},
        {20, 17, 15}
    };
    for (iter_row = 0; iter_row < mat_size; ++iter_row) {
        for (iter_col = 0; iter_col < mat_size; ++iter_col) {
            Mat_set_element(matrix3x3, iter_row, iter_col, sample[iter_row][iter_col]);
        }
    }

    Hill_init_keys(&keys);
    Hill_set_encryption_key(&keys, matrix3x3);
    Hill_calculate_decryption_key(&keys);

    printf("\nMatriz Chave de Encriptação:\n");
    Mat_print_matrix(keys.encryption_key);

    printf("\nMatriz Chave de Decriptação:\n");
    Mat_print_matrix(keys.decryption_key);

    char *str = (char*)malloc(sizeof(char) * (strlen(padded_text) + 1));
    strcpy(str, padded_text);

    printf("\nTexto Original: %s\n", str);
    Hill_encrypt_decrypt_text(keys, &str, 1);
    printf("Texto Cifrado : %s\n", str);

    Hill_encrypt_decrypt_text(keys, &str, 0);
    printf("Texto Decifrado: %s\n", str);

    free(str);
    Mat_delete_matrix(&matrix3x3);
    Mat_delete_matrix(&keys.encryption_key);
    Mat_delete_matrix(&keys.decryption_key);
    return EXIT_SUCCESS;
}
