"""Stateful, bounded-memory GTCRN recording cleanup. Never modifies the source."""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("model")
parser.add_argument("source")
parser.add_argument("output")
args = parser.parse_args()
config = sherpa_onnx.OnlineSpeechDenoiserConfig(
    model=sherpa_onnx.OfflineSpeechDenoiserModelConfig(
        gtcrn=sherpa_onnx.OfflineSpeechDenoiserGtcrnModelConfig(model=args.model),
        num_threads=1, provider="cpu",
    )
)
assert config.validate()
assert not Path(args.output).exists(), "Output already exists"
denoiser = sherpa_onnx.OnlineSpeechDenoiser(config)
start = time.perf_counter()
written = 0
with sf.SoundFile(args.source) as source:
    assert source.channels == 1 and source.samplerate == denoiser.sample_rate
    # RF64 also supports recordings exceeding the ordinary WAV 4 GiB limit.
    with sf.SoundFile(args.output, mode="w", samplerate=denoiser.sample_rate,
                      channels=1, format="RF64", subtype="FLOAT") as output:
        def write(result):
            global written
            audio = np.asarray(result.samples)
            assert np.isfinite(audio).all()
            output.write(audio)
            written += len(audio)

        for block in source.blocks(blocksize=16000, dtype="float32"):
            # One persistent model: resetting per block creates audible seams.
            write(denoiser(np.ascontiguousarray(block), source.samplerate))
        write(denoiser.flush())
    assert abs(written - source.frames) <= source.samplerate * 0.05
print(json.dumps({"output_seconds": written / denoiser.sample_rate,
                  "elapsed_seconds": time.perf_counter() - start}))
