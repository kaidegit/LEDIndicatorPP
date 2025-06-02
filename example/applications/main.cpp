#include <rtthread.h>
#include <rtdevice.h>
#define LOG_TAG "main"
#include "ulog.h"
#include "vector"
#include "string"

/* defined the LED0 pin: PE3 */
#define LED0_PIN    GET_PIN(E, 9)


int main(void) {
    rt_kprintf("This is an example of LEDIndicatorPP\r\n");
    rt_kprintf("You can try `led_i help`\r\n");
    return 0;
}

extern void test_led_ind_gpio();

void led_i(int argc, char **argv) {
    std::vector<std::string> args;
    args.reserve(argc - 1);
    for (int i = 1; i < argc; i++) {
        args.emplace_back(argv[i]);
    }

    if (args.size() == 0 or args[0] == "help") {
        printf("help\r\n");
    } else if (args[0] == "gpio") {
        log_d("test gpio");
        test_led_ind_gpio();
    }
}

MSH_CMD_EXPORT(led_i, led indicator test)
