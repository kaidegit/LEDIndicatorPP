#include "pool.hpp"

#include <algorithm>
#include <cstring>
#include <new>
#include <stdint.h>
#include <stdlib.h>
#include <tlsf.h>

namespace {
constexpr uint32_t MAX_POOL_BYTES = 1024 * 1024;
constexpr uint32_t EXCEPTION_RESERVE_BYTES = 1024;
#if LEDIP_MEMORY_CHECK
constexpr uint32_t REDZONE_BYTES = 16;
#else
constexpr uint32_t REDZONE_BYTES = 0;
#endif
constexpr uint32_t MAGIC = 0x4c454449;
constexpr uint32_t FREED = 0xdeadbeef;
struct Header {
  uint32_t magic;
  uint32_t requested;
  uint32_t actual;
  uint32_t user_offset;
};
alignas(16) unsigned char backing[MAX_POOL_BYTES];
alignas(16) unsigned char exception_reserve[EXCEPTION_RESERVE_BYTES];
bool exception_in_use = false;
tlsf_t allocator = nullptr;
LedipMemoryStats stats{};
uint32_t configured = 0;
uint32_t fail_at = 0;
int32_t current_operation = -1;
int32_t current_operation_index = -1;

bool configure(uint32_t bytes) {
  if (stats.live_blocks != 0 || bytes > MAX_POOL_BYTES || bytes < 1024)
    return false;
  allocator = nullptr;
  stats = {};
  allocator = tlsf_create_with_pool(backing, bytes);
  if (!allocator)
    return false;
  configured = bytes;
  stats.configured_bytes = bytes;
  stats.physical_pool_bytes = bytes;
  stats.allocator_overhead_bytes =
      tlsf_size() + tlsf_pool_overhead() + EXCEPTION_RESERVE_BYTES;
  stats.tlsf_consistent = 1;
  return true;
}

bool ensure_initialized() {
  return allocator != nullptr || configure(MAX_POOL_BYTES);
}

void failed(uint32_t size) {
  ++stats.allocation_count;
  ++stats.failure_count;
  stats.last_failure_index = stats.allocation_count;
  stats.last_failure_size = size;
  stats.last_failure_operation = current_operation;
  stats.last_failure_operation_index = current_operation_index;
}

void fill_free_stats(LedipMemoryStats &output) {
  output.free_bytes = 0;
  output.largest_free_block = 0;
  tlsf_walk_pool(
      tlsf_get_pool(allocator),
      [](void *, size_t size, int used, void *user) {
        if (!used) {
          auto &target = *static_cast<LedipMemoryStats *>(user);
          target.free_bytes += size;
          target.largest_free_block =
              std::max(target.largest_free_block, static_cast<uint32_t>(size));
        }
      },
      &output);
  output.fragmentation_percent =
      output.free_bytes == 0
          ? 0.0
          : (1.0 - static_cast<double>(output.largest_free_block) /
                       output.free_bytes) *
                100.0;
  output.tlsf_consistent = tlsf_check(allocator) == 0 ? 1 : 0;
}
} // namespace

bool ledip_pool_configure(uint32_t bytes) { return configure(bytes); }

void ledip_pool_set_failure(uint32_t nth, int32_t operation,
                            int32_t operation_index) {
  fail_at = nth;
  current_operation = operation;
  current_operation_index = operation_index;
}

void ledip_pool_set_operation(int32_t operation, int32_t operation_index) {
  current_operation = operation;
  current_operation_index = operation_index;
}

void ledip_pool_stats(LedipMemoryStats &output, bool walk) {
  output = stats;
  if (walk && allocator)
    fill_free_stats(output);
}

Header *header_for(void *pointer) {
  void *base = *reinterpret_cast<void **>(
      static_cast<unsigned char *>(pointer) - sizeof(void *));
  return static_cast<Header *>(base);
}

