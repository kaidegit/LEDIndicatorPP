#include "LEDIndicatorPP.h"
#include "drv_gpio.h"

rt_timer_t test_tmr = NULL;

#define LEDR_PIN    GET_PIN(A, 8)
#define LEDG_PIN    GET_PIN(A, 9)
#define LEDB_PIN    GET_PIN(A, 10)

enum class BlinkTypeTest_GPIO {
    BLINK_TWO_TIME, // 优先级最高
    BLINK_UPDATING,
    BLINK_LOOP // 优先级较低
};

using enum BlinkStepType;
using enum LedState;

void test_led_ind_gpio(int argc, char **argv) {
    rt_pin_mode(LEDG_PIN, PIN_MODE_OUTPUT);
    auto driver = std::make_unique<LEDDriver_GPIO>([](uint8_t level, void *) {
        rt_pin_write(LEDG_PIN, level);
    }, 0, nullptr);

    auto led_indicator = new LEDIndicator<BlinkTypeTest_GPIO>(std::move(driver));

    BlinkPattern blink_pattern_two_time{
        {
            {HOLD, {.state = ON}, 200},
            {HOLD, {.state = OFF}, 200},
            {HOLD, {.state = ON}, 200},
            {HOLD, {.state = OFF}, 200},
            {STOP, {.resv = 0}, 0},
        }
    };
    BlinkPattern blink_pattern_updating{
        {
            {HOLD, {.state = ON}, 50},
            {HOLD, {.state = OFF}, 100},
            {HOLD, {.state = ON}, 50},
            {HOLD, {.state = OFF}, 800},
            {LOOP, {.resv = 0}, 0},
        }
    };
    BlinkPattern blink_pattern_loop{
        {
            {HOLD, {.state = ON}, 500},
            {HOLD, {.state = OFF}, 500},
            {LOOP, {.resv = 0}, 0},
        }
    };

    led_indicator->addPattern(BlinkTypeTest_GPIO::BLINK_TWO_TIME, blink_pattern_two_time);
    led_indicator->addPattern(BlinkTypeTest_GPIO::BLINK_UPDATING, blink_pattern_updating);
    led_indicator->addPattern(BlinkTypeTest_GPIO::BLINK_LOOP, blink_pattern_loop);

    if (test_tmr) {
        rt_timer_delete(test_tmr);
    }
    test_tmr = rt_timer_create(
        "led_i",
        [](void *arg) {
            auto led_indicator = static_cast<LEDIndicator<BlinkTypeTest_GPIO> *>(arg);
            led_indicator->update();
        },
        led_indicator,
        50,
        RT_TIMER_FLAG_PERIODIC | RT_TIMER_FLAG_SOFT_TIMER
    );
    if (test_tmr) {
        rt_timer_start(test_tmr);
    }

    led_indicator->start(BlinkTypeTest_GPIO::BLINK_LOOP);
    rt_thread_delay(1000);
    led_indicator->start(BlinkTypeTest_GPIO::BLINK_TWO_TIME);
    rt_thread_delay(5000);
    led_indicator->start(BlinkTypeTest_GPIO::BLINK_UPDATING);
    rt_thread_delay(10000);
    led_indicator->stop(BlinkTypeTest_GPIO::BLINK_UPDATING);
}

MSH_CMD_EXPORT(test_led_ind_gpio, test led indicator gpio)

using enum LEDDriver_RGB_GPIO::LED_PIN;

enum class BlinkTypeTest_RGB {
    BLINK_RGB, // 优先级最高
    BLINK_UPDATING,
    BLINK_LOOP // 优先级较低
};

void test_led_ind_rgb_gpio(int argc, char **argv) {
    rt_pin_mode(LEDB_PIN, PIN_MODE_OUTPUT);
    rt_pin_mode(LEDG_PIN, PIN_MODE_OUTPUT);
    rt_pin_mode(LEDR_PIN, PIN_MODE_OUTPUT);
    rt_pin_write(LEDB_PIN, PIN_HIGH);
    rt_pin_write(LEDG_PIN, PIN_HIGH);
    rt_pin_write(LEDR_PIN, PIN_HIGH);
    auto driver = std::make_unique<LEDDriver_RGB_GPIO>(
        [](uint8_t level, LEDDriver_RGB_GPIO::LED_PIN led_pin, void *) {
            printf("write %s to %d\n", magic_enum::enum_name(led_pin).data(), level);
            if (static_cast<uint8_t>(led_pin) & static_cast<uint8_t>(LED_R_PIN)) {
                printf("R");
                rt_pin_write(LEDR_PIN, level);
            }
            if (static_cast<uint8_t>(led_pin) & static_cast<uint8_t>(LED_G_PIN)) {
                printf("G");
                rt_pin_write(LEDG_PIN, level);
            }
            if (static_cast<uint8_t>(led_pin) & static_cast<uint8_t>(LED_B_PIN)) {
                printf("B");
                rt_pin_write(LEDB_PIN, level);
            }
            printf("\n");
        }, 0, nullptr);

    auto led_indicator = new LEDIndicator<BlinkTypeTest_RGB>(std::move(driver));

    BlinkPattern blink_pattern_rgb{
        {
            {RGB, {.color = {.resv = 0, .r = 1, .g = 0, .b = 0}}, 1000},
            {RGB, {.color = {.resv = 0, .r = 0, .g = 1, .b = 0}}, 2000},
            {RGB, {.color = {.resv = 0, .r = 0, .g = 0, .b = 1}}, 4000},
            {RGB, {.color = {.resv = 0, .r = 1, .g = 1, .b = 1}}, 1000},
            {STOP, {.resv = 0}, 0},
        }
    };
    BlinkPattern blink_pattern_updating{
        {
            {HOLD, {.state = ON}, 50},
            {HOLD, {.state = OFF}, 100},
            {HOLD, {.state = ON}, 50},
            {HOLD, {.state = OFF}, 800},
            {LOOP, {.resv = 0}, 0},
        }
    };
    BlinkPattern blink_pattern_loop{
        {
            {HOLD, {.state = ON}, 500},
            {HOLD, {.state = OFF}, 500},
            {LOOP, {.resv = 0}, 0},
        }
    };

    led_indicator->addPattern(BlinkTypeTest_RGB::BLINK_RGB, blink_pattern_rgb);
    // led_indicator->addPattern(BlinkTypeTest_GPIO::BLINK_UPDATING, blink_pattern_updating);
    led_indicator->addPattern(BlinkTypeTest_RGB::BLINK_LOOP, blink_pattern_loop);

    if (test_tmr) {
        rt_timer_delete(test_tmr);
    }
    test_tmr = rt_timer_create(
        "led_i",
        [](void *arg) {
            auto led_indicator = static_cast<LEDIndicator<BlinkTypeTest_GPIO> *>(arg);
            led_indicator->update();
        },
        led_indicator,
        50,
        RT_TIMER_FLAG_PERIODIC | RT_TIMER_FLAG_SOFT_TIMER
    );
    if (test_tmr) {
        rt_timer_start(test_tmr);
    }

    led_indicator->start(BlinkTypeTest_RGB::BLINK_LOOP);
    rt_thread_delay(1000);
    led_indicator->start(BlinkTypeTest_RGB::BLINK_RGB);
    rt_thread_delay(5000);
    // led_indicator->start(BlinkTypeTest::BLINK_UPDATING);
    // rt_thread_delay(10000);
    // led_indicator->stop(BlinkTypeTest::BLINK_UPDATING);
}

MSH_CMD_EXPORT(test_led_ind_rgb_gpio, test led indicator rgb gpio)
