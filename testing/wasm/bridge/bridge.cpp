#include "../memory/pool.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <malloc.h>
#include <memory>
#include <new>
#include <vector>

#define LEDIP_EXTERNAL_TIME 1
#include "LEDIndicatorPP.h"

namespace {
enum class TestBlinkType : int32_t {};
using Indicator = LEDIndicator<TestBlinkType>;
constexpr uint32_t MAX_EVENTS = 4096;
constexpr uint32_t MAX_ACTIVE = 16;
constexpr uint32_t MAX_BLOCKS = 1024;
constexpr uint32_t INPUT_CAPACITY = 4096 * 12;
constexpr uint32_t UNKNOWN = 0xffffffff;

struct InputStep {
  uint8_t type;
  uint8_t reserved[3];
  uint32_t duration;
  uint32_t value;
};
static_assert(sizeof(InputStep) == 12);

struct Event {
  uint32_t time;
  uint32_t kind;
  uint32_t a;
  uint32_t b;
  uint32_t c;
  uint32_t d;
};
static_assert(sizeof(Event) == 24);

struct ActiveEntry {
  int32_t type;
  uint32_t step;
  uint32_t elapsed;
  uint32_t last_update;
  uint32_t color_type;
  uint32_t first_start;
  uint8_t color[4];
  uint8_t padding[4];
};
static_assert(sizeof(ActiveEntry) == 32);

struct State {
  uint32_t time;
  uint32_t active_count;
  int32_t selected_type;
  uint32_t requested_state;
  int32_t brightness;
  uint8_t requested_color[4];
  int32_t pin_r;
  int32_t pin_g;
  int32_t pin_b;
  uint32_t pin_mask;
  uint32_t event_overflow;
  uint32_t unsupported_mask;
  ActiveEntry active[MAX_ACTIVE];
};
static_assert(sizeof(State) == 560);

struct Instance {
  Indicator *indicator = nullptr;
  int driver_type = 0;
  uint32_t generation = 0;
  uint32_t event_count = 0;
  uint32_t event_capacity = MAX_EVENTS;
  uint32_t event_overflow = 0;
  uint32_t unsupported_mask = 0;
  uint32_t requested_state = 0;
  int32_t brightness = -1;
  uint8_t requested_color[4]{};
  int pin_r = -1;
  int pin_g = -1;
  int pin_b = -1;
  uint32_t pin_mask = 0;
  State state{};
  LedipMemoryStats memory{};
  std::array<Event, MAX_EVENTS> events{};
  std::array<uint32_t, MAX_BLOCKS * 3> blocks{};
};

std::array<Instance, 4> instances;
LedipMemoryStats last_memory{};
alignas(16) std::array<uint8_t, INPUT_CAPACITY> input;
Instance *current_instance = nullptr;
uint32_t virtual_time = 0;

void record(Instance &instance, uint32_t kind, uint32_t a = 0, uint32_t b = 0,
            uint32_t c = 0, uint32_t d = 0) {
#if LEDIP_TRACE
  if (instance.event_count >= instance.event_capacity) {
    ++instance.event_overflow;
    return;
  }
  instance.events[instance.event_count++] =
      Event{virtual_time, kind, a, b, c, d};
#else
  (void)instance;
  (void)kind;
  (void)a;
  (void)b;
  (void)c;
  (void)d;
#endif
}

void request(Instance &instance, uint32_t kind, uint32_t a = 0, uint32_t b = 0,
             uint32_t c = 0, uint32_t d = 0) {
  if (kind == 0)
    instance.requested_state = a;
  if (kind == 1)
    instance.brightness = static_cast<int32_t>(a);
  if (kind == 2 || kind == 3) {
    instance.requested_color[0] = b;
    instance.requested_color[1] = c;
    instance.requested_color[2] = d;
    instance.requested_color[3] = kind == 3 ? a : 0;
  }
  record(instance, kind, a, b, c, d);
}

class RecordingDriver final : public LEDDriver {
public:
  explicit RecordingDriver(Instance &instance) : instance(instance) {}
  void setState(LedState state) override {
    request(instance, 0, static_cast<uint32_t>(state));
  }
  void setBrightness(int percent) override { request(instance, 1, percent); }
  void setColor(uint8_t r, uint8_t g, uint8_t b) override {
    request(instance, 2, 0, r, g, b);
  }
  void setIndexColor(uint8_t index, uint8_t r, uint8_t g, uint8_t b) override {
    request(instance, 3, index, r, g, b);
  }
  void clearStrip() override { request(instance, 4); }
  void update() override { request(instance, 5); }

private:
  Instance &instance;
};

class ObservedGPIO final : public LEDDriver_GPIO {
public:
  ObservedGPIO(Instance &instance, uint8_t active_level)
      : LEDDriver_GPIO(
            [](uint8_t level, void *user) {
              auto &self = *static_cast<Instance *>(user);
              self.pin_r = level;
              self.pin_mask = 1;
              record(self, 6, 1, level);
            },
            active_level, &instance),
        instance(instance) {}
  void setState(LedState state) override {
    request(instance, 0, static_cast<uint32_t>(state));
    LEDDriver_GPIO::setState(state);
  }

private:
  Instance &instance;
};

class ObservedRGB final : public LEDDriver_RGB_GPIO {
public:
  ObservedRGB(Instance &instance, uint8_t active_level)
      : LEDDriver_RGB_GPIO(
            [](uint8_t level, LED_PIN pins, void *user) {
              auto &self = *static_cast<Instance *>(user);
              const uint32_t mask = static_cast<uint32_t>(pins);
              if (mask & 1)
                self.pin_r = level;
              if (mask & 2)
                self.pin_g = level;
              if (mask & 4)
                self.pin_b = level;
              self.pin_mask = mask;
              record(self, 6, mask, level);
            },
            active_level, &instance),
        instance(instance) {}
  void setState(LedState state) override {
    request(instance, 0, static_cast<uint32_t>(state));
    LEDDriver_RGB_GPIO::setState(state);
  }
  void setColor(uint8_t r, uint8_t g, uint8_t b) override {
    request(instance, 2, 0, r, g, b);
    LEDDriver_RGB_GPIO::setColor(r, g, b);
  }

private:
  Instance &instance;
};

Instance *resolve(int handle) {
  if (handle < 0)
    return nullptr;
  const uint32_t slot = static_cast<uint32_t>(handle) & 0xff;
  const uint32_t generation = static_cast<uint32_t>(handle) >> 8;
  if (slot >= instances.size())
    return nullptr;
  auto &instance = instances[slot];
  return instance.generation == generation && generation != 0 ? &instance
                                                              : nullptr;
}

int result_code(int handle, Instance *&instance) {
  instance = resolve(handle);
  return instance ? 0 : 1;
}

void snapshot(Instance &instance, uint32_t active_offset = 0) {
  instance.state = {};
  instance.state.time = virtual_time;
  instance.state.selected_type = -1;
  instance.state.requested_state = instance.requested_state;
  instance.state.brightness = instance.brightness;
  std::memcpy(instance.state.requested_color, instance.requested_color, 4);
  instance.state.pin_r = instance.pin_r;
  instance.state.pin_g = instance.pin_g;
  instance.state.pin_b = instance.pin_b;
  instance.state.pin_mask = instance.pin_r < 0 ? UNKNOWN : instance.pin_mask;
  instance.state.event_overflow = instance.event_overflow;
  instance.state.unsupported_mask = instance.unsupported_mask;
  if (!instance.indicator)
    return;
#if LEDIP_ENABLE_DEBUG_STATE
  const auto &active = instance.indicator->debugActivePatterns();
  instance.state.active_count = active.size();
  if (!active.empty())
    instance.state.selected_type = static_cast<int32_t>(active.front().type);
  uint32_t index = 0;
  uint32_t skipped = 0;
  for (const auto &entry : active) {
    if (skipped++ < active_offset)
      continue;
    if (index >= MAX_ACTIVE)
      break;
    auto &target = instance.state.active[index++];
    target.type = static_cast<int32_t>(entry.type);
    target.step = entry.current_step_index;
    target.elapsed = entry.elapsed_time;
    target.last_update = entry.last_update_time;
    target.color_type = static_cast<uint32_t>(entry.current_color_type);
    target.first_start = entry.first_start;
    if (entry.current_color_type == BlinkStepType::IRGB) {
      target.color[0] = entry.current_icolor.r;
      target.color[1] = entry.current_icolor.g;
      target.color[2] = entry.current_icolor.b;
      target.color[3] = entry.current_icolor.index;
    } else {
      target.color[0] = entry.current_color.r;
      target.color[1] = entry.current_color.g;
      target.color[2] = entry.current_color.b;
    }
  }
#endif
}

bool unsupported_step(Instance &instance, const InputStep &step) {
  if (step.type == 1 || step.type == 6)
    return true;
  if (instance.driver_type == 3 && step.type <= 6)
    return true;
  if (instance.driver_type == 1 &&
      (step.type == 2 || step.type == 3 || step.type == 4 || step.type == 5))
    return true;
  if (instance.driver_type == 2 &&
      (step.type == 2 || step.type == 4 || step.type == 5))
    return true;
  return false;
}
} // namespace

