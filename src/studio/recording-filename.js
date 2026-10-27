function recordingFilename(date, language, timeLabel) {
    const day = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join('.');
    // OBS interprets percent escapes; Windows forbids colons in file names.
    return `${day} ${timeLabel} ${clock}`.replace(/[%<>:"/\\|?*\x00-\x1f]/g, '-');
}

async function nameCompletedRecording(source, name) {
    const fs = require('fs');
    const path = require('path');
    const parsed = path.parse(source);
    for (let n = 1; ; n++) {
        const target = path.join(parsed.dir, `${name}${n === 1 ? '' : ` (${n})`}${parsed.ext}`);
        if (path.resolve(target) === path.resolve(source)) return source;
        try {
            // Hard-link then unlink avoids overwriting another recording and
            // does not copy a large file on NTFS. Other filesystems use EXCL.
            try { await fs.promises.link(source, target); }
            catch (error) {
                if (!['EPERM', 'ENOTSUP', 'EXDEV', 'EINVAL', 'ENOSYS'].includes(error.code)) throw error;
                await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
            }
        } catch (error) {
            if (error.code === 'EEXIST') continue;
            throw error;
        }
        await fs.promises.unlink(source);
        return target;
    }
}

module.exports = { recordingFilename, nameCompletedRecording };
