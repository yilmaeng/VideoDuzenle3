const fs = require('fs');

const content = fs.readFileSync('C:/Users/engin/OneDrive/Belgeler/KorculVideoEditor/src/main/ffmpeg-handler.js', 'utf8');
const lines = content.split('\n');

let currentFunction = null;
let braceCount = 0;
let asyncFunctionRegex = /async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async/;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Simple state tracking (very basic)
    const match = line.match(asyncFunctionRegex);
    if (match) {
        // We are entering an async function (or declaring one)
        // This parser is too simple to track scopes perfectly but might help identify top-level awaits
    }

    if (line.includes('await ')) {
        console.log(`Line ${i + 1}: ${line.trim()}`);
    }
}
