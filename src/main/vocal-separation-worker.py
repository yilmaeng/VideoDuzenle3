"""Offline Mel-Band worker. Heavy dependencies live in an optional runtime."""
import argparse
import json
import logging
import os
import time


def emit(**data):
    print('EVD_VOCAL:' + json.dumps(data), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--manifest')
    parser.add_argument('--output', required=True)
    parser.add_argument('--models', required=True)
    args = parser.parse_args()
    if args.manifest:
        with open(args.manifest, encoding='utf-8') as stream:
            jobs = json.load(stream)
    else:
        jobs = [{'input': args.input, 'output': args.output}]
    import torch
    import tqdm
    from audio_separator.separator import Separator

    # Instrument tqdm rather than parsing terminal percentages/locale-dependent ETA.
    original_update = tqdm.tqdm.update
    original_close = tqdm.tqdm.close
    started = time.monotonic()
    completed_weight = 0
    current_weight = 1
    total_weight = sum(job.get('weight', 1) for job in jobs)

    def report(bar):
        total = getattr(bar, 'total', 0) or 0
        done = getattr(bar, 'n', 0)
        if total > 0 and done > 0:
            elapsed = time.monotonic() - started
            fraction = min(1, (completed_weight + current_weight * done / total) / total_weight)
            emit(stage='separating', percent=fraction * 100,
                 remainingSeconds=max(0, elapsed / fraction * (1-fraction)))

    def update(bar, n=1):
        result = original_update(bar, n)
        report(bar)
        return result

    def close(bar):
        report(bar)
        return original_close(bar)

    tqdm.tqdm.update = update
    tqdm.tqdm.close = close
    torch.set_num_threads(min(4, max(1, (os.cpu_count() or 2) // 2)))
    emit(stage='loading')
    model = 'mel_band_roformer_instrumental_becruily.ckpt'
    config = 'config_mel_band_roformer_instrumental_becruily.yaml'
    for name in (model, config):
        if not os.path.isfile(os.path.join(args.models, name)):
            raise RuntimeError('vocal_engine_incomplete')
    class OfflineSeparator(Separator):
        def download_model_files(self, model_filename):
            if model_filename != model:
                raise RuntimeError('unexpected_model')
            self.model_is_uvr_vip = False
            self.model_friendly_name = 'Mel-Band RoFormer Instrumental (becruily)'
            return (model, 'MDXC', self.model_friendly_name, os.path.join(args.models, model), config)

        def download_file_if_not_exists(self, url, output_path):
            if not os.path.isfile(output_path):
                raise RuntimeError('vocal_engine_incomplete')

    separator = OfflineSeparator(model_file_dir=args.models, output_dir=args.output,
                          output_format='WAV', use_soundfile=True,
                          log_level=logging.WARNING, normalization_threshold=1.0,
                          amplification_threshold=0.0,
                          mdxc_params={'segment_size': 256, 'override_model_segment_size': False,
                                       'batch_size': 1, 'overlap': 4, 'pitch_shift': 0})
    separator.load_model(model_filename=model)
    started = time.monotonic()
    emit(stage='separating', percent=0)
    outputs = []
    for job in jobs:
        current_weight = job.get('weight', 1)
        separator.output_dir = job['output']
        separator.model_instance.output_dir = job['output']
        outputs.extend(separator.separate(job['input']))
        completed_weight += current_weight
    emit(stage='separated', outputs=outputs, seconds=time.monotonic() - started)


if __name__ == '__main__':
    main()
