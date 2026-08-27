const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const {
    createCancelledError,
    isCurrentExportCancelled,
    registerExportCancellationHandler
} = require('./export-process-registry');

async function replaceFile(tempPath, destinationPath) {
    const backupPath = `${destinationPath}.evd-backup-${Date.now()}`;
    let backedUp = false;
    try {
        if (fs.existsSync(destinationPath)) {
            fs.renameSync(destinationPath, backupPath);
            backedUp = true;
        }
        fs.renameSync(tempPath, destinationPath);
        if (backedUp) fs.unlinkSync(backupPath);
    } catch (error) {
        if (!fs.existsSync(destinationPath) && backedUp && fs.existsSync(backupPath)) {
            try { fs.renameSync(backupPath, destinationPath); } catch (_restoreError) {}
        }
        throw error;
    } finally {
        try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (_error) {}
    }
}

async function copyFileWithProgress(sourcePath, destinationPath, onProgress = null) {
    const totalBytes = fs.statSync(sourcePath).size;
    const directory = path.dirname(destinationPath);
    const extension = path.extname(destinationPath);
    const tempPath = path.join(directory, `${path.basename(destinationPath, extension)}.evd-copy-partial-${Date.now()}${extension}`);
    fs.mkdirSync(directory, { recursive: true });

    const readStream = fs.createReadStream(sourcePath, { highWaterMark: 8 * 1024 * 1024 });
    const writeStream = fs.createWriteStream(tempPath, { flags: 'wx' });
    let copiedBytes = 0;
    let lastPercent = -1;
    const progressStream = new Transform({
        transform(chunk, encoding, callback) {
            copiedBytes += chunk.length;
            const percent = totalBytes > 0 ? Math.min(99.9, copiedBytes / totalBytes * 100) : 0;
            if (onProgress && percent >= lastPercent + 0.1) {
                lastPercent = percent;
                onProgress(percent, copiedBytes, totalBytes);
            }
            callback(null, chunk);
        }
    });
    const unregister = registerExportCancellationHandler(() => {
        const error = createCancelledError();
        readStream.destroy(error);
        progressStream.destroy(error);
        writeStream.destroy(error);
    });

    try {
        await pipeline(readStream, progressStream, writeStream);
        if (isCurrentExportCancelled()) throw createCancelledError();
        await replaceFile(tempPath, destinationPath);
        onProgress?.(100, totalBytes, totalBytes);
        return { success: true, bytesCopied: totalBytes };
    } finally {
        unregister();
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_error) {}
    }
}

module.exports = { copyFileWithProgress, replaceFile };
