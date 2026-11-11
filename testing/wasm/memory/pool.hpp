#pragma once

#include <cstddef>
#include <cstdint>

struct LedipMemoryStats {
  uint32_t configured_bytes;
  uint32_t physical_pool_bytes;
  uint32_t allocator_overhead_bytes;
  uint32_t current_requested_bytes;
  uint32_t peak_requested_bytes;
  uint32_t current_pool_bytes;
  uint32_t peak_pool_bytes;
  uint32_t allocation_count;
  uint32_t free_count;
  uint32_t failure_count;
  uint32_t live_blocks;
  uint32_t free_bytes;
  uint32_t largest_free_block;
  uint32_t last_failure_index;
  uint32_t last_failure_size;
  int32_t last_failure_operation;
  int32_t last_failure_operation_index;
  uint32_t tlsf_consistent;
  double fragmentation_percent;
};

static_assert(sizeof(LedipMemoryStats) == 80);

bool ledip_pool_configure(uint32_t bytes);
void ledip_pool_set_failure(uint32_t nth, int32_t operation,
                            int32_t operation_index);
void ledip_pool_set_operation(int32_t operation, int32_t operation_index);
void ledip_pool_stats(LedipMemoryStats &stats, bool walk);
bool ledip_pool_check();
uint32_t ledip_pool_block_count();
void ledip_pool_walk_blocks(uint32_t *output, uint32_t capacity);
void *ledip_pool_allocate(size_t size,
                          size_t alignment = alignof(std::max_align_t));
void ledip_pool_deallocate(void *pointer);
