#pragma once

#include <vector>

#include "driver/LEDDriver.h"

enum class BlinkStepType : uint8_t {
    HOLD,
    BREATHE,
    BRIGHTNESS,
    RGB,
    IRGB,
    CLEAR,
    HSV,
    LOOP,
    STOP
};

struct BlinkStep {
    BlinkStepType type: 8;
    uint32_t duration_ms: 24;

    union {
        LedState state;
        uint32_t brightness;
        LedColor color;
        LedColorWithIndex icolor;
        uint32_t resv;
    };

    constexpr BlinkStep() : type(BlinkStepType::HOLD), duration_ms(0), resv(0) {
    }

    constexpr BlinkStep(BlinkStepType t, LedState state, uint32_t ms)
        : type(t), duration_ms(ms), state(state) {
    }

    constexpr BlinkStep(BlinkStepType t, uint32_t brightness, uint32_t ms)
        : type(t), duration_ms(ms), brightness(brightness) {
    }

    constexpr BlinkStep(BlinkStepType t, LedColor color, uint32_t ms)
        : type(t), duration_ms(ms), color(color) {
    }

    constexpr BlinkStep(BlinkStepType t, LedColorWithIndex icolor, uint32_t ms)
        : type(t), duration_ms(ms), icolor(icolor) {
    }

    constexpr BlinkStep(BlinkStepType t, uint32_t ms)
        : type(t), duration_ms(ms), resv(0) {
    }
};

class BlinkPattern {
public:
    explicit BlinkPattern(std::vector<BlinkStep> steps)
        : steps_(std::move(steps)) {
    }

    const std::vector<BlinkStep> &getSteps() const { return steps_; }

private:
    std::vector<BlinkStep> steps_;
};
