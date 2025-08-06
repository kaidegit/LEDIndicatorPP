#pragma once

#include <memory>
#include <list>
#include "driver/LEDDriver.h"
#include "BlinkPattern.h"
#include "rtthread.h"
#include "magic_enum.hpp"

#define LOG_TAG "LEDIndicator"

#include "ulog.h"

static inline auto GetTime() {
    return rt_tick_get_millisecond();
}


template<typename BlinkType>
class LEDIndicator {
public:
    struct BlinkStatus {
        BlinkType type;
        bool first_start;
        uint32_t current_step_index;
        uint32_t elapsed_time;
        uint32_t last_update_time;
        LedColor current_color;
    };

    explicit LEDIndicator(std::unique_ptr<LEDDriver> driver)
        : driver(std::move(driver)) {
    }

    void addPattern(BlinkType type, BlinkPattern pattern) {
        if (lock) {
            lock(lock_user_data);
        }
        auto it = patterns.find(type);
        if (it != patterns.end()) {
            patterns.erase(type);
        }
        patterns.emplace(type, std::move(pattern));
        if (unlock) {
            unlock(lock_user_data);
        }
    }

    void addLockFunc(std::function<void(void *)> lock, std::function<void(void *)> unlock, void *user_data) {
        this->lock = std::move(lock);
        this->unlock = std::move(unlock);
        this->lock_user_data = user_data;
    }

    void start(BlinkType type) {
        if (lock) {
            lock(lock_user_data);
        }
        printf("Starting pattern: %s\n", magic_enum::enum_name(type).data());
        auto it = patterns.find(type);
        if (it != patterns.end()) {
            // insert to list depends on type order
            bool insert_at_end = true;
            for (auto it = active_patterns.begin(); it != active_patterns.end(); ++it) {
                if (it->type >= type) {
                    if (it->type == type) {
                        log_w("Pattern already exists, set it to default");
                        it->first_start = true;
                        it->current_step_index = 0;
                        it->elapsed_time = 0;
                        it->last_update_time = GetTime();
                    } else {
                        active_patterns.insert(it, BlinkStatus{
                                                   .type = type,
                                                   .first_start = true,
                                                   .current_step_index = 0,
                                                   .elapsed_time = 0,
                                                   .last_update_time = GetTime()
                                               });
                    }
                    insert_at_end = false;
                    break;
                }
            }
            if (insert_at_end) {
                active_patterns.emplace_back(BlinkStatus{
                    .type = type,
                    .first_start = true,
                    .current_step_index = 0,
                    .elapsed_time = 0,
                    .last_update_time = GetTime()
                });
            }
        } else {
            log_w("No pattern found for type");
        }
        // dumpActivePatterns();
        if (unlock) {
            unlock(lock_user_data);
        }
    }

    void stop(BlinkType type) {
        if (lock) {
            lock(lock_user_data);
        }
        bool update_again = false;
        for (auto it = active_patterns.begin(); it != active_patterns.end(); ++it) {
            if (it->type == type) {
                if (it == active_patterns.begin()) {
                    // we should re-check pattern if exist
                    update_again = true;
                }
                active_patterns.erase(it);
                break;
            }
        }
        if (update_again) {
            reexecuteFirstStep();
        }
        // dumpActivePatterns();
        if (unlock) {
            unlock(lock_user_data);
        }
    }

