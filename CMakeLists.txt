idf_component_register(
        SRC_DIRS src/driver
        INCLUDE_DIRS src
        REQUIRES esp_timer
)

target_compile_definitions(${COMPONENT_LIB} PUBLIC USE_ESP_LOG=1)
