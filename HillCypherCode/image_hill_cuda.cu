#include <cuda_runtime.h>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <iostream>
#include <iterator>
#include <chrono>
#include <iomanip>
#include <new>
#include <string>
#include <vector>

__device__ static uint64_t mix(uint64_t *state) {
    uint64_t value = (*state += UINT64_C(0x9e3779b97f4a7c15));
    value = (value ^ (value >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

__device__ static void transform_block(uint8_t *bytes, size_t count, uint64_t seed,
                                       uint64_t index) {
    uint64_t state = seed ^ (index * UINT64_C(0x9e3779b97f4a7c15));
    uint8_t input[4] = {0, 0, 0, 0};
    for (size_t i = 0; i < count; ++i) input[i] = bytes[i];

    if (count == 1) {
        bytes[0] = static_cast<uint8_t>(0u - input[0]);
        return;
    }
    if (count == 2 || count == 3) {
        uint32_t x = static_cast<uint8_t>(mix(&state));
        bytes[0] = static_cast<uint8_t>(x * input[0] + (1u - x * x) * input[1]);
        bytes[1] = static_cast<uint8_t>(input[0] - x * input[1]);
        if (count == 3) bytes[2] = static_cast<uint8_t>(0u - input[2]);
        return;
    }

    uint32_t a[2][2];
    uint32_t a2[2][2];
    uint32_t key[4][4] = {{0}};
    for (size_t row = 0; row < 2; ++row)
        for (size_t col = 0; col < 2; ++col)
            a[row][col] = static_cast<uint8_t>(mix(&state));

    for (size_t row = 0; row < 2; ++row) {
        for (size_t col = 0; col < 2; ++col) {
            a2[row][col] = a[row][0] * a[0][col] + a[row][1] * a[1][col];
            key[row][col] = a[row][col];
            key[row][col + 2] = static_cast<uint8_t>((row == col) - a2[row][col]);
            key[row + 2][col] = row == col;
            key[row + 2][col + 2] = static_cast<uint8_t>(0u - a[row][col]);
        }
    }
    for (size_t row = 0; row < 4; ++row) {
        uint32_t sum = 0;
        for (size_t col = 0; col < 4; ++col) sum += key[row][col] * input[col];
        bytes[row] = static_cast<uint8_t>(sum);
    }
}

__global__ static void transform_kernel(uint8_t *device_bytes, size_t total_bytes,
                                        uint64_t first_block, uint64_t seed,
                                        size_t block_count) {
    size_t local_block = static_cast<size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (local_block >= block_count) return;
    size_t offset = local_block * 4;
    size_t remaining = total_bytes - offset;
    size_t count = remaining < 4 ? remaining : 4;
    transform_block(device_bytes + offset, count, seed, first_block + local_block);
}

static bool cuda_ok(cudaError_t status, const char *operation) {
    if (status == cudaSuccess) return true;
    std::cerr << operation << ": " << cudaGetErrorString(status) << '\n';
    return false;
}

static int report_device() {
    int device = 0;
    cudaDeviceProp properties{};
    size_t free_bytes = 0, total_bytes = 0;
    if (!cuda_ok(cudaGetDevice(&device), "cudaGetDevice") ||
        !cuda_ok(cudaGetDeviceProperties(&properties, device), "cudaGetDeviceProperties") ||
        !cuda_ok(cudaMemGetInfo(&free_bytes, &total_bytes), "cudaMemGetInfo")) return 1;
    std::cout << "{\"name\":\"" << properties.name << "\",\"total_bytes\":"
              << total_bytes << ",\"free_bytes\":" << free_bytes << "}\n";
    return 0;
}

static bool allocate_device_buffer(size_t requested_bytes, unsigned long percent,
                                   uint8_t **device_bytes, size_t *free_bytes,
                                   size_t *batch_capacity) {
    size_t total_bytes = 0;
    if (!cuda_ok(cudaMemGetInfo(free_bytes, &total_bytes), "cudaMemGetInfo")) return false;
    size_t budget = *free_bytes * percent / 100;
    *batch_capacity = std::min(requested_bytes, budget);
    if (*batch_capacity >= 4) *batch_capacity = (*batch_capacity / 4) * 4;
    if (!*batch_capacity) {
        std::cerr << "not enough free GPU memory for one block\n";
        return false;
    }
    while (!cuda_ok(cudaMalloc(device_bytes, *batch_capacity), "cudaMalloc")) {
        cudaGetLastError();
        *batch_capacity = *batch_capacity > 4 ? ((*batch_capacity / 2) / 4) * 4 : 0;
        if (!*batch_capacity) return false;
    }
    return true;
}

static bool transform_data(uint8_t *bytes, size_t total_bytes, uint64_t first_block,
                           uint64_t seed, uint8_t *device_bytes, size_t batch_capacity) {
    for (size_t first_byte = 0; first_byte < total_bytes;) {
        size_t count = std::min(batch_capacity, total_bytes - first_byte);
        size_t block_count = (count + 3) / 4;
        if (!cuda_ok(cudaMemcpy(device_bytes, bytes + first_byte, count,
                                cudaMemcpyHostToDevice), "copy to GPU")) return false;
        transform_kernel<<<static_cast<unsigned>((block_count + 255) / 256), 256>>>(
            device_bytes, count, first_block + first_byte / 4, seed, block_count);
        if (!cuda_ok(cudaGetLastError(), "launch kernel") ||
            !cuda_ok(cudaDeviceSynchronize(), "run kernel") ||
            !cuda_ok(cudaMemcpy(bytes + first_byte, device_bytes, count,
                                cudaMemcpyDeviceToHost), "copy from GPU")) return false;
        first_byte += count;
    }
    return true;
}

static bool parse_u64(const char *text, uint64_t *value) {
    char *end = nullptr;
    *value = strtoull(text, &end, 10);
    return end && end != text && !*end;
}

static bool parse_percent(const char *text, unsigned long *percent) {
    char *end = nullptr;
    *percent = strtoul(text, &end, 10);
    return end && end != text && !*end && *percent >= 10 && *percent <= 80;
}

static int run_image(uint64_t seed, unsigned long percent) {
    std::vector<uint8_t> bytes;
    for (std::istreambuf_iterator<char> it(std::cin), last; it != last; ++it)
        bytes.push_back(static_cast<uint8_t>(*it));
    if (std::cin.bad()) { std::cerr << "failed to read input\n"; return 1; }
    if (bytes.empty()) return 0;

    uint8_t *device_bytes = nullptr;
    size_t free_bytes = 0, batch_capacity = 0;
    if (!allocate_device_buffer(bytes.size(), percent, &device_bytes, &free_bytes, &batch_capacity)) return 1;
    bool ok = transform_data(bytes.data(), bytes.size(), 0, seed, device_bytes, batch_capacity);
    cudaFree(device_bytes);
    if (!ok) return 1;
    std::cerr << "GPU_META " << free_bytes << ' ' << batch_capacity << '\n';
    std::cout.write(reinterpret_cast<const char *>(bytes.data()),
                    static_cast<std::streamsize>(bytes.size()));
    return std::cout ? 0 : 1;
}

static int run_video_stream(uint64_t seed, unsigned long percent, size_t frame_bytes) {
    if (!frame_bytes) { std::cerr << "frame size must be positive\n"; return 2; }
    uint8_t *device_bytes = nullptr;
    size_t free_bytes = 0, batch_capacity = 0;
    if (!allocate_device_buffer(frame_bytes, percent, &device_bytes, &free_bytes, &batch_capacity)) return 1;

    std::vector<uint8_t> frame;
    try { frame.resize(frame_bytes); }
    catch (const std::bad_alloc &) {
        cudaFree(device_bytes);
        std::cerr << "not enough host memory for one video frame\n";
        return 1;
    }
    const uint64_t blocks_per_frame = frame_bytes / 4 + (frame_bytes % 4 != 0);
    uint64_t frames = 0;
    double read_seconds = 0;
    double transform_seconds = 0;
    double write_seconds = 0;
    for (;;) {
        auto read_start = std::chrono::steady_clock::now();
        std::cin.read(reinterpret_cast<char *>(frame.data()), static_cast<std::streamsize>(frame_bytes));
        std::streamsize received = std::cin.gcount();
        if (received == 0 && std::cin.eof()) break;
        if (received != static_cast<std::streamsize>(frame_bytes)) {
            cudaFree(device_bytes);
            std::cerr << "truncated raw video frame\n";
            return 1;
        }
        read_seconds += std::chrono::duration<double>(std::chrono::steady_clock::now() - read_start).count();
        auto start = std::chrono::steady_clock::now();
        bool ok = frames <= UINT64_MAX / blocks_per_frame &&
                  transform_data(frame.data(), frame_bytes, frames * blocks_per_frame,
                                 seed, device_bytes, batch_capacity);
        transform_seconds += std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
        if (!ok) {
            cudaFree(device_bytes);
            if (frames > UINT64_MAX / blocks_per_frame) std::cerr << "video block index overflow\n";
            return 1;
        }
                auto write_start = std::chrono::steady_clock::now();
        std::cout.write(reinterpret_cast<const char *>(frame.data()),
                        static_cast<std::streamsize>(frame_bytes));
        std::cout.flush();
        if (!std::cout) { cudaFree(device_bytes); return 1; }
                write_seconds += std::chrono::duration<double>(std::chrono::steady_clock::now() - write_start).count();
        ++frames;
    }
    cudaFree(device_bytes);
    std::cerr << "GPU_STREAM_META " << free_bytes << ' ' << batch_capacity << ' '
                            << frames << ' ' << std::fixed << std::setprecision(6) << read_seconds << ' '
                            << transform_seconds << ' ' << write_seconds << '\n';
    return 0;
}

int main(int argc, char **argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    if (argc == 2 && strcmp(argv[1], "--info") == 0) return report_device();
    bool video_stream = argc == 5 && strcmp(argv[1], "--stream") == 0;
    if ((!video_stream && argc != 3) || (argc == 5 && !video_stream)) {
        std::cerr << "usage: image_hill_cuda <seed> <free-memory-percent> | --stream <seed> <free-memory-percent> <frame-bytes>\n";
        return 2;
    }

    uint64_t seed = 0;
    unsigned long percent = 0;
    int seed_index = video_stream ? 2 : 1;
    int percent_index = video_stream ? 3 : 2;
    if (!parse_u64(argv[seed_index], &seed)) {
        std::cerr << "invalid seed\n";
        return 2;
    }
    if (!parse_percent(argv[percent_index], &percent)) {
        std::cerr << "memory percent must be between 10 and 80\n";
        return 2;
    }
    if (video_stream) {
        uint64_t parsed_frame_bytes = 0;
        if (!parse_u64(argv[4], &parsed_frame_bytes) || parsed_frame_bytes > SIZE_MAX)
            return 2;
        return run_video_stream(seed, percent, static_cast<size_t>(parsed_frame_bytes));
    }
    return run_image(seed, percent);
}