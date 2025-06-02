CMAKE_MINIMUM_REQUIRED(VERSION 3.10)

SET(CMAKE_SYSTEM_NAME Generic)
SET(CMAKE_SYSTEM_PROCESSOR cortex-m7)
#SET(CMAKE_VERBOSE_MAKEFILE ON)

SET(CMAKE_EXPORT_COMPILE_COMMANDS ON)

SET(CMAKE_C_COMPILER "C:/Softwares/xpack-arm-none-eabi-gcc-12.2.1-1.2/bin/arm-none-eabi-gcc.exe")
SET(CMAKE_ASM_COMPILER "C:/Softwares/xpack-arm-none-eabi-gcc-12.2.1-1.2/bin/arm-none-eabi-gcc.exe")
SET(CMAKE_C_FLAGS " -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard -ffunction-sections -fdata-sections -Dgcc -Werror=return-type -O2 -g -std=gnu11")
SET(CMAKE_ASM_FLAGS " -c -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard -ffunction-sections -fdata-sections -x assembler-with-cpp -Wa,-mimplicit-it=thumb ")
SET(CMAKE_C_COMPILER_WORKS TRUE)

SET(CMAKE_CXX_COMPILER "C:/Softwares/xpack-arm-none-eabi-gcc-12.2.1-1.2/bin/arm-none-eabi-g++.exe")
SET(CMAKE_CXX_FLAGS " -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard -ffunction-sections -fdata-sections -Dgcc -Werror=return-type -O2 -g -std=gnu++20 -fno-rtti -fno-exceptions -fno-exceptions -fno-rtti -ffunction-sections -fdata-sections -Wl,--gc-sections")
SET(CMAKE_CXX_COMPILER_WORKS TRUE)

SET(CMAKE_OBJCOPY "C:/Softwares/xpack-arm-none-eabi-gcc-12.2.1-1.2/bin/arm-none-eabi-objcopy.exe")
SET(CMAKE_SIZE "C:/Softwares/xpack-arm-none-eabi-gcc-12.2.1-1.2/bin/arm-none-eabi-size.exe")

SET(CMAKE_EXE_LINKER_FLAGS " -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard -ffunction-sections -fdata-sections -Wl,--gc-sections,-Map=rtthread.map,-cref,-u,Reset_Handler -T ${CMAKE_SOURCE_DIR}/board/linker_scripts/link.lds -Wl,--gc-sections,--print-memory-usage")

SET(CMAKE_C_STANDARD 11)
SET(CMAKE_CXX_STANDARD 20)

PROJECT(LEDIndicatorPPExample C CXX ASM)

INCLUDE_DIRECTORIES(
	.
	3rdparty/magic_enum-master/include/magic_enum
	applications
	board
	board/CubeMX_Config/Inc
	board/port
	..
	../src
	packages/CMSIS-Core-latest/Include
	packages/stm32h7_cmsis_driver-latest/Include
	packages/stm32h7_hal_driver-latest/Inc
	packages/stm32h7_hal_driver-latest/Inc/Legacy
	rt-thread/include
	rt-thread/libcpu/arm/common
	rt-thread/libcpu/arm/cortex-m7
	rt-thread/components/dfs/dfs_v1/include
	rt-thread/components/dfs/dfs_v1/filesystems/devfs
	rt-thread/components/drivers/include
	rt-thread/components/drivers/phy
	rt-thread/components/drivers/smp_call
	rt-thread/components/drivers/spi
	rt-thread/components/drivers/spi/sfud/inc
	rt-thread/components/fal/inc
	rt-thread/components/finsh
	rt-thread/components/libc/compilers/common/include
	rt-thread/components/libc/compilers/newlib
	rt-thread/components/libc/cplusplus
	rt-thread/components/libc/cplusplus/os
	rt-thread/components/libc/posix/io/epoll
	rt-thread/components/libc/posix/io/eventfd
	rt-thread/components/libc/posix/io/poll
	rt-thread/components/libc/posix/ipc
	rt-thread/components/utilities/ulog
	libraries/HAL_Drivers/drivers
	libraries/HAL_Drivers/drivers/config
	libraries/HAL_Drivers/drivers/drv_flash
	libraries/HAL_Drivers
)

ADD_DEFINITIONS(
	-DSTM32H750xx
	-DUSE_HAL_DRIVER
	-D__RTTHREAD__
	-DRT_USING_NEWLIBC
	-DRT_USING_LIBC
	-D_POSIX_C_SOURCE=1
)

# Library source files
SET(RT_APPLICATIONS_SOURCES
	applications/led_i_gpio.cpp
	applications/main.cpp
)

SET(RT_CMSIS-CORE_SOURCES
)

SET(RT_COMPILER_SOURCES
	rt-thread/components/libc/compilers/common/cctype.c
	rt-thread/components/libc/compilers/common/cstdlib.c
	rt-thread/components/libc/compilers/common/cstring.c
	rt-thread/components/libc/compilers/common/ctime.c
	rt-thread/components/libc/compilers/common/cunistd.c
	rt-thread/components/libc/compilers/common/cwchar.c
	rt-thread/components/libc/compilers/newlib/syscalls.c
)

