#include "LEDIndicatorPP.h"

#include "drv_gpio.h"

#define LOG_TAG "LED_I_TEST"

rt_timer_t test_tmr = NULL;

#define LEDR_PIN    GET_PIN(E, 13)
#define LEDG_PIN    GET_PIN(E, 11)
#define LEDB_PIN    GET_PIN(E, 9)

enum class BlinkTypeTest_GPIO {
    BLINK_TWO_TIME, // 优先级最高
    BLINK_UPDATING,
    BLINK_LOOP // 优先级较低
};

using enum BlinkStepType;
using enum LedState;

void test_led_ind_gpio() {
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

    log_w("LED will blink slowly...");
    led_indicator->start(BlinkTypeTest_GPIO::BLINK_LOOP);
    rt_thread_delay(1000);
    log_w("LED will blink fastly 2 times and roll back to slowly...");
    led_indicator->start(BlinkTypeTest_GPIO::BLINK_TWO_TIME);
    rt_thread_delay(5000);
    log_w("LED will blink in a special pattern");
    led_indicator->start(BlinkTypeTest_GPIO::BLINK_UPDATING);
    rt_thread_delay(5000);
    log_w("LED will roll back to slowly");
    led_indicator->stop(BlinkTypeTest_GPIO::BLINK_UPDATING);
    rt_thread_delay(5000);
    log_w("LED will stop");
    led_indicator->stop(BlinkTypeTest_GPIO::BLINK_LOOP);
    rt_timer_delete(test_tmr);
}
