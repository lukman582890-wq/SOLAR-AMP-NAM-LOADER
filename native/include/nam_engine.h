#pragma once
#include <cstddef>
#include <cstdint>
namespace solar {
enum class Architecture { Unknown, A1, A2 };
struct ModelInfo { Architecture architecture{Architecture::Unknown}; uint32_t sample_rate{48000}; const char* name{nullptr}; };
class NamEngine {
public:
 virtual ~NamEngine()=default;
 virtual bool load(const uint8_t* data,size_t size,ModelInfo* info)=0;
 virtual void reset()=0;
 virtual void process(const float* input,float* output,size_t frames)=0;
};
}