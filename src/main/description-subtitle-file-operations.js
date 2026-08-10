const fs = require('fs');
const path = require('path');

function parseTimecode(value) {
    const normalized = String(value || '').trim().replace(',', '.');
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(normalized);
    if (!match) return null;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const milliseconds = Number(String(match[4] || '0').padEnd(3, '0'));
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function parseSubtitleContent(content, extension = '.srt') {
    const format = String(extension || '').toLowerCase().replace(/^\./, '') === 'vtt' ? 'vtt' : 'srt';
    let text = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (format === 'vtt') text = text.replace(/^WEBVTT[^\n]*\n+/, '');
    const blocks = text.split(/\n{2,}/);
    const cues = [];
    blocks.forEach(block => {
        const lines = block.split('\n').map(line => line.trimEnd());
        if (!lines.length || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) return;
        const timingIndex = lines.findIndex(line => line.includes('-->'));
        if (timingIndex < 0) return;
        const timing = lines[timingIndex].split('-->');
        const start = parseTimecode(timing[0]);
        const end = parseTimecode(String(timing[1] || '').trim().split(/\s+/)[0]);
        const cueText = lines.slice(timingIndex + 1).join('\n').trim();
        if (start === null || end === null || end <= start || !cueText) return;
        cues.push({ start, end, text: cueText });
    });
    return { format, cues };
}

function formatTimecode(seconds, separator = ',') {
    const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(milliseconds).padStart(3, '0')}`;
}

function serializeSubtitles(events, format = 'srt') {
    const normalizedFormat = format === 'vtt' ? 'vtt' : 'srt';
    const separator = normalizedFormat === 'vtt' ? '.' : ',';
    const blocks = [...events]
        .sort((left, right) => left.start - right.start || left.end - right.end)
        .map((item, index) => {
            const timing = `${formatTimecode(item.start, separator)} --> ${formatTimecode(item.end, separator)}`;
            return normalizedFormat === 'vtt'
                ? `${timing}\n${String(item.text || '').trim()}`
                : `${index + 1}\n${timing}\n${String(item.text || '').trim()}`;
        });
    return `${normalizedFormat === 'vtt' ? 'WEBVTT\n\n' : ''}${blocks.join('\n\n')}\n`;
}

function xml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function columnName(index) {
    let value = index + 1;
    let result = '';
    while (value) {
        value -= 1;
        result = String.fromCharCode(65 + (value % 26)) + result;
        value = Math.floor(value / 26);
    }
    return result;
}

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    entries.forEach(entry => {
        const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
        const checksum = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        localParts.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014B50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + data.length;
    });
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...localParts, centralDirectory, end]);
}

function createScenarioWorkbook(events, labels = {}) {
    const headers = labels.headers || ['No', 'Start', 'End', 'Duration', 'Type', 'Text', 'Word count', 'Speaker', 'Narration notes', 'Tone', 'Tempo', 'Voice', 'Status', 'Review note', 'Review status'];
    const rows = [headers, ...events.map((item, index) => [
        index + 1,
        formatTimecode(item.start, '.'),
        formatTimecode(item.end, '.'),
        Number((Math.max(0, item.end - item.start)).toFixed(3)),
        labels.types?.[item.type] || item.type,
        item.text || '',
        String(item.text || '').trim() ? String(item.text).trim().split(/\s+/u).length : 0,
        item.speaker || '',
        item.narrationNotes || '',
        item.narrationTone || '',
        item.narrationTempo || '',
        item.voice || '',
        labels.statuses?.[item.status] || item.status,
        item.reviewNoteText || '',
        item.reviewNoteText ? (item.reviewNoteResolved ? (labels.reviewResolved || 'Resolved') : (labels.reviewUnresolved || 'Unresolved')) : ''
    ])];
    const sheetRows = rows.map((row, rowIndex) => {
        const cells = row.map((value, columnIndex) => {
            const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
            if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
        }).join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="4" width="16" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/><col min="6" max="6" width="55" customWidth="1"/><col min="7" max="15" width="22" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:O${rows.length}"/></worksheet>`;
    return createZip([
        { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
        { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(labels.sheetName || 'Script')}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
        { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ]);
}


function createQualityWorkbook(issues, labels = {}) {
    const headers = labels.headers || ['No', 'Severity', 'Rule', 'Start', 'End', 'Text', 'Message'];
    const rows = [headers, ...issues.map(item => [
        item.number, item.severity, item.rule, item.start, item.end, item.text, item.message
    ])];
    const sheetRows = rows.map((row, rowIndex) => {
        const cells = row.map((value, columnIndex) => {
            const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
            if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
        }).join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="5" width="20" customWidth="1"/><col min="6" max="7" width="55" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:G${rows.length}"/></worksheet>`;
    return createZip([
        { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
        { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(labels.sheetName || 'Quality')}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
        { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ]);
}

function readSubtitleFile(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return parseSubtitleContent(fs.readFileSync(filePath, 'utf8'), extension);
}

module.exports = {
    createZip,
    createQualityWorkbook,
    createScenarioWorkbook,
    formatTimecode,
    parseSubtitleContent,
    readSubtitleFile,
    serializeSubtitles
};
