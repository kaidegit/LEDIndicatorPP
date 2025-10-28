# LED指示器

LED指示器这是一个具有预设优先级，自动抢占功能的LED框架，使用c++实现。灵感来自[esp-iot-solution/components/led/led_indicator at master · espressif/esp-iot-solution](https://github.com/espressif/esp-iot-solution/tree/master/components/led/led_indicator)

## 示例

* RT-Thread: [kaidegit/LEDIndicatorPP_example_rtt](https://github.com/kaidegit/LEDIndicatorPP_example_rtt)

## 支持类型

- [x] GPIO LED
- [x] GPIO RGB LED
- [ ] PWM LED
- [ ] PWM RGB LED
- [ ] WS2812
- [ ] GPIO LED under 74HC595
- [ ] RGB LED under AW2023

## 使用方法

### 实例化一个LED对象及其控制驱动

```c++
    rt_pin_mode(LED0_PIN, PIN_MODE_OUTPUT);
    auto driver = std::make_unique<LEDDriver_GPIO>([](uint8_t active_level, void *) {
        rt_pin_write(LED0_PIN, active_level);
    }, 0, nullptr);

    auto led_indicator = new LEDIndicator<BlinkTypeTest>(std::move(driver));
```

### 定义一个优先级

```c++
enum class BlinkTypeTest {
    BLINK_TWO_TIME, // 优先级最高
    BLINK_UPDATING,
    BLINK_LOOP // 优先级较低
};
```

### 注册这些优先级下的led动作

```c++
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
```

### 每隔50ms检查是否该为LED动作

```c++
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
```

### 使用

```c++
    led_indicator->start(BlinkTypeTest::BLINK_LOOP);
    rt_thread_delay(1000);
    led_indicator->start(BlinkTypeTest::BLINK_TWO_TIME);
    rt_thread_delay(5000);
    led_indicator->start(BlinkTypeTest::BLINK_UPDATING);
    rt_thread_delay(10000);
    led_indicator->stop(BlinkTypeTest::BLINK_UPDATING);
```

