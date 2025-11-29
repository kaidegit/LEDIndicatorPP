#include "LEDDriver.h"

#define LOG_TAG "LEDDriver_GPIO"

#include "log_wrapper.hpp"

void LEDDriver_GPIO::setState(LedState state) {
    switch (state) {
        case LedState::OFF:
            write_gpio(!active_level, user_data);
            break;
        case LedState::ON:
            write_gpio(active_level, user_data);
            break;
        default:;
    }
}
