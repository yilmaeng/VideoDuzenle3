const https = require('https');
const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, '../resources/deepfilter/DeepFilterNet3.tar.gz');
// GitHub raw link format for recent main branch
const url = 'https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3.tar.gz';

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                download(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                fs.unlink(dest, () => { });
                reject(new Error(`Failed with status ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        });

        req.on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

(async () => {
    try {
        console.log('Downloading model to:', dest);
        await download(url, dest);
        console.log('Success! Model downloaded.');

        // Also download config if needed? DFN tar usually contains config.

    } catch (e) {
        console.error('Download failed:', e);
    }
})();
