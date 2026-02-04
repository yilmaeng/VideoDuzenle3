const fs = require('fs');

const content = fs.readFileSync('src/main/ffmpeg-handler.js', 'utf8');
const lines = content.split('\n');

let openBraces = 0;
let potentialScopes = []; // Stack of { isAsync: boolean, startLine: number }

console.log('Scanning for await misuse...');

lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Simple naive scope tracking
    const bracesIn = (line.match(/{/g) || []).length;
    const bracesOut = (line.match(/}/g) || []).length;

    // Check for function definitions
    if (trimmed.includes('function') || trimmed.includes('=>')) {
        const isAsync = trimmed.includes('async');
        potentialScopes.push({ isAsync, indent: openBraces });
    }

    if (trimmed.includes('await ')) {
        // Find closest scope
        // This is very rough, won't work perfectly for nested scopes on same line
        // But might catch blatant errors
        console.log(`Line ${index + 1}: ${trimmed}`);
    }
});
