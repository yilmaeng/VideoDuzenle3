const ffmpegStatic = require('ffmpeg-static');
const { execFile } = require('child_process');

console.log('Testing ffmpeg-static at:', ffmpegStatic);

execFile(ffmpegStatic, ['-filters'], (error, stdout, stderr) => {
    if (error) {
        console.error('Error running ffmpeg:', error);
        return;
    }
    if (stdout.includes('arnndn')) {
        console.log('✅ arnndn filter FOUND in ffmpeg-static!');
    } else {
        console.log('❌ arnndn filter NOT found in ffmpeg-static.');
    }
});
