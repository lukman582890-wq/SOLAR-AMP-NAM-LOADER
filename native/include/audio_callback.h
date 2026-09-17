#pragma once
#include <cstdint>
namespace solar {
struct AudioStats { double processing_us{0}; uint32_t underruns{0}; uint32_t sample_rate{48000}; uint32_t frames_per_callback{0}; };
class RealtimeAudio {
public: virtual ~RealtimeAudio()=default;
 virtual bool start(uint32_t sample_rate,uint32_t frames_per_callback)=0;
 virtual void stop()=0;
 virtual AudioStats stats() const=0;
};
}