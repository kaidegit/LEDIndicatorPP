cmake_minimum_required(VERSION 3.20)
project(ledip_tester_wasm LANGUAGES C CXX)

if(NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    message(FATAL_ERROR "Configure with emcmake cmake")
endif()

set(PROFILE "debug" CACHE STRING "debug, memory-check, release or size")
set(ROOT "${CMAKE_CURRENT_LIST_DIR}/../..")
set(OUTPUT "${CMAKE_CURRENT_LIST_DIR}/build/${PROFILE}")

add_executable(ledip_tester
    bridge/bridge.cpp
    memory/pool.cpp
    "${ROOT}/src/driver/LEDDriver_GPIO.cpp"
    "${ROOT}/src/driver/LEDDriver_RGB_GPIO.cpp"
    "${ROOT}/testing/third_party/tlsf/tlsf.c"
)
target_include_directories(ledip_tester PRIVATE
    "${ROOT}/src"
    "${ROOT}/testing/third_party/magic_enum/include/magic_enum"
    "${ROOT}/testing/third_party/tlsf"
)
target_compile_features(ledip_tester PRIVATE cxx_std_20)
target_compile_definitions(ledip_tester PRIVATE
    LEDIP_NO_LOG=1
    LEDIP_TRACE=$<IF:$<OR:$<STREQUAL:${PROFILE},debug>,$<STREQUAL:${PROFILE},memory-check>>,1,0>
    LEDIP_ENABLE_DEBUG_STATE=$<IF:$<OR:$<STREQUAL:${PROFILE},debug>,$<STREQUAL:${PROFILE},memory-check>>,1,0>
    LEDIP_MEMORY_CHECK=$<IF:$<STREQUAL:${PROFILE},memory-check>,1,0>
)
set_target_properties(ledip_tester PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${OUTPUT}"
    OUTPUT_NAME "ledip_tester"
    SUFFIX ".js"
)

if(PROFILE STREQUAL "debug" OR PROFILE STREQUAL "memory-check")
    target_compile_options(ledip_tester PRIVATE -O1 -g)
    target_link_options(ledip_tester PRIVATE -O1 -g)
elseif(PROFILE STREQUAL "size")
    target_compile_options(ledip_tester PRIVATE -Oz -flto)
    target_link_options(ledip_tester PRIVATE -Oz -flto)
else()
    target_compile_options(ledip_tester PRIVATE -O3 -flto)
    target_link_options(ledip_tester PRIVATE -O3 -flto)
endif()

set(LEDIP_EXPORTED_FUNCTIONS
    _ledip_create
    _ledip_destroy
    _ledip_add_pattern
    _ledip_start
    _ledip_stop
    _ledip_set_time
    _ledip_update
    _ledip_run_batch
    _ledip_input_pointer
    _ledip_input_capacity
    _ledip_events_pointer
    _ledip_event_count
    _ledip_clear_events
    _ledip_state_pointer
    _ledip_active_page_pointer
    _ledip_memory_pointer
    _ledip_blocks_pointer
    _ledip_block_count
    _ledip_configure_failure
    _ledip_check_memory
    _ledip_stack_high_water
    _ledip_allocator_self_test
)
list(JOIN LEDIP_EXPORTED_FUNCTIONS "," LEDIP_EXPORTED_FUNCTIONS_CSV)

target_compile_options(ledip_tester PRIVATE -fno-builtin -fwasm-exceptions)
target_link_options(ledip_tester PRIVATE
    --no-entry
    -fwasm-exceptions
    -Wl,--allow-multiple-definition
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sENVIRONMENT=web,node,worker
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=16777216
    -sSTACK_SIZE=1048576
    -sMALLOC=none
    -sABORTING_MALLOC=0
    "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32"
    "-sEXPORTED_FUNCTIONS=${LEDIP_EXPORTED_FUNCTIONS_CSV}"
)

add_executable(ledip_empty empty.c)
set_target_properties(ledip_empty PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${OUTPUT}" OUTPUT_NAME "ledip_empty" SUFFIX ".js")
target_link_options(ledip_empty PRIVATE
    --no-entry
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sENVIRONMENT=web,node,worker
    -sINITIAL_MEMORY=16777216
    -sSTACK_SIZE=1048576
    "-sEXPORTED_FUNCTIONS=_ledip_empty"
)
if(PROFILE STREQUAL "size")
    target_compile_options(ledip_empty PRIVATE -Oz -flto)
    target_link_options(ledip_empty PRIVATE -Oz -flto)
else()
    target_compile_options(ledip_empty PRIVATE -O3 -flto)
    target_link_options(ledip_empty PRIVATE -O3 -flto)
endif()