SET(RT_CPP_SOURCES
	rt-thread/components/libc/cplusplus/cxx_crt.cpp
	rt-thread/components/libc/cplusplus/cxx_crt_init.c
	rt-thread/components/libc/cplusplus/os/cxx_Mutex.cpp
	rt-thread/components/libc/cplusplus/os/cxx_Semaphore.cpp
	rt-thread/components/libc/cplusplus/os/cxx_Thread.cpp
)

SET(RT_DEVICEDRIVERS_SOURCES
	rt-thread/components/drivers/core/device.c
	rt-thread/components/drivers/ipc/completion_comm.c
	rt-thread/components/drivers/ipc/completion_up.c
	rt-thread/components/drivers/ipc/condvar.c
	rt-thread/components/drivers/ipc/dataqueue.c
	rt-thread/components/drivers/ipc/pipe.c
	rt-thread/components/drivers/ipc/ringblk_buf.c
	rt-thread/components/drivers/ipc/ringbuffer.c
	rt-thread/components/drivers/ipc/waitqueue.c
	rt-thread/components/drivers/ipc/workqueue.c
	rt-thread/components/drivers/misc/rt_drv_pwm.c
	rt-thread/components/drivers/mtd/mtd_nor.c
	rt-thread/components/drivers/pin/dev_pin.c
	rt-thread/components/drivers/serial/dev_serial_v2.c
	rt-thread/components/drivers/spi/dev_qspi_core.c
	rt-thread/components/drivers/spi/dev_spi.c
	rt-thread/components/drivers/spi/dev_spi_core.c
	rt-thread/components/drivers/spi/dev_spi_flash_sfud.c
	rt-thread/components/drivers/spi/sfud/src/sfud.c
	rt-thread/components/drivers/spi/sfud/src/sfud_sfdp.c
)

SET(RT_DRIVERS_SOURCES
	board/CubeMX_Config/Src/stm32h7xx_hal_msp.c
	board/board.c
	libraries/HAL_Drivers/drivers/drv_flash/drv_flash_h7.c
	libraries/HAL_Drivers/drivers/drv_gpio.c
	libraries/HAL_Drivers/drivers/drv_qspi.c
	libraries/HAL_Drivers/drivers/drv_spi.c
	libraries/HAL_Drivers/drivers/drv_usart_v2.c
	libraries/HAL_Drivers/drv_common.c
)

SET(RT_FAL_SOURCES
	rt-thread/components/fal/src/fal_partition.c
	rt-thread/components/fal/samples/porting/fal_flash_sfud_port.c
	rt-thread/components/fal/src/fal.c
	rt-thread/components/fal/src/fal_rtt.c
	rt-thread/components/fal/src/fal_flash.c
)

SET(RT_FILESYSTEM_SOURCES
	rt-thread/components/dfs/dfs_v1/filesystems/devfs/devfs.c
	rt-thread/components/dfs/dfs_v1/src/dfs.c
	rt-thread/components/dfs/dfs_v1/src/dfs_file.c
	rt-thread/components/dfs/dfs_v1/src/dfs_fs.c
	rt-thread/components/dfs/dfs_v1/src/dfs_posix.c
)

SET(RT_FINSH_SOURCES
	rt-thread/components/finsh/msh_parse.c
	rt-thread/components/finsh/shell.c
	rt-thread/components/finsh/msh.c
	rt-thread/components/finsh/msh_file.c
	rt-thread/components/finsh/cmd.c
)

SET(RT_KERNEL_SOURCES
	rt-thread/src/clock.c
	rt-thread/src/components.c
	rt-thread/src/cpu_up.c
	rt-thread/src/defunct.c
	rt-thread/src/idle.c
	rt-thread/src/ipc.c
	rt-thread/src/irq.c
	rt-thread/src/kservice.c
	rt-thread/src/memheap.c
	rt-thread/src/mempool.c
	rt-thread/src/object.c
	rt-thread/src/scheduler_comm.c
	rt-thread/src/scheduler_up.c
	rt-thread/src/thread.c
	rt-thread/src/timer.c
)

SET(RT_KLIBC_SOURCES
	rt-thread/src/klibc/rt_vsnprintf_tiny.c
	rt-thread/src/klibc/kstdio.c
	rt-thread/src/klibc/kerrno.c
	rt-thread/src/klibc/rt_vsscanf.c
	rt-thread/src/klibc/kstring.c
)

SET(RT_LEDINDICATORPP_SOURCES
	../src/driver/LEDDriver_GPIO.cpp
	../src/driver/LEDDriver_RGB_GPIO.cpp
)

SET(RT_LIBCPU_SOURCES
	rt-thread/libcpu/arm/common/atomic_arm.c
	rt-thread/libcpu/arm/common/div0.c
	rt-thread/libcpu/arm/common/showmem.c
	rt-thread/libcpu/arm/cortex-m7/context_gcc.S
	rt-thread/libcpu/arm/cortex-m7/cpu_cache.c
	rt-thread/libcpu/arm/cortex-m7/cpuport.c
)

