const https = require('https');

const candidateUrls = [
    'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/DeepFilterNet3.tar.gz',
    'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.0/DeepFilterNet3.tar.gz',
    'https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3.tar.gz',
    'https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3_SE.tar.gz', // Tried before, failed
    'https://github.com/Rikorose/DeepFilterNet/releases/latest/download/DeepFilterNet3.tar.gz',
    'https://github.com/Rikorose/DeepFilterNet/raw/main/DeepFilterNet/models/DeepFilterNet3.tar.gz'
];

function checkUrl(url) {
    return new Promise((resolve) => {
        const req = https.request(url, { method: 'HEAD' }, (res) => {
            console.log(`[${res.statusCode}] ${url}`);
            if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
                resolve(url);
            } else {
                resolve(null);
            }
        });
        req.on('error', () => {
            console.log(`[ERR] ${url}`);
            resolve(null);
        });
        req.end();
    });
}

async function main() {
    console.log('Checking URLs...');
    for (const url of candidateUrls) {
        const result = await checkUrl(url);
        if (result) {
            console.log('VALID URL FOUND:', result);
            return;
        }
    }
    console.log('No valid URL found.');
}

main();
