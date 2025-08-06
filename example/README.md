# How to gen cmake and use clion

```shell
scons --menuconfig and press q to exit
pkgs --update
scons --target=cmake --project-name=led_i_example
clion .
```

# build

```shell
mkdir build
cd build 
cmake -G Ninja ..
ninja
```
