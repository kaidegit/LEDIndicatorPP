# LED指示器

LED指示器这是一个具有预设优先级，自动抢占功能的LED框架，使用c++实现。灵感来自[esp-iot-solution/components/led/led_indicator at master · espressif/esp-iot-solution](https://github.com/espressif/esp-iot-solution/tree/master/components/led/led_indicator)

## 示例

* ESP-IDF: [kaidegit/LEDIndicatorPP_example_idf](https://github.com/kaidegit/LEDIndicatorPP_example_idf)
* RT-Thread: [kaidegit/LEDIndicatorPP_example_rtt](https://github.com/kaidegit/LEDIndicatorPP_example_rtt)

## 支持类型

- [x] GPIO LED
- [x] GPIO RGB LED
- [ ] PWM LED
- [ ] PWM RGB LED
- [ ] WS2812
- [ ] GPIO LED under 74HC595
- [ ] RGB LED under AW2023

## 使用方法(详见例程)

### 实例化一个LED对象及其控制驱动，如有需要，添加锁

```c++
    const auto write_pin = [](uint8_t level, void *user_data) {
        auto pin = *reinterpret_cast<gpio_num_t *>(user_data);
        if (pin == GPIO_NUM_NC) { return; }
        gpio_set_level(pin, level);
    };

    led_indicator = new LEDIndicator<BlinkType>(std::make_unique<LEDDriver_GPIO>(
        write_pin,
        1,
        &led_pin
    ));
    
    const auto lock_func = [](void *user_data) {
        auto led_mutex = static_cast<SemaphoreHandle_t>(user_data);
        if (pdTRUE != xSemaphoreTake(led_mutex, pdMS_TO_TICKS(100))) {
            ESP_LOGW("LED", "led_mutex take timeout");
        }
    };
    const auto unlock_func = [](void *user_data) {
        auto led_mutex = static_cast<SemaphoreHandle_t>(user_data);
        xSemaphoreGive(led_mutex);
    };
    led_indicator->addLockFunc(std::move(lock_func), std::move(unlock_func), led_mutex);
```

### 定义一个优先级

```c++
    enum class BlinkType {
        BLINK_PRIORITY_HIGHEST,  // 优先级最高
        BLINK_OFF,
        BLINK_FAST,
        BLINK_NORMAL,
        BLINK_IDLE,
        BLINK_PRIORITY_LOWEST // 优先级较低
    };
```

### 注册这些优先级下的led动作

```c++
    BlinkPattern blink_pattern_idle{
        {
            {HOLD, ON, 100000},
            {LOOP, 0},
        }
    };
    led_indicator->addPattern(BlinkType::BLINK_IDLE, blink_pattern_idle);

    BlinkPattern blink_pattern_off{
        {
            {HOLD, OFF, 2000},
            {STOP, 0},
        }
    };
    led_indicator->addPattern(BlinkType::BLINK_OFF, blink_pattern_off);

    BlinkPattern blink_pattern_normal{
        {
            {HOLD, OFF, 500},
            {HOLD, ON, 500},
            {LOOP, 0},
        }
    };
    led_indicator->addPattern(BlinkType::BLINK_NORMAL, blink_pattern_normal);
```

### 每隔50ms检查是否该为LED动作

```c++
    tmr = xTimerCreate(
        "led_i",
        pdMS_TO_TICKS(20),
        true,
        nullptr,
        [](TimerHandle_t timer) {
            instance->update();
        }
    );
    if (tmr) {
        xTimerStart(tmr, portMAX_DELAY);
    }
```

### 使用

```c++
    ESP_LOGI(TAG, "LED Indicator Example");
    LEDController::getInstance();

    vTaskDelay(pdMS_TO_TICKS(2000));

    ESP_LOGI(TAG, "start led off pattern");
    LEDController::getInstance()->getIndicator()->start(LEDController::BlinkType::BLINK_OFF);

    vTaskDelay(pdMS_TO_TICKS(5000));

    ESP_LOGI(TAG, "start normal blink");
    LEDController::getInstance()->getIndicator()->start(LEDController::BlinkType::BLINK_NORMAL);

    vTaskDelay(pdMS_TO_TICKS(5000));

    ESP_LOGI(TAG, "manually stop normal blink");
    LEDController::getInstance()->getIndicator()->stop(LEDController::BlinkType::BLINK_NORMAL);

    vTaskDelay(pdMS_TO_TICKS(5000));

    ESP_LOGI(TAG, "start normal blink and fast blink, it should behave fast blink");
    LEDController::getInstance()->getIndicator()->start(LEDController::BlinkType::BLINK_FAST);
    LEDController::getInstance()->getIndicator()->start(LEDController::BlinkType::BLINK_NORMAL);
```

