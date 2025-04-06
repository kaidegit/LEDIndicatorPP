#pragma once

#include <vector>

#include "driver/LEDDriver.h"

enum class BlinkStepType : uint8_t {
    HOLD,
    BREATHE,
    BRIGHTNESS,
    RGB,
    HSV,
    LOOP,
    STOP
};

struct BlinkStep {
    BlinkStepType type;

    union {
        LedState state;
        uint32_t brightness;
        LedColor color;
        LedColorWithIndex icolor;
        uint32_t resv;
    };

    int duration_ms;
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
