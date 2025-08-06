#include "LEDDriver.h"

#include "log_wrapper.hpp"

void LEDDriver_RGB_GPIO::setState(LedState state) {
    switch (state) {
    case LedState::OFF:
        write_gpio(!active_level, LED_PIN::LED_R_G_B_PIN, user_data);
        break;

    case LedState::ON: {
        uint8_t active_pin = static_cast<uint8_t>(LED_PIN::LED_NONE_PIN);
        if (led_color_cache.r) {
            active_pin |= static_cast<uint8_t>(LED_PIN::LED_R_PIN);
        }
        if (led_color_cache.g) {
            active_pin |= static_cast<uint8_t>(LED_PIN::LED_G_PIN);
        }
        if (led_color_cache.b) {
            active_pin |= static_cast<uint8_t>(LED_PIN::LED_B_PIN);
        }
        uint8_t inactive_pin = static_cast<uint8_t>(LED_PIN::LED_R_G_B_PIN) & ~active_pin;
        write_gpio(active_level, static_cast<LED_PIN>(active_pin), user_data);
        write_gpio(!active_level, static_cast<LED_PIN>(inactive_pin), user_data);
    }
    break;
    }
}

void LEDDriver_RGB_GPIO::setBrightness(int percent) {
    log_w("setBrightness not support");
}

void LEDDriver_RGB_GPIO::setColor(uint8_t r, uint8_t g, uint8_t b) {
    // LOG_D("setColor: %d, %d, %d", r, g, b);
    // if (r == led_color_cache.r && g == led_color_cache.g && b == led_color_cache.b) {
    // }
    led_color_cache = {0, r, g, b};
}
