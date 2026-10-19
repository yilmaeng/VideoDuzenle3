"""Isolated cut experiments; no production source changes."""
import json
import subprocess
from pathlib import Path
import numpy as np

SOURCE = Path('D:/Downloads/EES/Ay\u015feg\u00fcl.mp4')
OUT = Path(__file__).resolve().parents[1] / 'test-results' / 'cut-seam-experiment'
OUT.mkdir(parents=True, exist_ok=True)
RATE = 48000
FFMPEG = subprocess.check_output(['node', '-p', "require('@ffmpeg-installer/ffmpeg').path"],
                                 text=True).strip()

def run(args):
    p = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y'] + args,
                       capture_output=True, check=False)
    if p.returncode:
        raise RuntimeError(p.stderr.decode('utf8', errors='replace'))
    return p.stdout

def decode(file):
    return np.frombuffer(run(['-i', str(file), '-t', '40', '-vn', '-f', 'f32le', '-']),
                         dtype='<f4').reshape(-1, 2)

source = decode(SOURCE)
cases = {
    'reported-nearby': [(0, 8.309333), (16.797333, 21)],
    'integer-8-to-16': [(0, 8), (16, 20)],
    'fractional-5': [(0, 5.137), (10.283, 15)],
    'fractional-12': [(0, 12.517), (20.119, 25)],
    'thirty-cuts': [(i * .431, i * .431 + .213) for i in range(31)],
}
report = {}
for name, spans in cases.items():
    expected = np.concatenate([source[round(a * RATE):round(b * RATE)] for a, b in spans])
    result = {'expected_samples': len(expected), 'segments': spans, 'methods': {}}
    for method in ['existing-av-concat', 'continuous-audio']:
        filters = []
        for i, (a, b) in enumerate(spans):
            if method == 'existing-av-concat':
                filters += [f'[0:v]trim={a}:{b},setpts=PTS-STARTPTS[v{i}]',
                            f'[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,apad,atrim=0:{b-a},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a{i}]']
            else:
                filters += [f'[0:a]atrim=start_sample={round(a*RATE)}:end_sample={round(b*RATE)},asetpts=N/SR/TB[a{i}]']
        if method == 'existing-av-concat':
            filters += [''.join(f'[v{i}][a{i}]' for i in range(len(spans))) +
                        f'concat=n={len(spans)}:v=1:a=1:unsafe=1[v][audio]', '[v]nullsink']
        else:
            filters += [''.join(f'[a{i}]' for i in range(len(spans))) +
                        f'concat=n={len(spans)}:v=0:a=1,asetpts=N/SR/TB[audio]']
        script = OUT / f'{name}-{method}.filter.txt'
        script.write_text(';\n'.join(filters), encoding='utf8')
        file = OUT / f'{name}-{method}.wav'
        run(['-i', str(SOURCE), '-filter_complex_script', str(script),
             '-map', '[audio]', '-c:a', 'pcm_f32le', str(file)])
        audio = decode(file)
        zeros = np.all(audio == 0, axis=1)
        edges = np.diff(np.r_[False, zeros, False].astype(int))
        runs = [(int(a), int(b)) for a, b in zip(np.where(edges == 1)[0], np.where(edges == -1)[0])
                if b-a >= 48]
        result['methods'][method] = {
            'samples': len(audio), 'extra_ms': (len(audio)-len(expected))*1000/RATE,
            'identical_to_reference': bool(np.array_equal(audio, expected)),
            'zero_runs_over_1ms': [{'start': a/RATE, 'duration_ms': (b-a)*1000/RATE} for a,b in runs],
        }
    report[name] = result
    print(name, json.dumps(result['methods']), flush=True)

# Listen without AAC differences masking the comparison; then check one MP4 delivery path.
spans = cases['reported-nearby']
filters = [f'[0:v]trim={a}:{b},setpts=PTS-STARTPTS[v{i}]' for i,(a,b) in enumerate(spans)]
filters += ['[v0][v1]concat=n=2:v=1:a=0,setpts=N/(30*TB)[video]']
script = OUT / 'continuous-preview.filter.txt'
script.write_text(';\n'.join(filters), encoding='utf8')
mp4 = OUT / 'continuous-preview.mp4'
run(['-i', str(SOURCE), '-i', str(OUT / 'reported-nearby-continuous-audio.wav'),
     '-filter_complex_script', str(script), '-map', '[video]', '-map', '1:a',
     '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-r', '30',
     '-c:a', 'aac', '-aac_coder', 'twoloop', '-profile:a', 'aac_low', '-b:a', '320k',
     '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(mp4)])
probe = subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(mp4)])
streams = json.loads(probe)['streams']
report['mp4'] = [{k: s.get(k) for k in ['codec_type', 'codec_name', 'sample_rate', 'channels', 'start_time', 'duration']} for s in streams]
report['ffmpeg'] = FFMPEG
for method in ['existing-av-concat', 'continuous-audio']:
    run(['-i', str(OUT / f'reported-nearby-{method}.wav'), '-af', 'atrim=start=6:end=11,asetpts=PTS-STARTPTS',
         '-c:a', 'pcm_s24le', str(OUT / f'listen-{method}.wav')])
encoded = decode(mp4)
near = encoded[round(8.29*RATE):round(8.35*RATE)]
windows = near[:(len(near)//48)*48].reshape(-1,48,2)
report['mp4_seam_min_1ms_rms_db'] = float(20*np.log10(np.sqrt(np.mean(windows.astype(float)**2, axis=(1,2))).min()+1e-15))
(OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report['mp4']), flush=True)