uint32_t LEDIndicatorGetTime() { return virtual_time; }

extern "C" {
int ledip_create(int driver, int active_level, uint32_t heap_size,
                 uint32_t fail_at, uint32_t event_capacity) {
  if (driver < 0 || driver > 3 || event_capacity == 0 ||
      event_capacity > MAX_EVENTS)
    return -1;
  if (!ledip_pool_configure(heap_size))
    return -2;
  uint32_t slot = 0;
  while (slot < instances.size() && instances[slot].indicator)
    ++slot;
  if (slot == instances.size())
    return -3;
  auto &instance = instances[slot];
  const uint32_t next_generation = (instance.generation + 1) & 0x00ffffff;
  instance = Instance{};
  instance.driver_type = driver;
  instance.event_capacity = event_capacity;
  instance.generation = next_generation;
  if (instance.generation == 0)
    instance.generation = 1;
  current_instance = &instance;
  virtual_time = 0;
  ledip_pool_set_failure(fail_at, 0, -1);
  try {
    std::unique_ptr<LEDDriver> led_driver;
    if (driver == 0)
      led_driver = std::make_unique<RecordingDriver>(instance);
    if (driver == 1)
      led_driver = std::make_unique<ObservedGPIO>(instance, active_level);
    if (driver == 2)
      led_driver = std::make_unique<ObservedRGB>(instance, active_level);
    instance.indicator = new Indicator(std::move(led_driver));
  } catch (const std::bad_alloc &) {
    delete instance.indicator;
    instance.indicator = nullptr;
    ledip_pool_stats(instance.memory, true);
    return -4;
  }
  snapshot(instance);
  return static_cast<int>(slot | (instance.generation << 8));
}

int ledip_destroy(int handle) {
  Instance *instance;
  if (result_code(handle, instance) != 0)
    return 1;
  ledip_pool_stats(instance->memory, true);
  delete instance->indicator;
  instance->indicator = nullptr;
  ledip_pool_stats(instance->memory, true);
  snapshot(*instance);
  current_instance = nullptr;
  return 0;
}

int ledip_add_pattern(int handle, int type, uint32_t count) {
  Instance *instance;
  if (result_code(handle, instance) != 0 || !instance->indicator)
    return 1;
  if (count > INPUT_CAPACITY / sizeof(InputStep))
    return 2;
  std::vector<BlinkStep> steps;
  try {
    steps.reserve(count);
    const auto *source = reinterpret_cast<const InputStep *>(input.data());
    for (uint32_t index = 0; index < count; ++index) {
      const auto &step = source[index];
      if (step.type > 8 || step.duration > 0xffffff)
        return 2;
      if (unsupported_step(*instance, step))
        instance->unsupported_mask |= 1u << step.type;
      const auto color = LedColor{0, static_cast<uint8_t>(step.value >> 8),
                                  static_cast<uint8_t>(step.value >> 16),
                                  static_cast<uint8_t>(step.value >> 24)};
      const auto icolor = LedColorWithIndex{static_cast<uint8_t>(step.value),
                                            color.r, color.g, color.b};
      switch (static_cast<BlinkStepType>(step.type)) {
      case BlinkStepType::HOLD:
      case BlinkStepType::BREATHE:
        steps.emplace_back(static_cast<BlinkStepType>(step.type),
                           static_cast<LedState>(step.value), step.duration);
        break;
      case BlinkStepType::BRIGHTNESS:
        steps.emplace_back(BlinkStepType::BRIGHTNESS, step.value,
                           step.duration);
        break;
      case BlinkStepType::RGB:
        steps.emplace_back(BlinkStepType::RGB, color, step.duration);
        break;
      case BlinkStepType::IRGB:
        steps.emplace_back(BlinkStepType::IRGB, icolor, step.duration);
        break;
      default:
        steps.emplace_back(static_cast<BlinkStepType>(step.type),
                           step.duration);
        break;
      }
    }
    instance->indicator->addPattern(static_cast<TestBlinkType>(type),
                                    BlinkPattern(std::move(steps)));
  } catch (const std::bad_alloc &) {
    return 3;
  }
  snapshot(*instance);
  return 0;
}

int ledip_start(int handle, int type) {
  Instance *instance;
  if (result_code(handle, instance) != 0 || !instance->indicator)
    return 1;
  try {
    instance->indicator->start(static_cast<TestBlinkType>(type));
  } catch (const std::bad_alloc &) {
    return 3;
  }
  snapshot(*instance);
  return 0;
}

int ledip_stop(int handle, int type) {
  Instance *instance;
  if (result_code(handle, instance) != 0 || !instance->indicator)
    return 1;
  try {
    instance->indicator->stop(static_cast<TestBlinkType>(type));
  } catch (const std::bad_alloc &) {
    return 3;
  }
  snapshot(*instance);
  return 0;
}

void ledip_set_time(int handle, uint32_t time) {
  if (resolve(handle)) {
    virtual_time = time;
    snapshot(*resolve(handle));
  }
}

int ledip_update(int handle) {
  Instance *instance;
  if (result_code(handle, instance) != 0 || !instance->indicator)
    return 1;
  current_instance = instance;
  try {
    instance->indicator->update();
  } catch (const std::bad_alloc &) {
    return 3;
  }
  snapshot(*instance);
  return 0;
}

int ledip_run_batch(int handle, uint32_t count, uint32_t interval) {
  Instance *instance;
  if (result_code(handle, instance) != 0 || !instance->indicator)
    return 1;
  for (uint32_t index = 0; index < count; ++index) {
    virtual_time += interval;
    try {
      instance->indicator->update();
    } catch (const std::bad_alloc &) {
      return 3;
    }
    if (instance->event_overflow)
      return 4;
  }
  snapshot(*instance);
  return 0;
}

uint8_t *ledip_input_pointer() { return input.data(); }
uint32_t ledip_input_capacity() { return INPUT_CAPACITY; }
Event *ledip_events_pointer(int handle) {
  auto *instance = resolve(handle);
  return instance ? instance->events.data() : nullptr;
}
uint32_t ledip_event_count(int handle) {
  auto *instance = resolve(handle);
  return instance ? instance->event_count : 0;
}
void ledip_clear_events(int handle) {
  if (auto *instance = resolve(handle))
    instance->event_count = 0;
}
State *ledip_state_pointer(int handle) {
  auto *instance = resolve(handle);
  if (instance)
    snapshot(*instance);
  return instance ? &instance->state : nullptr;
}
ActiveEntry *ledip_active_page_pointer(int handle, uint32_t offset) {
  auto *instance = resolve(handle);
  if (instance)
    snapshot(*instance, offset);
  return instance ? instance->state.active : nullptr;
}
LedipMemoryStats *ledip_memory_pointer(int handle) {
  if (handle == -1) {
    ledip_pool_stats(last_memory, true);
    return &last_memory;
  }
  auto *instance = resolve(handle);
  if (instance)
    ledip_pool_stats(instance->memory, true);
  return instance ? &instance->memory : nullptr;
}
uint32_t *ledip_blocks_pointer(int handle) {
  auto *instance = resolve(handle);
  if (instance)
    ledip_pool_walk_blocks(instance->blocks.data(), MAX_BLOCKS);
  return instance ? instance->blocks.data() : nullptr;
}
uint32_t ledip_block_count(int handle) {
  auto *instance = resolve(handle);
  return instance ? std::min(ledip_pool_block_count(), MAX_BLOCKS) : 0;
}
void ledip_configure_failure(int handle, uint32_t nth, int operation,
                             int operation_index) {
  if (resolve(handle))
    ledip_pool_set_failure(nth, operation, operation_index);
}
int ledip_check_memory(int handle) {
  if (!resolve(handle))
    return 6;
#if LEDIP_MEMORY_CHECK
  return ledip_pool_check() ? 0 : 6;
#else
  return 0;
#endif
}
uint32_t ledip_stack_high_water() { return UNKNOWN; }

int ledip_allocator_self_test() {
  auto *bytes = static_cast<unsigned char *>(std::malloc(24));
  if (!bytes)
    return 7;
  for (unsigned char index = 0; index < 24; ++index)
    bytes[index] = index;
  bytes = static_cast<unsigned char *>(std::realloc(bytes, 48));
  if (!bytes)
    return 7;
  for (unsigned char index = 0; index < 24; ++index) {
    if (bytes[index] != index) {
      std::free(bytes);
      return 7;
    }
  }
  std::free(bytes);

  auto *zeroed = static_cast<unsigned char *>(std::calloc(16, 4));
  if (!zeroed)
    return 7;
  for (unsigned char index = 0; index < 64; ++index) {
    if (zeroed[index] != 0) {
      std::free(zeroed);
      return 7;
    }
  }
  std::free(zeroed);

  auto *array = new (std::nothrow) uint32_t[4]{1, 2, 3, 4};
  if (!array)
    return 7;
  delete[] array;

  struct alignas(64) AlignedValue {
    uint64_t value;
  };
  auto *aligned = new (std::nothrow) AlignedValue{42};
  if (!aligned || reinterpret_cast<uintptr_t>(aligned) % 64 != 0)
    return 7;
  delete aligned;

  void *memaligned = memalign(64, 64);
  if (!memaligned || reinterpret_cast<uintptr_t>(memaligned) % 64 != 0)
    return 7;
  std::free(memaligned);

  void *aligned_c = std::aligned_alloc(64, 128);
  if (!aligned_c || reinterpret_cast<uintptr_t>(aligned_c) % 64 != 0)
    return 7;
  std::free(aligned_c);

  void *posix = nullptr;
  if (posix_memalign(&posix, 64, 64) != 0 ||
      reinterpret_cast<uintptr_t>(posix) % 64 != 0)
    return 7;
  std::free(posix);
  return ledip_pool_check() ? 0 : 7;
}
}
