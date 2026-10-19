function recordingName(row, locale, translate, { filename = false } = {}) {
    const lang = ['tr', 'en', 'de', 'es', 'fr'].includes(locale) ? locale : 'tr';
    const created = new Date(row.createdAt);
    const valid = row.createdAt != null && Number.isFinite(created.getTime());
    const date = valid ? created.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const time = valid ? created.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
    const room = String(row.title || translate('broadcast_room.default_room_title')).trim();
    const name = translate('admin_auth.recording_filename', { date, time, room });
    if (!filename) return name;
    const sanitized = name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '-')
        .replace(/\s+/g, ' ').trim().slice(0, 180).replace(/[. ]+$/g, '');
    // Prefix device names so Windows cannot interpret a friendly title as a device.
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized) ? `_${sanitized}` : sanitized;
}
module.exports = { recordingName };
