//
// Created by yekai on 2025/8/6.
//

#pragma once

#ifndef LED_LOG_TAG
#define LED_LOG_TAG "LED_I_PP"
#endif

#ifdef USE_ESP_LOG
#include "esp_log.h"
#define log_v(format, ...) ESP_LOGV(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_d(format, ...) ESP_LOGD(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_i(format, ...) ESP_LOGI(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_w(format, ...) ESP_LOGW(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_e(format, ...) ESP_LOGE(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_hex(width, buf, size) ESP_LOG_BUFFER_HEXDUMP(LED_LOG_TAG, buf, size, ESP_LOG_INFO)
#elif USE_ELOG
#include "elog.h"
#undef log_e
#undef log_w
#undef log_i
#undef log_d
#undef log_v
#undef log_hex
#define log_v(format, ...) elog_v(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_d(format, ...) elog_d(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_i(format, ...) elog_i(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_w(format, ...) elog_w(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_e(format, ...) elog_e(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_hex(width, buf, size) elog_hex(LED_LOG_TAG, buf, size)
#elif USE_ULOG
#include "ulog.h"
#undef log_e
#undef log_w
#undef log_i
#undef log_d
#undef log_v
#undef log_hex
#define log_v(format, ...) ulog_v(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_d(format, ...) ulog_d(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_i(format, ...) ulog_i(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_w(format, ...) ulog_w(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_e(format, ...) ulog_e(LED_LOG_TAG, format, ##__VA_ARGS__)
#define log_hex(width, buf, size) ulog_hex(LED_LOG_TAG, buf, size)
#else
#include "stdio.h"
#ifdef USE_LOG_COLOR
    #define _USB_DBG_COLOR(n) printf("\033[" #n "m")
    #define _USB_DBG_LOG_HDR(lvl_name, color_n) printf("\033[" #color_n "m[" lvl_name "/" LED_LOG_TAG "] ")
    #define _USB_DBG_LOG_X_END printf("\033[0m\r\n")
#else
    #define _USB_DBG_COLOR(n)
    #define _USB_DBG_LOG_HDR(lvl_name, color_n) printf("[" lvl_name "/" LED_LOG_TAG "] ")
    #define _USB_DBG_LOG_X_END printf("\r\n")
#endif
#define usb_dbg_log_line(lvl, color_n, fmt, ...) \
    do {                                         \
        _USB_DBG_LOG_HDR(lvl, color_n);          \
        printf(fmt, ##__VA_ARGS__);              \
        _USB_DBG_LOG_X_END;                      \
    } while (0)

#define log_v(format, ...) usb_dbg_log_line("V", 0, format, ##__VA_ARGS__)
#define log_d(format, ...) usb_dbg_log_line("D", 0, format, ##__VA_ARGS__)
#define log_i(format, ...) usb_dbg_log_line("I", 32, format, ##__VA_ARGS__)
#define log_w(format, ...) usb_dbg_log_line("W", 33, format, ##__VA_ARGS__)
#define log_e(format, ...) usb_dbg_log_line("E", 31, format, ##__VA_ARGS__)

#define ___is_print(ch) ((unsigned int)((ch) - ' ') < 127u - ' ')
static inline void usb_hexdump(const void *ptr, uint32_t buflen)
{
    unsigned char *buf = (unsigned char *)ptr;
    unsigned int i, j;

    (void)buf;

    for (i = 0; i < buflen; i += 16) {
        printf("%08x:", i);

        for (j = 0; j < 16; j++)
            if (i + j < buflen) {
                if ((j % 8) == 0) {
                    printf("  ");
                }

                printf("%02X ", buf[i + j]);
            } else
                printf("   ");
        printf(" ");

        for (j = 0; j < 16; j++)
            if (i + j < buflen)
                printf("%c", ___is_print(buf[i + j]) ? buf[i + j] : '.');
        printf("\n");
    }
}

#define log_hex(width, buf, size) usb_hexdump(buf, size)
#endif
