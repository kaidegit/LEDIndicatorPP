#pragma once

#include "cstdint"
#include <functional>
#include <utility>

// LED 状态
enum class LedState: uint32_t {
    NONE,
    OFF,
    ON,
    BREATHING,
};

struct LedColor {
    uint8_t resv;
    uint8_t r;
    uint8_t g;
    uint8_t b;
};

struct LedColorWithIndex {
    uint8_t index;
    uint8_t r;
    uint8_t g;
    uint8_t b;
};

class LEDDriver {
public:
    virtual ~LEDDriver() = default;

    virtual void setState(LedState state) = 0;

    virtual void setBrightness(int percent) = 0;

    virtual void setColor(uint8_t r, uint8_t g, uint8_t b) = 0;
};

class LEDDriver_GPIO : public LEDDriver {
public:
    LEDDriver_GPIO(std::function<void(uint8_t, void *)> func, uint8_t active_level,
                   void *user_data) : write_gpio(std::move(func)), active_level(active_level), user_data(user_data) {
    }

    virtual void setState(LedState state) override;

    virtual void setBrightness(int percent) override;

    virtual void setColor(uint8_t r, uint8_t g, uint8_t b) override;

private:
    std::function<void(uint8_t, void *)> write_gpio;
    uint8_t active_level;
    void *user_data;
};

class LEDDriver_RGB_GPIO : public LEDDriver {
public:
    enum class LED_PIN : uint8_t {
        LED_NONE_PIN = 0,
        LED_R_PIN = 1 << 0,
        LED_G_PIN = 1 << 1,
        LED_B_PIN = 1 << 2,
        LED_R_G_PIN = LED_R_PIN | LED_G_PIN,
        LED_G_B_PIN = LED_G_PIN | LED_B_PIN,
        LED_R_B_PIN = LED_R_PIN | LED_B_PIN,
        LED_R_G_B_PIN = LED_R_PIN | LED_G_PIN | LED_B_PIN,
    };

    LEDDriver_RGB_GPIO(std::function<void(uint8_t, LED_PIN, void *)> func, uint8_t active_level,
                       void *user_data) : write_gpio(std::move(func)), active_level(active_level),
                                          user_data(user_data), led_color_cache({0, 1, 1, 1}) {
    }

    virtual void setState(LedState state) override;

    virtual void setBrightness(int percent) override;

    virtual void setColor(uint8_t r, uint8_t g, uint8_t b) override;

private:
    std::function<void(uint8_t, LED_PIN, void *)> write_gpio;
    uint8_t active_level;
    LedColor led_color_cache;
    void *user_data;
};