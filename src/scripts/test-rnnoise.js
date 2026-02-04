const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

// 1. Setup FFmpeg path (Mimic app behavior or default)
try {
    let ffmpegPath;
    try {
        ffmpegPath = require('ffmpeg-static');
    } catch (e) {
        // Try the project dependency
        ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    }

    if (ffmpegPath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        console.log('Using ffmpeg path:', ffmpegPath);
    } else {
        throw new Error('No ffmpeg path found in modules');
    }
} catch (e) {
    console.log('Explicit ffmpeg path not found in modules, relying on system PATH');
}

// 2. Prepare RNNoise Model (Same logic as current failure)
const modelUrl = 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/conjoined-burgers-2018-08-28/cb.rnnn';
const tempModelPath = path.join(os.tmpdir(), 'cb-test.rnnn');

async function downloadModel() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(tempModelPath)) {
            const stats = fs.statSync(tempModelPath);
            if (stats.size > 1000) {
                console.log('Model exists and seems valid (size:', stats.size, ') at:', tempModelPath);
                resolve(tempModelPath);
                return;
            }
            console.log('Model exists but is too small (invalid). Deleting and redownloading...');
            fs.unlinkSync(tempModelPath);
        }

        console.log('Downloading model...');
        const file = fs.createWriteStream(tempModelPath);
        https.get(modelUrl, (response) => {
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(tempModelPath, () => { }); // Delete partial
                reject(new Error(`Download failed with status code: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                // Verify size after download
                const stats = fs.statSync(tempModelPath);
                if (stats.size < 1000) {
                    fs.unlinkSync(tempModelPath);
                    reject(new Error('Downloaded file is too small'));
                    return;
                }
                console.log('Model downloaded successfully:', tempModelPath);
                resolve(tempModelPath);
            });
        }).on('error', (err) => {
            fs.unlink(tempModelPath, () => { });
            reject(err);
        });
    });
}

// 3. Create Dummy Audio
const dummyInput = path.join(os.tmpdir(), 'dummy_input.wav');
const dummyOutput = path.join(os.tmpdir(), 'dummy_output.wav');

function createDummyAudio() {
    return new Promise((resolve, reject) => {
        // Generate 1 second silence/sine using ffmpeg
        ffmpeg()
            .input('anullsrc=r=48000:cl=stereo')
            .inputFormat('lavfi')
            .duration(1)
            .save(dummyInput)
            .on('end', () => {
                console.log('Dummy input created:', dummyInput);
                resolve(dummyInput);
            })
            .on('error', reject);
    });
}

// 4. Test RNNoise
async function testVariant(name, modelPathString) {
    return new Promise((resolve) => {
        console.log(`\n--- Testing ${name} ---`);
        console.log(`Filter string: arnndn=m=${modelPathString}`);

        ffmpeg(dummyInput)
            .audioFilters([
                'aresample=48000',
                'aformat=channel_layouts=stereo',
                `arnndn=m=${modelPathString}`
            ])
            .save(dummyOutput) // Overwrite is fine
            .on('start', (commandLine) => {
                console.log('Spawned Ffmpeg with command:', commandLine);
            })
            .on('end', () => {
                console.log(`✅ SUCCESS with ${name}`);
                resolve(true);
            })
            .on('error', (err) => {
                console.log(`❌ FAILED ${name}:`);
                console.log(err.message);
                if (err.stderr) console.log('STDERR:', err.stderr);
                resolve(false);
            });
    });
}

function checkFilterSupport() {
    return new Promise((resolve) => {
        ffmpeg.getAvailableFilters((err, filters) => {
            if (err) {
                console.error('Could not query filters:', err.message);
                resolve(false);
            } else {
                if (filters.arnndn) {
                    console.log('✅ arnndn filter is detected in this FFmpeg build.');
                    resolve(true);
                } else {
                    console.warn('⚠️ WARNING: arnndn filter NOT detected in this FFmpeg build!');
                    console.warn('This is likely the cause of failure. You need a custom FFmpeg build with --enable-librnnoise.');
                    resolve(false);
                }
            }
        });
    });
}



async function runTest() {
    try {
        await checkFilterSupport();
        await downloadModel();
        await createDummyAudio();

        const base = tempModelPath.replace(/\\/g, '/');

        // Variant 5: Relative Path (Changing CWD) - MOST LIKELY TO WORK
        // This avoids colons in the filter string entirely.
        console.log('\n--- Testing Variant 5 (Relative Path via process.chdir) ---');
        const originalCwd = process.cwd();
        const tempDir = path.dirname(tempModelPath);
        const modelFilename = path.basename(tempModelPath);

        try {
            console.log(`Changing CWD to: ${tempDir}`);
            process.chdir(tempDir);

            // We use the filename directly. 
            // Note: We need to use valid paths for input/output even if CWD changed, 
            // but since dummyInput/Output are absolute, they are fine.
            if (await testVariant('Variant 5 (Relative Path)', modelFilename)) {
                console.log('!!! Variant 5 SUCCEEDED! This is the fix.');
                process.chdir(originalCwd);
                return;
            }
        } catch (err) {
            console.error('Variant 5 Error:', err);
        } finally {
            process.chdir(originalCwd);
        }

        // Variant 1: Escaped colon and space
        const v1 = base.replace(/:/g, '\\:').replace(/ /g, '\\ ');
        if (await testVariant('Variant 1 (Escaped Colon)', v1)) return;

        // Variant 2: Single Quotes
        const v2 = `'${base}'`;
        if (await testVariant('Variant 2 (Single Quotes)', v2)) return;

        // Variant 3: No Escape
        const v3 = base;
        if (await testVariant('Variant 3 (Simple Forward Slash)', v3)) return;

        // Variant 4: Double Quotes
        const v4 = `"${base}"`;
        if (await testVariant('Variant 4 (Double Quotes)', v4)) return;

    } catch (e) {
        console.error('Test Setup Failed:', e);
    }
}

runTest();
