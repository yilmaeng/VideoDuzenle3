const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const deepFilterBin = path.join(__dirname, '../resources/deepfilter/deep-filter.exe');
const tempDir = os.tmpdir();

console.log('--- DeepFilterNet Diagnostic ---');
console.log('Binary Path:', deepFilterBin);
console.log('Binary Exists:', fs.existsSync(deepFilterBin));

function runCommand(args) {
    return new Promise((resolve) => {
        console.log(`\n[CMD] deep-filter ${args.join(' ')}`);
        const child = spawn(deepFilterBin, args, {
            cwd: tempDir,
            shell: true
        });

        child.stdout.on('data', d => console.log('[STDOUT]', d.toString()));
        child.stderr.on('data', d => console.log('[STDERR]', d.toString()));

        child.on('close', code => {
            console.log(`[EXIT] Code: ${code}`);
            resolve(code);
        });

        child.on('error', err => {
            console.error('[ERROR]', err);
            resolve(-1);
        });
    });
}

(async () => {
    try {
        // Test 1: Help
        console.log('\n--- Test 1: Help Command ---');
        await runCommand(['--help']);

        // Test 2: Version?
        // await runCommand(['--version']);

    } catch (e) {
        console.error('Script Error:', e);
    }
})();