void *ledip_pool_allocate(size_t size, size_t alignment) {
  if (!ensure_initialized()) {
    failed(size);
    return nullptr;
  }
  alignment = std::max(alignment, alignof(Header));
  if ((alignment & (alignment - 1)) != 0) {
    failed(size);
    return nullptr;
  }
  if (fail_at != 0 && stats.allocation_count + 1 == fail_at) {
    failed(size);
    return nullptr;
  }
  constexpr size_t fixed_overhead = sizeof(Header) + sizeof(void *);
  if (size > SIZE_MAX - fixed_overhead - REDZONE_BYTES ||
      alignment - 1 > SIZE_MAX - fixed_overhead - REDZONE_BYTES - size) {
    failed(size);
    return nullptr;
  }
  const size_t allocation_size =
      fixed_overhead + REDZONE_BYTES + size + alignment - 1;
  void *base = tlsf_memalign(allocator, alignof(Header), allocation_size);
  if (!base) {
    failed(size);
    return nullptr;
  }
  const uintptr_t unaligned =
      reinterpret_cast<uintptr_t>(base) + fixed_overhead;
  const uintptr_t user =
      (unaligned + alignment - 1) & ~(static_cast<uintptr_t>(alignment) - 1);
  auto *header = static_cast<Header *>(base);
  header->magic = MAGIC;
  header->requested = size;
  header->actual = tlsf_block_size(base);
  header->user_offset = user - reinterpret_cast<uintptr_t>(base);
  *reinterpret_cast<void **>(user - sizeof(void *)) = base;
  std::memset(reinterpret_cast<unsigned char *>(user) + size, 0xdb,
              REDZONE_BYTES);
  ++stats.allocation_count;
  ++stats.live_blocks;
  stats.current_requested_bytes += size;
  stats.current_pool_bytes += header->actual;
  stats.peak_requested_bytes =
      std::max(stats.peak_requested_bytes, stats.current_requested_bytes);
  stats.peak_pool_bytes =
      std::max(stats.peak_pool_bytes, stats.current_pool_bytes);
  return reinterpret_cast<unsigned char *>(user);
}

void ledip_pool_deallocate(void *pointer) {
  if (!pointer)
    return;
  auto *header = header_for(pointer);
  if (header->magic != MAGIC)
    abort();
  const unsigned char *redzone =
      static_cast<const unsigned char *>(pointer) + header->requested;
  for (uint32_t index = 0; index < REDZONE_BYTES; ++index) {
    if (redzone[index] != 0xdb)
      abort();
  }
  stats.current_requested_bytes -= header->requested;
  stats.current_pool_bytes -= header->actual;
  --stats.live_blocks;
  ++stats.free_count;
  header->magic = FREED;
  std::memset(pointer, 0xaa, header->requested);
  tlsf_free(allocator, header);
}

bool ledip_pool_check() {
  if (!allocator || tlsf_check(allocator) != 0)
    return false;
  bool valid = true;
  tlsf_walk_pool(
      tlsf_get_pool(allocator),
      [](void *pointer, size_t size, int used, void *user) {
        if (!used)
          return;
        auto *header = static_cast<Header *>(pointer);
        if (header->magic != MAGIC ||
            header->user_offset + header->requested + REDZONE_BYTES > size) {
          *static_cast<bool *>(user) = false;
          return;
        }
        auto *user_pointer =
            static_cast<unsigned char *>(pointer) + header->user_offset;
        if (*reinterpret_cast<void **>(user_pointer - sizeof(void *)) !=
            pointer)
          *static_cast<bool *>(user) = false;
        const auto *redzone = user_pointer + header->requested;
        for (uint32_t index = 0; index < REDZONE_BYTES; ++index) {
          if (redzone[index] != 0xdb)
            *static_cast<bool *>(user) = false;
        }
      },
      &valid);
  return valid;
}

uint32_t ledip_pool_block_count() {
  uint32_t count = 0;
  if (allocator) {
    tlsf_walk_pool(
        tlsf_get_pool(allocator),
        [](void *, size_t, int, void *user) {
          ++*static_cast<uint32_t *>(user);
        },
        &count);
  }
  return count;
}

void ledip_pool_walk_blocks(uint32_t *output, uint32_t capacity) {
  struct Context {
    uint32_t *blocks;
    uint32_t limit;
    uint32_t position;
    uintptr_t origin;
  } context{output, capacity, 0, reinterpret_cast<uintptr_t>(backing)};
  tlsf_walk_pool(
      tlsf_get_pool(allocator),
      [](void *pointer, size_t size, int used, void *user) {
        auto &context = *static_cast<Context *>(user);
        if (context.position >= context.limit)
          return;
        context.blocks[context.position * 3] =
            reinterpret_cast<uintptr_t>(pointer) - context.origin;
        context.blocks[context.position * 3 + 1] = size;
        context.blocks[context.position * 3 + 2] = used;
        ++context.position;
      },
      &context);
}

