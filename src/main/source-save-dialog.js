const path = require('path');

function sourceSaveOptions(options = {}, sourceFilePath) {
    const settings = { ...options };
    const source = settings.sourceFilePath || sourceFilePath;
    delete settings.sourceFilePath;
    if (typeof source !== 'string' || !path.isAbsolute(source)) return settings;
    if (settings.defaultPath && path.isAbsolute(settings.defaultPath)) return settings;
    const extension = settings.filters?.[0]?.extensions?.[0] || path.extname(source).slice(1) || 'mp4';
    settings.defaultPath = path.join(path.dirname(source), settings.defaultPath || `${path.parse(source).name}_saved.${extension}`);
    return settings;
}
module.exports = { sourceSaveOptions };
