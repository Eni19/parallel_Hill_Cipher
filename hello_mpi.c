#include <mpi.h>
#include <stdio.h>

int main(int argc, char **argv) {

    MPI_Init(&argc, &argv);

    int rank, size;

    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);

    printf("Ola! Processo %d de %d processos.\n", rank, size);

    MPI_Finalize();

    return 0;
}