void *operator new(size_t size) {
  if (void *pointer = ledip_pool_allocate(size))
    return pointer;
  throw std::bad_alloc();
}
void *operator new[](size_t size) {
  if (void *pointer = ledip_pool_allocate(size))
    return pointer;
  throw std::bad_alloc();
}
void *operator new(size_t size, const std::nothrow_t &) noexcept {
  return ledip_pool_allocate(size);
}
void *operator new[](size_t size, const std::nothrow_t &) noexcept {
  return ledip_pool_allocate(size);
}
void operator delete(void *pointer) noexcept { ledip_pool_deallocate(pointer); }
void operator delete[](void *pointer) noexcept {
  ledip_pool_deallocate(pointer);
}
void operator delete(void *pointer, size_t) noexcept {
  ledip_pool_deallocate(pointer);
}
void operator delete[](void *pointer, size_t) noexcept {
  ledip_pool_deallocate(pointer);
}
void *operator new(size_t size, std::align_val_t alignment) {
  if (void *pointer = ledip_pool_allocate(size, static_cast<size_t>(alignment)))
    return pointer;
  throw std::bad_alloc();
}
void *operator new[](size_t size, std::align_val_t alignment) {
  if (void *pointer = ledip_pool_allocate(size, static_cast<size_t>(alignment)))
    return pointer;
  throw std::bad_alloc();
}
void *operator new(size_t size, std::align_val_t alignment,
                   const std::nothrow_t &) noexcept {
  return ledip_pool_allocate(size, static_cast<size_t>(alignment));
}
void *operator new[](size_t size, std::align_val_t alignment,
                     const std::nothrow_t &) noexcept {
  return ledip_pool_allocate(size, static_cast<size_t>(alignment));
}
void operator delete(void *pointer, std::align_val_t) noexcept {
  ledip_pool_deallocate(pointer);
}
void operator delete[](void *pointer, std::align_val_t) noexcept {
  ledip_pool_deallocate(pointer);
}
void operator delete(void *pointer, size_t, std::align_val_t) noexcept {
  ledip_pool_deallocate(pointer);
}
void operator delete[](void *pointer, size_t, std::align_val_t) noexcept {
  ledip_pool_deallocate(pointer);
}

extern "C" {
void *malloc(size_t size) { return ledip_pool_allocate(size); }
void free(void *pointer) { ledip_pool_deallocate(pointer); }
void *calloc(size_t count, size_t size) {
  if (size != 0 && count > SIZE_MAX / size) {
    failed(SIZE_MAX);
    return nullptr;
  }
  const size_t total = count * size;
  void *pointer = ledip_pool_allocate(total);
  if (pointer)
    std::memset(pointer, 0, total);
  return pointer;
}
void *realloc(void *pointer, size_t size) {
  if (!pointer)
    return ledip_pool_allocate(size);
  if (size == 0) {
    ledip_pool_deallocate(pointer);
    return nullptr;
  }
  const auto *header = header_for(pointer);
  void *replacement = ledip_pool_allocate(size);
  if (!replacement)
    return nullptr;
  std::memcpy(replacement, pointer,
              std::min(static_cast<size_t>(header->requested), size));
  ledip_pool_deallocate(pointer);
  return replacement;
}
void *memalign(size_t alignment, size_t size) {
  return ledip_pool_allocate(size, alignment);
}
void *aligned_alloc(size_t alignment, size_t size) {
  if (alignment == 0 || size % alignment != 0)
    return nullptr;
  return ledip_pool_allocate(size, alignment);
}
int posix_memalign(void **result, size_t alignment, size_t size) {
  if (!result || alignment < sizeof(void *) ||
      alignment % sizeof(void *) != 0 || (alignment & (alignment - 1)) != 0)
    return 22;
  void *pointer = ledip_pool_allocate(size, alignment);
  if (!pointer)
    return 12;
  *result = pointer;
  return 0;
}
void *__cxa_allocate_exception(size_t thrown_size) noexcept {
  if (exception_in_use || thrown_size > EXCEPTION_RESERVE_BYTES)
    abort();
  exception_in_use = true;
  return exception_reserve;
}

void __cxa_free_exception(void *) noexcept { exception_in_use = false; }
}
