const defaults = { tr: ['Alt+R', 'Alt+G'], en: ['Alt+N', 'Alt+B'], de: ['Alt+W', 'Alt+Z'], es: ['Alt+S', 'Alt+A'], fr: ['Alt+S', 'Alt+P'] };
function binding(action, language, user = {}) {
    if (Object.prototype.hasOwnProperty.call(user, action)) return user[action] || null;
    return (defaults[String(language).split('-')[0]] || defaults.en)[action === 'recordingWizardNext' ? 0 : 1];
}
function matches(event, shortcut) {
    if (Array.isArray(shortcut)) return shortcut.some(s => matches(event, s));
    if (!shortcut || event.repeat || event.isComposing) return false;
    const parts = shortcut.toLowerCase().split('+');
    const key = parts.pop();
    return event.altKey === parts.includes('alt') && event.shiftKey === parts.includes('shift') &&
        event.ctrlKey === (parts.includes('ctrl') || parts.includes('control')) &&
        event.metaKey === (parts.includes('meta') || parts.includes('command') || parts.includes('cmd')) &&
        (event.key.toLowerCase() === key || event.code.toLowerCase() === `key${key}`);
}
module.exports = { binding, matches };
