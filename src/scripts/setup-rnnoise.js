const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const resourcesDir = path.join(__dirname, '../resources/rnnoise');

if (!fs.existsSync(resourcesDir)) {
    try {
        fs.mkdirSync(resourcesDir, { recursive: true });
    } catch (err) {
        console.error('Failed to create directory:', resourcesDir, err);
        process.exit(1);
    }
}

// Updated URL to correct location in repo
const modelUrl = 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/conjoined-burgers-2018-08-28/cb.rnnn';
const destPath = path.join(resourcesDir, 'cb.rnnn');
const tempPath = path.join(os.tmpdir(), `cb-${Date.now()}.rnnn`);

console.log('Downloading RNNoise model...');
console.log('URL:', modelUrl);

const file = fs.createWriteStream(tempPath);

https.get(modelUrl, (response) => {
    if (response.statusCode !== 200) {
        console.error(`Download failed. Status Code: ${response.statusCode}`);
        file.close();
        fs.unlink(tempPath, () => { });
        return;
    }

    response.pipe(file);

    file.on('finish', () => {
        file.close(() => {
            console.log('Download to temp file complete.');
            try {
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath);
                }
                fs.copyFileSync(tempPath, destPath);
                fs.unlinkSync(tempPath);
                console.log('RNNoise model successfully installed to:', destPath);
            } catch (err) {
                console.error('Error moving file to destination:', err);
            }
        });
    });
}).on('error', (err) => {
    fs.unlink(tempPath, () => { });
    console.error('Network/Download Error:', err.message);
});

file.on('error', (err) => {
    console.error('File stream error:', err.message);
    fs.unlink(tempPath, () => { });
});