    // 定期调用此方法以更新 LED 状态
    // set to ramfun if needed
    // __attribute__((section(".RamFunc")))
    void update() {
        if (lock) {
            lock(lock_user_data);
        }
        bool update_again = false;
        if (active_patterns.empty()) {
            // log_d("No active patterns");
            if (unlock) {
                unlock(lock_user_data);
            }
            return;
        }

        for (auto it = active_patterns.begin(); it != active_patterns.end(); ++it) {
            // if (it == active_patterns.begin()) {
            //     printf("Active pattern: %s\n", magic_enum::enum_name(it->type).data());
            // } else {
            //     printf("Not active pattern: %s\n", magic_enum::enum_name(it->type).data());
            // }
            auto now = GetTime();
            auto delta_ms = now - it->last_update_time;
            it->last_update_time = now;

            it->elapsed_time += delta_ms;

            const auto pattern = patterns.find(it->type)->second;
            const auto &steps = pattern.getSteps();
            if (it->first_start) {
                // first time, just execute
                if (it == active_patterns.begin()) {
                    executeStep(steps[it->current_step_index]);
                }
                if (steps[it->current_step_index].type == BlinkStepType::RGB) {
                    log_d("%s cache color: %d, %d, %d",
                          magic_enum::enum_name(it->type).data(),
                          steps[it->current_step_index].color.r,
                          steps[it->current_step_index].color.g,
                          steps[it->current_step_index].color.b
                    );
                    it->current_color = steps[it->current_step_index].color;
                }
                it->first_start = false;
            }
            // log_d("waiting %d", steps[it->current_step_index].duration_ms);
            while (it->elapsed_time >= steps[it->current_step_index].duration_ms) {
                it->elapsed_time -= steps[it->current_step_index].duration_ms;
                it->current_step_index = getNextStep(steps[it->current_step_index], it->current_step_index);
                if (steps[it->current_step_index].type == BlinkStepType::STOP) {
                    // log_d("Stop pattern: %s", magic_enum::enum_name(it->type).data());
                    if (it == active_patterns.begin()) {
                        // we should re-check pattern if exist
                        update_again = true;
                    }
                    active_patterns.erase(it);
                    break;
                }
                if (it == active_patterns.begin()) {
                    executeStep(steps[it->current_step_index]);
                }
                // cache color
                if (steps[it->current_step_index].type == BlinkStepType::RGB) {
                    log_d("%s cache color: %d, %d, %d",
                          magic_enum::enum_name(it->type).data(),
                          steps[it->current_step_index].color.r,
                          steps[it->current_step_index].color.g,
                          steps[it->current_step_index].color.b
                    );
                    it->current_color = steps[it->current_step_index].color;
                }
            }
        }

        // execute the first step again if the first has been erased
        if (update_again) {
            reexecuteFirstStep();
        }
        if (unlock) {
            unlock(lock_user_data);
        }
    }

private:
    void reexecuteFirstStep() {
        if (!active_patterns.empty()) {
            log_d("Re-execute the first step");
            auto pattern_item = active_patterns.begin();
            const auto pattern = patterns.find(pattern_item->type)->second;
            const auto &steps = pattern.getSteps();
            const auto color_step = BlinkStep{
                .type = BlinkStepType::RGB,
                .color = pattern_item->current_color
            };
            log_d("%s Set cached color %d, %d, %d",
                  magic_enum::enum_name(pattern_item->type).data(),
                  color_step.color.r,
                  color_step.color.g,
                  color_step.color.b
            );
            executeStep(color_step);
            executeStep(steps[pattern_item->current_step_index]);
        } else {
            log_d("No active patterns");
        }
    }

    void executeStep(const BlinkStep &step) {
        // printf("\tExecuting step: %s\n", magic_enum::enum_name(step.type).data());
        switch (step.type) {
        case BlinkStepType::HOLD:
        case BlinkStepType::BREATHE:
            // printf("\t\tSet to %s\n", magic_enum::enum_name(step.state).data());
            driver->setState(step.state);
            break;
        case BlinkStepType::BRIGHTNESS:
            // printf("\t\tSet to %d\n", step.brightness);
            driver->setBrightness(step.brightness);
            break;
        case BlinkStepType::RGB:
            // printf("\t\tSet to %d, %d, %d\n", step.color.r, step.color.g, step.color.b);
            driver->setColor(step.color.r, step.color.g, step.color.b);
            break;
        case BlinkStepType::HSV:
            break;
        case BlinkStepType::LOOP:
            break;
        case BlinkStepType::STOP:
            break;
        }
    }

    uint32_t getNextStep(const BlinkStep &step, uint32_t step_index) {
        switch (step.type) {
        case BlinkStepType::LOOP:
            return 0;
        case BlinkStepType::HOLD:
        case BlinkStepType::BREATHE:
        case BlinkStepType::BRIGHTNESS:
        case BlinkStepType::RGB:
        case BlinkStepType::HSV:
        case BlinkStepType::STOP:
        default:
            return step_index + 1;
        }
    }

    void dumpActivePatterns() {
        printf("----------dumpActivePatterns----------\n");
        printf("Active patterns:\n");
        for (auto &pattern: active_patterns) {
            printf("\t - %s\n", magic_enum::enum_name(pattern.type).data());
        }
        printf("--------------------------------------\n");
    }

    std::unique_ptr<LEDDriver> driver;
    std::unordered_map<BlinkType, BlinkPattern> patterns; // 存储所有LED灯图案
    std::list<BlinkStatus> active_patterns; // 有序链表，按优先级排序
    std::function<void(void *)> lock;
    std::function<void(void *)> unlock;
    void *lock_user_data;
};

#undef LOG_TAG