SET(RT_MAGIC_ENUM_SOURCES
)

SET(RT_POSIX_SOURCES
)

SET(RT_STM32H7-CMSIS_SOURCES
	packages/stm32h7_cmsis_driver-latest/Source/Templates/system_stm32h7xx.c
	packages/stm32h7_cmsis_driver-latest/Source/Templates/gcc/startup_stm32h750xx.s
)

SET(RT_STM32H7-HAL_SOURCES
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_flash.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_uart_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_tim.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_crc.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_cec.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_cryp.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_rcc_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_pwr.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_lptim.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_rcc.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_crc_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_sram.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_tim_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_spi.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_nor.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_cortex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_usart.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_comp.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_dma_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_flash_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_cryp_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_uart.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_rng.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_pwr_ex.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_dma.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_qspi.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_gpio.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal.c
	packages/stm32h7_hal_driver-latest/Src/stm32h7xx_hal_mdma.c
)

SET(RT_UTESTCASES_SOURCES
)

SET(RT_UTILITIES_SOURCES
	rt-thread/components/utilities/ulog/backend/console_be.c
	rt-thread/components/utilities/ulog/ulog.c
)

# Library search paths
# Library local macro definitions
SET(RT_DEVICEDRIVERS_DEFINES
	__RT_IPC_SOURCE__
)

SET(RT_KERNEL_DEFINES
	__RT_KERNEL_SOURCE__
)

# Library dependencies
SET(RT_COMPILER_LIBS
	c
	m
)

# Libraries
ADD_LIBRARY(rtt_Compiler OBJECT ${RT_COMPILER_SOURCES})
ADD_LIBRARY(rtt_CPP OBJECT ${RT_CPP_SOURCES})
ADD_LIBRARY(rtt_DeviceDrivers OBJECT ${RT_DEVICEDRIVERS_SOURCES})
ADD_LIBRARY(rtt_Drivers OBJECT ${RT_DRIVERS_SOURCES})
ADD_LIBRARY(rtt_Fal OBJECT ${RT_FAL_SOURCES})
ADD_LIBRARY(rtt_Filesystem OBJECT ${RT_FILESYSTEM_SOURCES})
ADD_LIBRARY(rtt_Finsh OBJECT ${RT_FINSH_SOURCES})
ADD_LIBRARY(rtt_Kernel OBJECT ${RT_KERNEL_SOURCES})
ADD_LIBRARY(rtt_klibc OBJECT ${RT_KLIBC_SOURCES})
ADD_LIBRARY(rtt_LEDIndicatorPP OBJECT ${RT_LEDINDICATORPP_SOURCES})
ADD_LIBRARY(rtt_libcpu OBJECT ${RT_LIBCPU_SOURCES})
ADD_LIBRARY(rtt_STM32H7-CMSIS OBJECT ${RT_STM32H7-CMSIS_SOURCES})
ADD_LIBRARY(rtt_STM32H7-HAL OBJECT ${RT_STM32H7-HAL_SOURCES})
ADD_LIBRARY(rtt_Utilities OBJECT ${RT_UTILITIES_SOURCES})

# Interface libraries
ADD_LIBRARY(rtt_CMSIS-Core INTERFACE)
ADD_LIBRARY(rtt_magic_enum INTERFACE)
ADD_LIBRARY(rtt_POSIX INTERFACE)
ADD_LIBRARY(rtt_utestcases INTERFACE)

# Private macros
TARGET_COMPILE_DEFINITIONS(rtt_DeviceDrivers PRIVATE ${RT_DEVICEDRIVERS_DEFINES})
TARGET_COMPILE_DEFINITIONS(rtt_Kernel PRIVATE ${RT_KERNEL_DEFINES})

# Interface library search paths
TARGET_LINK_LIBRARIES(rtt_Compiler INTERFACE ${RT_COMPILER_LIBS})

ADD_EXECUTABLE(${CMAKE_PROJECT_NAME}.elf ${RT_APPLICATIONS_SOURCES})
TARGET_LINK_LIBRARIES(${CMAKE_PROJECT_NAME}.elf
	rtt_Compiler
	rtt_CPP
	rtt_DeviceDrivers
	rtt_Drivers
	rtt_Fal
	rtt_Filesystem
	rtt_Finsh
	rtt_Kernel
	rtt_klibc
	rtt_LEDIndicatorPP
	rtt_libcpu
	rtt_STM32H7-CMSIS
	rtt_STM32H7-HAL
	rtt_Utilities
	rtt_CMSIS-Core
	rtt_magic_enum
	rtt_POSIX
	rtt_utestcases
)

ADD_CUSTOM_COMMAND(TARGET ${CMAKE_PROJECT_NAME}.elf POST_BUILD 
	COMMAND ${CMAKE_OBJCOPY} -O binary ${CMAKE_PROJECT_NAME}.elf rtthread.bin
	COMMAND ${CMAKE_SIZE} ${CMAKE_PROJECT_NAME}.elf
)

# if custom.cmake is exist, add it
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/custom.cmake)
include(${CMAKE_CURRENT_SOURCE_DIR}/custom.cmake)
endif()
