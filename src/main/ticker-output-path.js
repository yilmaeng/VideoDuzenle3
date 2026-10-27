const fs = require('fs');
const path = require('path');

function tickerOutputPath(source, suffix) {
    const parsed = path.parse(source);
    const base = path.join(parsed.dir, `${parsed.name}_${suffix}`);
    let output = `${base}.mp4`, index = 2;
    while (fs.existsSync(output)) output = `${base} (${index++}).mp4`;
    return output;
}

module.exports = { tickerOutputPath };
