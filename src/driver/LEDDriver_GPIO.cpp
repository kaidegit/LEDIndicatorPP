#include "LEDDriver.h"

#include "log_wrapper.hpp"

void LEDDriver_GPIO::setState(LedState state) {
    switch (state) {
        case LedState::OFF:
            write_gpio(!active_level, user_data);
            break;
        case LedState::ON:
            write_gpio(active_level, user_data);
            break;
    }
}

void LEDDriver_GPIO::setBrightness(int percent) {
    log_w("setBrightness not support");
}

void LEDDriver_GPIO::setColor(uint8_t r, uint8_t g, uint8_t b) {
    log_w("setColor not support");
}


