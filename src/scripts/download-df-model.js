const fs = require('fs');
const path = require('path');
const https = require('https');

const targetDir = path.join(__dirname, '../resources/deepfilter');
const targetFile = path.join(targetDir, 'DeepFilterNet3.tar.gz');
const modelUrl = 'https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3_SE.tar.gz';

// Ensure directory exists
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Downloading DeepFilterNet3 model from: ${modelUrl}`);
console.log(`Target: ${targetFile}`);

const file = fs.createWriteStream(targetFile);

https.get(modelUrl, (response) => {
    if (response.statusCode === 302 || response.statusCode === 301) {
        console.log('Redirecting to:', response.headers.location);
        downloadFile(response.headers.location, targetFile);
        return;
    }

    if (response.statusCode !== 200) {
        console.error(`Download failed with status code: ${response.statusCode}`);
        process.exit(1);
    }

    response.pipe(file);

    file.on('finish', () => {
        file.close(() => {
            console.log('Download completed successfully.');
            // Verify size
            const stats = fs.statSync(targetFile);
            console.log(`File size: ${stats.size} bytes`);
            if (stats.size < 1000) {
                console.warn('Warning: File size is suspiciously small. Download might have failed.');
            }
        });
    });
}).on('error', (err) => {
    fs.unlink(targetFile, () => { }); // Delete the file async. (But we don't check result)
    console.error('Download error:', err.message);
    process.exit(1);
});

function downloadFile(url, dest) {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
            downloadFile(response.headers.location, dest);
            return;
        }
        response.pipe(file);
        file.on('finish', () => {
            file.close(() => console.log('Download complete (redirect).'));
        });
    }).on('error', (err) => {
        console.error('Redirect download error:', err);
    });
}
