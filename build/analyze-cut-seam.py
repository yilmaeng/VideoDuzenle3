"""Read-only PCM comparison; does not modify input media or application code."""
import json
import subprocess
import sys
import numpy as np
from scipy.signal import correlate

RATE = 48000

def decode(filename):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', filename, '-t', '30',
                             '-vn', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                            capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)

source, edited = map(decode, sys.argv[1:3])

def match(t, length=0.1):
    clip = edited[round(t * RATE):round((t + length) * RATE)]
    n = len(clip)
    dots = correlate(source, clip, mode='valid', method='fft')
    energy = np.concatenate(([0.0], np.cumsum(source * source)))
    denominator = np.sqrt(np.maximum(energy[n:] - energy[:-n], 1e-20) * np.dot(clip, clip))
    scores = dots / np.maximum(denominator, 1e-20)
    index = int(np.argmax(scores))
    return {'output': round(t, 4), 'source': round(index / RATE, 6),
            'offset': round(index / RATE - t, 6), 'correlation': round(float(scores[index]), 5),
            'rms_db': round(float(20 * np.log10(np.sqrt(np.mean(clip * clip)) + 1e-15)), 2)}

def level(signal, t, length=0.001):
    clip = signal[round(t * RATE):round((t + length) * RATE)]
    return round(float(20 * np.log10(np.sqrt(np.mean(clip * clip)) + 1e-15)), 2)

if '--locate' in sys.argv:
    offset = round(match(10)['offset'] * RATE)
    start, end = round(7.5 * RATE), round(8.7 * RATE)
    left_error = (edited[start:end] - source[start:end]) ** 2
    right_error = (edited[start:end] - source[start+offset:end+offset]) ** 2
    costs = np.r_[0, np.cumsum(left_error)] + np.r_[np.cumsum(right_error[::-1])[::-1], 0]
    boundary = (start + int(np.argmin(costs))) / RATE
    print(json.dumps({'estimated_boundary': boundary, 'source_resume': boundary + offset/RATE,
                      'removed_seconds': offset/RATE,
                      'nearby_min_1ms_rms_db': min(level(edited, float(t)) for t in np.arange(boundary-.04, boundary+.04, .001)),
                      'matches': [match(t) for t in [1, 5, 10, 15]]}, indent=2))
    sys.exit(0)

print(json.dumps({'coarse': [match(t) for t in [1, 5, 8.2, 8.4, 10, 15]],
                  'fine': [{'output': round(float(t), 4),
                            'edited_db': level(edited, t),
                            'source_before_db': level(source, t),
                            'source_after_db': level(source, t + 8.464)}
                           for t in np.arange(8.300, 8.341, 0.001)]}, indent=2))
