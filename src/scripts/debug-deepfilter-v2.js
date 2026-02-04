const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Paths
const deepFilterBin = path.join(__dirname, '../resources/deepfilter/deep-filter.exe');
const onnxModel = path.join(__dirname, '../resources/deepfilter/DeepFilterNet3_onnx.tar.gz');
const testWav = path.join(__dirname, 'debug_audio_v2.wav');

console.log('--- Debug DeepFilter V3 ---');
console.log('Bin:', deepFilterBin);
console.log('Model:', onnxModel);
console.log('Bin Exists:', fs.existsSync(deepFilterBin));
console.log('Model Exists:', fs.existsSync(onnxModel));

// 1. Check version/help
console.log('\n[1] Check --version');
const v = spawn(deepFilterBin, ['--version']);
v.stdout.on('data', d => console.log('Version:', d.toString().trim()));
v.stderr.on('data', d => console.log('Version Err:', d.toString().trim()));

v.on('close', (code) => {
    console.log('Version check done, code:', code);
    if (code !== 0) return;

    // 2. Generate dummy file
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath) { console.log('No ffmpeg-static'); return; }

    console.log('\n[2] Generating dummy audio:', testWav);
    const gen = spawn(ffmpegPath, [
        '-y', '-f', 'lavfi', '-i', 'sine=f=1000:d=2',
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le',
        testWav
    ]);

    gen.on('close', (gCode) => {
        if (gCode !== 0) { console.error('Failed to gen audio'); return; }

        const beforeStats = fs.statSync(testWav);
        console.log('Audio created. Size:', beforeStats.size, 'MTime:', beforeStats.mtime.toISOString());

        const filesBefore = fs.readdirSync(__dirname);

        console.log('\n[3] Running dry-run processing...');
        // Note: Using -o __dirname might overwrite if it doesn't append suffix?
        const args = ['-v', '-m', onnxModel, testWav, '-o', __dirname];
        console.log('CMD:', deepFilterBin, args.join(' '));

        const df = spawn(deepFilterBin, args, { cwd: __dirname });

        df.stdout.on('data', d => console.log('STDOUT:', d.toString().trim()));
        df.stderr.on('data', d => console.log('STDERR:', d.toString().trim()));

        df.on('close', (dfCode) => {
            console.log('DeepFilter process code:', dfCode);

            const filesAfter = fs.readdirSync(__dirname);
            const newFiles = filesAfter.filter(f => !filesBefore.includes(f));

            console.log('\n--- Analysis ---');
            if (newFiles.length > 0) {
                console.log('SUCCESS: New files created:', newFiles);
            } else {
                console.log('No new files created.');
                // Check if input was modified
                const afterStats = fs.statSync(testWav);
                if (afterStats.mtime.getTime() !== beforeStats.mtime.getTime()) {
                    console.log('SUCCESS (Overwrite): Input file was modified/overwritten.');
                    console.log('Before MTime:', beforeStats.mtime.toISOString());
                    console.log('After MTime: ', afterStats.mtime.toISOString());
                } else {
                    console.log('FAILURE: Input file not modified and no new files.');
                }
            }
        });
    });
});
