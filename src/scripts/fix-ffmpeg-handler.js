
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../main/ffmpeg-handler.js');
let content = fs.readFileSync(filePath, 'utf-8');

// The marker where the code is broken
const startMarker = '.outputOptions(outputOptions)';
const endMarker = "if (typeof module !== 'undefined' && module.exports) {";

const replacementCode = `.outputOptions(outputOptions)
            .output(outputPath)
            .on('progress', (p) => {
                if (onProgress) onProgress(p.percent);
            })
            .on('stderr', (line) => console.log('FFmpeg Log:', line))
            .on('error', (err, stdout, stderr) => {
                console.error('FFmpeg Error:', err.message);
                reject(new Error(\`FFmpeg Failed: \${err.message}\nLog: \${stderr || 'Check console'}\`));
            })
            .on('end', () => resolve({ success: true }));

        cmd.run();
    });
}

/**
 * Preview for Vertical Video (Short duration)
 */
async function createVerticalVideoPreview(inputPath, outputPath, options) {
    const startOffset = 5;
    const duration = options.duration || 5;

    const { format, method, settings } = options;
    let targetW = 1080, targetH = 1920;
    if (format === '4:5') targetH = 1350;
    else if (format === '1:1') targetH = 1080;

    let filterComplex = '';

    if (method === 'blur') {
        const sigma = settings && settings.sigma ? settings.sigma : 18;
        const brightness = settings && settings.brightness ? (settings.brightness - 100) / 100 : 0;
        const scale = settings && settings.scale ? settings.scale / 100 : 1.0;

        let bg = \`[0:v]scale=\${targetW}:\${targetH}:force_original_aspect_ratio=increase,crop=\${targetW}:\${targetH}:(iw-ow)/2:(ih-oh)/2,boxblur=luma_radius=\${sigma}:luma_power=2\`;
        if (brightness !== 0) bg += \`,eq=brightness=\${brightness}\`;
        bg += \`[bg];\`;
        let fg = \`[0:v]scale=\${targetW}:\${targetH}:force_original_aspect_ratio=decrease\`;
        if (scale !== 1.0) fg += \`,scale=iw*\${scale}:ih*\${scale}\`;
        fg += \`[fg];\`;
        filterComplex = bg + fg + \`[bg][fg]overlay=(W-w)/2:(H-h)/2\`;

    } else if (method === 'crop') {
        const xPercent = settings && settings.x ? settings.x : 0;
        const focus = settings && settings.focus ? settings.focus : 'center';
        let xExpr = '(iw-ow)/2';
        if (settings.x !== undefined && settings.x !== 0) xExpr = \`(iw-ow)*(\${xPercent + 50}/100)\`;
        else if (focus === 'left') xExpr = '0';
        else if (focus === 'right') xExpr = 'iw-ow';
        filterComplex = \`[0:v]scale=\${targetW}:\${targetH}:force_original_aspect_ratio=increase,crop=\${targetW}:\${targetH}:\${xExpr}:(ih-oh)/2,setsar=1\`;
    } else if (method === 'letterbox') {
        const color = settings && settings.color ? settings.color : 'black';
        filterComplex = \`[0:v]scale=\${targetW}:\${targetH}:force_original_aspect_ratio=decrease,pad=\${targetW}:\${targetH}:(ow-iw)/2:(oh-ih)/2:color=\${color},setsar=1\`;
    }

    return new Promise((resolve, reject) => {
        const ffmpeg = require('fluent-ffmpeg');
        ffmpeg(inputPath)
            .inputOptions([\`-ss \${startOffset}\`, \`-t \${duration}\`])
            .complexFilter(filterComplex)
            .outputOptions(['-vf', \`scale=\${Math.round(targetW / 2)}:\${Math.round(targetH / 2)}\`])
            .videoCodec('libx264')
            .outputOptions(['-preset', 'ultrafast', '-crf', '35'])
            .output(outputPath)
            .on('end', () => resolve({ success: true }))
            .on('error', (err) => reject(err))
            .run();
    });
}

`;

const startIndex = content.lastIndexOf(startMarker);
const endIndex = content.lastIndexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    const newContent = content.substring(0, startIndex) + replacementCode + content.substring(endIndex);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    console.log('File fixed successfully!');
} else {
    console.error('Markers not found!');
    console.log('Start Index:', startIndex);
    console.log('End Index:', endIndex);
}
