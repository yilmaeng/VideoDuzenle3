import argparse
import audioop
import json
import math
import wave


def read_energy(audio_path, frame_duration=0.05):
    try:
        with wave.open(str(audio_path), "rb") as source:
            sample_width = source.getsampwidth()
            frame_count = max(1, int(source.getframerate() * frame_duration))
            values = []
            while True:
                data = source.readframes(frame_count)
                if not data:
                    break
                rms = audioop.rms(data, sample_width)
                values.append(20 * math.log10(max(1, rms) / float(1 << (sample_width * 8 - 1))))
            return {"frameDuration": frame_duration, "values": values}
    except (OSError, EOFError, wave.Error):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("output")
    parser.add_argument("--language", default="tr")
    parser.add_argument("--model", default="medium")
    parser.add_argument("--source-mode", choices=("separated", "original"), default="separated")
    args = parser.parse_args()

    from lyric_align.asr import transcribe
    from lyric_align.separate import separate_vocals

    if args.source_mode == "separated":
        print("EVD_STAGE:separating", flush=True)
        vocal_path = separate_vocals(args.audio)
    else:
        vocal_path = args.audio
    print("EVD_STAGE:transcribing", flush=True)
    segments = transcribe(
        vocal_path,
        language=args.language,
        model_size=args.model,
        device="cpu",
        vad=False,
    )

    result = {
        "vocalPath": str(vocal_path),
        "energy": read_energy(vocal_path),
        "segments": [
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "words": [
                    {"start": word.start, "end": word.end, "word": word.word}
                    for word in segment.words
                ],
            }
            for segment in segments
        ],
    }
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False)
    print("EVD_STAGE:aligning", flush=True)


if __name__ == "__main__":
    main()
