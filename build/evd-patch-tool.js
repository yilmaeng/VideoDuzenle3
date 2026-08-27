#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
    PATCH_SCHEMA_VERSION,
    canonicalize,
    normalizePatchPath,
    sha256
} = require('../src/main/update/patch-manager');

function parseArgs(argv) {
    const result = { _: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith('--')) {
            result._.push(value);
            continue;
        }
        const key = value.slice(2);
        const next = argv[index + 1];
        result[key] = next && !next.startsWith('--') ? argv[++index] : true;
    }
    return result;
}

function walkFiles(root, current = root) {
    const files = [];
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(root, absolute));
        else if (entry.isFile()) files.push(absolute);
    }
    return files;
}

function createKeyPair(privatePath, publicPath) {
    if (!privatePath || !publicPath) throw new Error('keygen_paths_required');
    if (fs.existsSync(privatePath)) throw new Error('private_key_already_exists');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(privatePath), { recursive: true });
    fs.mkdirSync(path.dirname(publicPath), { recursive: true });
    fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
    return { privatePath, publicPath };
}

function createPatchArtifacts(options) {
    const inputDirectory = path.resolve(options.input || '');
    const outputDirectory = path.resolve(options.output || 'dist/patch');
    const baseVersion = String(options.base || '').trim();
    const revision = Number(options.revision);
    const packageUrl = String(options['package-url'] || '').trim();
    const privateKeyPath = path.resolve(options['private-key'] || '');
    if (!fs.existsSync(inputDirectory) || !fs.statSync(inputDirectory).isDirectory()) throw new Error('patch_input_directory_missing');
    if (!baseVersion || !Number.isInteger(revision) || revision < 1 || !packageUrl || !fs.existsSync(privateKeyPath)) {
        throw new Error('patch_create_arguments_invalid');
    }

    const archiveFiles = walkFiles(inputDirectory).map((absolutePath) => {
        const relativePath = normalizePatchPath(path.relative(inputDirectory, absolutePath).replace(/\\/g, '/'));
        const data = fs.readFileSync(absolutePath);
        return { path: relativePath, data, sha256: sha256(data), size: data.length };
    }).sort((left, right) => left.path.localeCompare(right.path));
    if (!archiveFiles.length) throw new Error('patch_input_empty');

    const archive = {
        schemaVersion: PATCH_SCHEMA_VERSION,
        files: archiveFiles.map((item) => ({ path: item.path, data: item.data.toString('base64') }))
    };
    const packageBuffer = zlib.gzipSync(Buffer.from(JSON.stringify(archive), 'utf8'), { level: 9 });
    const packageName = `evd-${baseVersion}-patch-${revision}.evdpatch`;
    const packagePath = path.join(outputDirectory, packageName);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(packagePath, packageBuffer);

    const locales = ['tr', 'en', 'de', 'es', 'fr'];
    const releaseNotes = {};
    for (const locale of locales) {
        const note = options[`notes-${locale}`];
        if (note) releaseNotes[locale] = String(note);
    }
    const localeFiles = {};
    for (const locale of locales) {
        const localePath = `locales/${locale}.json`;
        if (archiveFiles.some((item) => item.path === localePath)) localeFiles[locale] = localePath;
    }
    const manifest = {
        schemaVersion: PATCH_SCHEMA_VERSION,
        patchId: String(options.id || `${baseVersion}-patch-${revision}`),
        baseVersion,
        revision,
        platforms: String(options.platforms || 'win32,darwin').split(',').map((item) => item.trim()).filter(Boolean),
        architectures: String(options.architectures || 'x64,arm64').split(',').map((item) => item.trim()).filter(Boolean),
        packageUrl,
        packageSha256: sha256(packageBuffer),
        packageSize: packageBuffer.length,
        restartRequired: true,
        mainEntrypoint: archiveFiles.some((item) => item.path === 'main.js') ? 'main.js' : '',
        rendererEntrypoint: archiveFiles.some((item) => item.path === 'renderer.js') ? 'renderer.js' : '',
        localeFiles,
        releaseNotes,
        files: archiveFiles.map(({ path: filePath, sha256: hash, size }) => ({ path: filePath, sha256: hash, size }))
    };
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    manifest.signature = crypto.sign(null, Buffer.from(canonicalize(manifest), 'utf8'), privateKey).toString('base64');
    const manifestPath = path.join(outputDirectory, 'stable.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { packagePath, manifestPath, manifest };
}

function verifyPatchManifest(manifestPath, publicKeyPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const signature = manifest.signature;
    delete manifest.signature;
    const valid = crypto.verify(
        null,
        Buffer.from(canonicalize(manifest), 'utf8'),
        fs.readFileSync(publicKeyPath, 'utf8'),
        Buffer.from(String(signature || ''), 'base64')
    );
    if (!valid) throw new Error('patch_signature_invalid');
    return true;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const command = args._[0];
    if (command === 'keygen') {
        const result = createKeyPair(path.resolve(args.private || ''), path.resolve(args.public || ''));
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (command === 'create') {
        console.log(JSON.stringify(createPatchArtifacts(args), null, 2));
        return;
    }
    if (command === 'verify') {
        verifyPatchManifest(path.resolve(args.manifest || ''), path.resolve(args.public || ''));
        console.log('Patch manifest signature is valid.');
        return;
    }
    throw new Error('Usage: keygen | create | verify');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

module.exports = { createKeyPair, createPatchArtifacts, verifyPatchManifest, parseArgs };
