const fs = require('fs');
const path = require('path');

const badFile = path.join(__dirname, '../resources/deepfilter/DeepFilterNet3.tar.gz');

try {
    if (fs.existsSync(badFile)) {
        const stats = fs.statSync(badFile);
        console.log(`Checking file: ${badFile}`);
        console.log(`Size: ${stats.size} bytes`);

        if (stats.size < 1000) {
            console.log('File is too small (likely failed download). Deleting...');
            fs.unlinkSync(badFile);
            console.log('Successfully deleted corrupt file.');
        } else {
            console.log('File seems valid. Leaving it alone.');
        }
    } else {
        console.log('File not found.');
    }
} catch (e) {
    console.error('Error:', e.message);
}
