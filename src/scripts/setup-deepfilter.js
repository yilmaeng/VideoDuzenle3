const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const targetDir = path.join(__dirname, '../resources/deepfilter');
const targetFile = path.join(targetDir, 'deep-filter.exe');

// Ensure directory exists
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log('Created directory:', targetDir);
}

// Possible URLs for DeepFilterNet 3 (v0.5.6)
const urls = [
    'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-pc-windows-msvc.exe',
    'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-pc-windows-msvc.zip',
    'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.4.0/deep-filter-0.4.0-x86_64-pc-windows-msvc.exe' // Fallback
];

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log('Trying URL:', url);
        const file = fs.createWriteStream(dest);

        const request = https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                console.log('Redirecting to:', response.headers.location);
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed with status ${response.statusCode}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log('Download complete.');
                    resolve(true);
                });
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

function checkAndRename(tempParams) {
    // If it's a zip, unzip logic needs to be added or manual.
    // Assuming .exe download for now.
    // If we downloaded a zip (by checking content type or extension), we'd need extraction.
    // For now, let's hope for the .exe
}

async function main() {
    for (const url of urls) {
        try {
            const isZip = url.endsWith('.zip');
            const downloadPath = isZip ? path.join(targetDir, 'df.zip') : targetFile;

            await downloadFile(url, downloadPath);

            if (isZip) {
                console.log('Downloaded ZIP. Attempting to extract...');
                try {
                    // Use powershell to unzip
                    execSync(`powershell -command "Expand-Archive -Path '${downloadPath}' -DestinationPath '${targetDir}' -Force"`);
                    console.log('Extraction complete.');
                    // Find exe and rename/move if needed
                    // Usually it extracts to the folder.
                    // Check for exe
                    const files = fs.readdirSync(targetDir);
                    const exe = files.find(f => f.includes('deep-filter') && f.endsWith('.exe'));
                    if (exe) {
                        fs.renameSync(path.join(targetDir, exe), targetFile);
                        console.log('Setup complete: deep-filter.exe is ready.');
                        return;
                    }
                } catch (e) {
                    console.error('Extraction failed:', e);
                }
            } else {
                console.log('Setup complete: deep-filter.exe is ready.');
                return;
            }
        } catch (err) {
            console.error('Failed:', err.message);
        }
    }
    console.error('All download attempts failed.');
    process.exit(1);
}

main();
