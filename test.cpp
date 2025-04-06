#include "LEDIndicatorPP.h"
#include "drv_gpio.h"

rt_timer_t test_tmr = NULL;

#define LED0_PIN    GET_PIN(A, 10)

enum class BlinkTypeTest {
    BLINK_TWO_TIME, // 优先级最高
    BLINK_UPDATING,
    BLINK_LOOP // 优先级较低
};

using enum BlinkStepType;
using enum LedState;

void test_led_ind(int argc, char **argv) {
    rt_pin_mode(LED0_PIN, PIN_MODE_OUTPUT);
    auto driver = std::make_unique<LEDDriver_GPIO>([](uint8_t active_level, void *) {
        rt_pin_write(LED0_PIN, active_level);
    }, 0, nullptr);

    auto led_indicator = new LEDIndicator<BlinkTypeTest>(std::move(driver));

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

    led_indicator->addPattern(BlinkTypeTest::BLINK_TWO_TIME, blink_pattern_two_time);
    led_indicator->addPattern(BlinkTypeTest::BLINK_UPDATING, blink_pattern_updating);
    led_indicator->addPattern(BlinkTypeTest::BLINK_LOOP, blink_pattern_loop);

    if (test_tmr) {
        rt_timer_delete(test_tmr);
    }
    test_tmr = rt_timer_create(
        "led_i",
        [](void *arg) {
            auto led_indicator = static_cast<LEDIndicator<BlinkTypeTest> *>(arg);
            led_indicator->update();
        },
        led_indicator,
        50,
        RT_TIMER_FLAG_PERIODIC | RT_TIMER_FLAG_SOFT_TIMER
    );
    if (test_tmr) {
        rt_timer_start(test_tmr);
    }

    led_indicator->start(BlinkTypeTest::BLINK_LOOP);
    rt_thread_delay(1000);
    led_indicator->start(BlinkTypeTest::BLINK_TWO_TIME);
    rt_thread_delay(5000);
    led_indicator->start(BlinkTypeTest::BLINK_UPDATING);
    rt_thread_delay(10000);
    led_indicator->stop(BlinkTypeTest::BLINK_UPDATING);
}

MSH_CMD_EXPORT(test_led_ind, test led indicator)
