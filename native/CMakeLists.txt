cmake_minimum_required(VERSION 3.22)
project(solar_nam_native LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(solar_nam_native INTERFACE)
target_include_directories(solar_nam_native INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
# Oboe and the concrete NAM implementation are linked by the Android host layer.
