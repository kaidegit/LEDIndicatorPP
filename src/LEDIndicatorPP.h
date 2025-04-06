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
    };

    explicit LEDIndicator(std::unique_ptr<LEDDriver> driver)
        : driver(std::move(driver)) {
    }

    void addPattern(BlinkType type, BlinkPattern pattern) {
        patterns.emplace(type, std::move(pattern));
    }

    void dumpActivePatterns() {
        printf("----------dumpActivePatterns----------\n");
        printf("Active patterns:\n");
        for (auto &pattern: active_patterns) {
            printf("\t - %s\n", magic_enum::enum_name(pattern.type).data());
        }
        printf("--------------------------------------\n");
    }

    void start(BlinkType type) {
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
        dumpActivePatterns();
    }

    void stop(BlinkType type) {
        for (auto it = active_patterns.begin(); it != active_patterns.end(); ++it) {
            if (it->type == type) {
                active_patterns.erase(it);
                break;
            }
        }
        dumpActivePatterns();
    }

    // 定期调用此方法以更新 LED 状态
    void update() {
        if (active_patterns.empty()) {
            log_d("No active patterns");
            return;
        }

        for (auto it = active_patterns.begin(); it != active_patterns.end(); ++it) {
            if (it == active_patterns.begin()) {
                printf("Active pattern: %s\n", magic_enum::enum_name(it->type).data());
            } else {
                printf("Not active pattern: %s\n", magic_enum::enum_name(it->type).data());
            }
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
                it->first_start = false;
            }
            log_d("waiting %d", steps[it->current_step_index].duration_ms);
            while (it->elapsed_time >= steps[it->current_step_index].duration_ms) {
                it->elapsed_time -= steps[it->current_step_index].duration_ms;
                it->current_step_index = getNextStep(steps[it->current_step_index], it->current_step_index);
                if (steps[it->current_step_index].type == BlinkStepType::STOP) {
                    stop(it->type);
                    break;
                }
                if (it == active_patterns.begin()) {
                    executeStep(steps[it->current_step_index]);
                }
            }
        }
    }

private:
    void executeStep(const BlinkStep &step) {
        printf("\tExecuting step: %s\n", magic_enum::enum_name(step.type).data());
        switch (step.type) {
            case BlinkStepType::HOLD:
                printf("\t\tSet to %s\n", magic_enum::enum_name(step.state).data());
                driver->setState(step.state);
                break;
            case BlinkStepType::BREATHE:
                // 实现呼吸效果
                break;
            case BlinkStepType::BRIGHTNESS:
                printf("\t\tSet to %d\n", step.brightness);
                driver->setBrightness(step.brightness);
                break;
            case BlinkStepType::RGB:
                printf("\t\tSet to %d, %d, %d\n", step.color.r, step.color.g, step.color.b);
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

    std::unique_ptr<LEDDriver> driver;
    std::unordered_map<BlinkType, BlinkPattern> patterns; // 存储所有LED灯图案
    std::list<BlinkStatus> active_patterns; // 有序链表，按优先级排序
};

#undef LOG_TAG
