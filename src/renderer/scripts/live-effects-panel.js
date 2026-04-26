const { ipcRenderer } = require('electron');

const SHORTCUT_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const AUDIO_EXTENSIONS = ['mp1', 'mp2', 'mp3', 'mpa', 'mpga', 'aac', 'm4a', 'wav', 'ogg', 'flac', 'wma'];
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', 'vob', '3gp', 'flv', 'wmv'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS];

const i18nState = {
    cache: {},
    currentLang: 'tr',
    async init() {
        this.currentLang = await ipcRenderer.invoke('i18n-get-language');
        this.cache = await ipcRenderer.invoke('i18n-get-all');
        document.documentElement.lang = this.currentLang;
        this.translateDom();
    },
    t(key, fallback, params = {}) {
        const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), this.cache);
        const template = typeof value === 'string' && value ? value : fallback;
        return Object.entries(params).reduce((result, [paramKey, paramValue]) => {
            return result.replaceAll(`{${paramKey}}`, String(paramValue));
        }, template);
    },
    translateDom() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            const value = this.t(key, '');
            if (value) el.textContent = value;
        });
        document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
            const key = el.getAttribute('data-i18n-aria');
            const value = this.t(key, '');
            if (value) el.setAttribute('aria-label', value);
        });
        const titleEl = document.querySelector('title[data-i18n]');
        if (titleEl) {
            const value = this.t(titleEl.getAttribute('data-i18n'), '');
            if (value) document.title = value;
        }
    }
};

function t(key, fallback, params = {}) {
    return i18nState.t(key, fallback, params);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getMediaTypeFromPath(sourcePath = '') {
    const lower = String(sourcePath || '').toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`)) ? 'video' : 'audio';
}

function getDisplayNameFromPath(sourcePath = '') {
    const fileName = String(sourcePath || '').split(/[\\/]/).pop() || '';
    return fileName.replace(/\.[^.]+$/, '').trim();
}

const state = {
    activeProfileId: null,
    profiles: [],
    previewAudio: null,
    previewSlotId: null
};

const els = {
    statusLine: document.getElementById('status-line'),
    profileSelect: document.getElementById('profile-select'),
    profileName: document.getElementById('profile-name'),
    profileDescription: document.getElementById('profile-description'),
    introSlotSelect: document.getElementById('intro-slot-select'),
    outroSlotSelect: document.getElementById('outro-slot-select'),
    btnNewProfile: document.getElementById('btn-new-profile'),
    btnSaveProfile: document.getElementById('btn-save-profile'),
    btnBulkImport: document.getElementById('btn-bulk-import'),
    btnDeleteProfile: document.getElementById('btn-delete-profile'),
    btnClosePanel: document.getElementById('btn-close-panel'),
    slotList: document.getElementById('slot-list')
};

function setStatus(message) {
    if (els.statusLine) {
        els.statusLine.textContent = message;
    }
}

function ensurePreviewAudio() {
    if (state.previewAudio) return state.previewAudio;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
        state.previewSlotId = null;
        setStatus(t('live_effects_panel.status_preview_stopped', 'Slot onizlemesi durduruldu.'));
    });
    audio.addEventListener('error', () => {
        state.previewSlotId = null;
        setStatus(t('live_effects_panel.status_preview_failed', 'Slot onizlemesi baslatilamadi.'));
    });
    state.previewAudio = audio;
    return audio;
}

function getActiveProfile() {
    return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

function getSlotOptionLabel(slot, index) {
    const slotName = slot.name || t('live_effects_panel.slot_fallback_name', 'Adsiz efekt');
    return t('live_effects_panel.slot_option_label', 'Slot {index}: {name}', {
        index: index + 1,
        name: slotName
    });
}

function renderProfileSelect() {
    els.profileSelect.innerHTML = '';
    state.profiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        option.selected = profile.id === state.activeProfileId;
        els.profileSelect.appendChild(option);
    });
}

function renderProfileSlotTargets(profile) {
    const selects = [els.introSlotSelect, els.outroSlotSelect].filter(Boolean);
    selects.forEach((selectEl) => {
        selectEl.innerHTML = '';
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = t('live_effects_panel.slot_none', 'Yok');
        selectEl.appendChild(noneOption);
    });

    if (!profile || !Array.isArray(profile.slots)) {
        return;
    }

    profile.slots.forEach((slot, index) => {
        selects.forEach((selectEl) => {
            const option = document.createElement('option');
            option.value = slot.id;
            option.textContent = getSlotOptionLabel(slot, index);
            selectEl.appendChild(option);
        });
    });

    if (els.introSlotSelect) {
        els.introSlotSelect.value = profile.introSlotId || '';
    }
    if (els.outroSlotSelect) {
        els.outroSlotSelect.value = profile.outroSlotId || '';
    }
}

function createSlotCard(slot, index) {
    const slotNumber = index + 1;
    const slotTitle = `${t('live_effects_panel.slot_label', 'Slot')} ${slotNumber}`;
    const nameId = `${slot.id}-name`;
    const typeId = `${slot.id}-type`;
    const shortcutId = `${slot.id}-shortcut`;
    const volumeId = `${slot.id}-volume`;
    const sourceId = `${slot.id}-source`;
    const imageId = `${slot.id}-image`;
    const titleId = `${slot.id}-title`;
    const slotPrefix = `${slotTitle}, `;
    const browseAria = `${slotPrefix}${t('live_effects_panel.slot_source', 'Dosya')}, ${t('live_effects_panel.browse', 'Gozat')}`;
    const browseImageAria = `${slotPrefix}${t('live_effects_panel.slot_image', 'Gorsel')}, ${t('live_effects_panel.browse_image', 'Gorsel Sec')}`;
    const slotName = String(slot.name || '').trim();
    const inferredName = getDisplayNameFromPath(slot.sourcePath || '');
    const autoNameValue = slotName && inferredName && slotName === inferredName ? slotName : '';
    const wrapper = document.createElement('article');
    wrapper.className = 'slot-card';
    wrapper.dataset.slotId = slot.id;
    wrapper.setAttribute('aria-labelledby', titleId);
    wrapper.innerHTML = `
        <div class="slot-row">
            <strong id="${titleId}">${slotTitle}</strong>
            <span>${t('live_effects_panel.shortcut_prefix', 'Kisayol')}: ${escapeHtml(slot.shortcutKey || '-')}</span>
        </div>
        <div class="slot-grid">
            <div>
                <label for="${nameId}">${t('live_effects_panel.slot_name', 'Ad')}</label>
                <input id="${nameId}" type="text" data-field="name" data-auto-name="${escapeHtml(autoNameValue)}" aria-label="${escapeHtml(slotPrefix + t('live_effects_panel.slot_name', 'Ad'))}" value="${escapeHtml(slot.name || '')}">
            </div>
            <div>
                <label for="${typeId}">${t('live_effects_panel.slot_type', 'Tur')}</label>
                <select id="${typeId}" data-field="type" aria-label="${escapeHtml(slotPrefix + t('live_effects_panel.slot_type', 'Tur'))}">
                    <option value="audio"${slot.type === 'audio' ? ' selected' : ''}>${t('live_effects_panel.type_audio', 'Ses')}</option>
                    <option value="video"${slot.type === 'video' ? ' selected' : ''}>${t('live_effects_panel.type_video', 'Video')}</option>
                </select>
            </div>
            <div>
                <label for="${shortcutId}">${t('live_effects_panel.slot_shortcut', 'Kisayol')}</label>
                <input id="${shortcutId}" type="text" data-field="shortcutKey" maxlength="1" aria-label="${escapeHtml(slotPrefix + t('live_effects_panel.slot_shortcut', 'Kisayol'))}" value="${escapeHtml(slot.shortcutKey || '')}">
            </div>
            <div>
                <label for="${volumeId}">${t('live_effects_panel.slot_volume', 'Ses Seviyesi (%)')}</label>
                <input id="${volumeId}" type="number" data-field="volumePercent" min="0" max="200" aria-label="${escapeHtml(slotPrefix + t('live_effects_panel.slot_volume', 'Ses Seviyesi (%)'))}" value="${slot.volumePercent || 100}">
            </div>
            <div style="grid-column: 1 / -1;">
                <label for="${sourceId}">${t('live_effects_panel.slot_source', 'Dosya')}</label>
                <div class="slot-actions">
                    <input id="${sourceId}" class="slot-actions-grow" type="text" data-field="sourcePath" aria-label="${escapeHtml(slotPrefix + t('live_effects_panel.slot_source', 'Dosya'))}" value="${escapeHtml(slot.sourcePath || '')}">
                    <button type="button" class="secondary" data-action="browse" aria-label="${escapeHtml(browseAria)}">${t('live_effects_panel.browse', 'Gozat')}</button>
                </div>
            </div>
            <div style="grid-column: 1 / -1;">
                <label for="${imageId}">${t('live_effects_panel.slot_image', 'Gorsel')}</label>
                <div class="slot-actions">
                    <input id="${imageId}" class="slot-actions-grow" type="text" data-field="imagePath" aria-label="${escapeHtml(slotPrefix + t('live_effects_panel.slot_image', 'Gorsel'))}" value="${escapeHtml(slot.imagePath || '')}">
                    <button type="button" class="secondary" data-action="browse-image" aria-label="${escapeHtml(browseImageAria)}">${t('live_effects_panel.browse_image', 'Gorsel Sec')}</button>
                </div>
            </div>
        </div>
    `;
    return wrapper;
}

function renderSlots() {
    const profile = getActiveProfile();
    els.slotList.innerHTML = '';
    if (!profile) return;
    profile.slots.forEach((slot, index) => {
        els.slotList.appendChild(createSlotCard(slot, index));
    });
}

function renderProfileDetails() {
    const profile = getActiveProfile();
    if (!profile) return;
    els.profileName.value = profile.name || '';
    els.profileDescription.value = profile.description || '';
    renderProfileSlotTargets(profile);
    renderSlots();
}

function render() {
    renderProfileSelect();
    renderProfileDetails();
}

function readSlotFromCard(slot, card, slotIndex) {
    const sourcePath = card.querySelector('[data-field="sourcePath"]').value.trim();
    const shortcutValue = card.querySelector('[data-field="shortcutKey"]').value.trim();
    return {
        ...slot,
        name: card.querySelector('[data-field="name"]').value.trim(),
        type: card.querySelector('[data-field="type"]').value || getMediaTypeFromPath(sourcePath),
        shortcutKey: shortcutValue || SHORTCUT_ORDER[slotIndex] || '',
        volumePercent: parseInt(card.querySelector('[data-field="volumePercent"]').value, 10) || 100,
        sourcePath,
        imagePath: card.querySelector('[data-field="imagePath"]').value.trim()
    };
}

function cloneActiveProfileFromDom() {
    const profile = getActiveProfile();
    if (!profile) return null;

    const slotCards = Array.from(els.slotList.querySelectorAll('.slot-card'));
    const slots = profile.slots.map((slot, index) => {
        const card = slotCards[index];
        if (!card) return slot;
        return readSlotFromCard(slot, card, index);
    });

    return {
        ...profile,
        name: els.profileName.value.trim() || t('live_effects_panel.default_profile_name', 'Yeni Profil'),
        description: els.profileDescription.value.trim(),
        introSlotId: els.introSlotSelect ? els.introSlotSelect.value || '' : '',
        outroSlotId: els.outroSlotSelect ? els.outroSlotSelect.value || '' : '',
        slots
    };
}

async function loadState() {
    const response = await ipcRenderer.invoke('live-effects-get-state');
    if (!response.success) {
        throw new Error(response.error || 'live-effects-get-state failed');
    }
    state.activeProfileId = response.state.activeProfileId;
    state.profiles = response.state.profiles || [];
    render();
    setStatus(t('live_effects_panel.status_loaded', 'Canli efekt profilleri yuklendi.'));
}

async function saveActiveProfile() {
    const profile = cloneActiveProfileFromDom();
    if (!profile) return;
    const response = await ipcRenderer.invoke('live-effects-save-profile', profile);
    state.activeProfileId = response.state.activeProfileId;
    state.profiles = response.state.profiles || [];
    render();
    setStatus(t('live_effects_panel.status_saved', 'Profil kaydedildi.'));
}

async function createProfile() {
    const typedName = els.profileName ? els.profileName.value.trim() : '';
    const name = typedName || t('live_effects_panel.default_profile_name', 'Yeni Profil');
    const response = await ipcRenderer.invoke('live-effects-create-profile', { name });
    state.activeProfileId = response.state.activeProfileId;
    state.profiles = response.state.profiles || [];
    render();
    setStatus(t('live_effects_panel.status_profile_created', 'Yeni profil olusturuldu.'));
}

function closePanel() {
    ipcRenderer.send('close-dialog-window');
}

async function deleteActiveProfile() {
    const profile = getActiveProfile();
    if (!profile) return;
    const confirmed = window.confirm(t('live_effects_panel.delete_confirm', 'Bu profili silmek istediginize emin misiniz?'));
    if (!confirmed) return;
    const response = await ipcRenderer.invoke('live-effects-delete-profile', { profileId: profile.id });
    state.activeProfileId = response.state.activeProfileId;
    state.profiles = response.state.profiles || [];
    render();
    setStatus(t('live_effects_panel.status_profile_deleted', 'Profil silindi.'));
}

async function selectProfile(profileId) {
    const response = await ipcRenderer.invoke('live-effects-set-active-profile', { profileId });
    state.activeProfileId = response.state.activeProfileId;
    state.profiles = response.state.profiles || [];
    render();
}

function updateCardTypeFromSource(card, sourcePath) {
    if (!card) return;
    const typeSelect = card.querySelector('[data-field="type"]');
    if (typeSelect && sourcePath) {
        typeSelect.value = getMediaTypeFromPath(sourcePath);
    }
}

function updateCardNameFromSource(card, sourcePath, { force = false } = {}) {
    if (!card) return;
    const nameInput = card.querySelector('[data-field="name"]');
    if (!nameInput) return;

    const nextAutoName = getDisplayNameFromPath(sourcePath);
    if (!nextAutoName) return;

    const currentName = nameInput.value.trim();
    const previousAutoName = String(nameInput.dataset.autoName || '').trim();
    const shouldReplace = force || !currentName || (previousAutoName && currentName === previousAutoName);

    if (shouldReplace) {
        nameInput.value = nextAutoName;
        nameInput.dataset.autoName = nextAutoName;
    }
}

async function browseSlotFile(buttonEl) {
    const card = buttonEl.closest('.slot-card');
    if (!card) return;
    const response = await ipcRenderer.invoke('show-open-dialog', {
        extensions: MEDIA_EXTENSIONS,
        allowMultiple: false
    });
    if (!response || response.canceled || !response.filePaths || response.filePaths.length === 0) return;
    const input = card.querySelector('[data-field="sourcePath"]');
    if (input) {
        input.value = response.filePaths[0];
        updateCardTypeFromSource(card, response.filePaths[0]);
        updateCardNameFromSource(card, response.filePaths[0], { force: true });
    }
}

async function browseSlotImage(buttonEl) {
    const card = buttonEl.closest('.slot-card');
    if (!card) return;
    const response = await ipcRenderer.invoke('show-open-dialog', {
        extensions: IMAGE_EXTENSIONS,
        allowMultiple: false
    });
    if (!response || response.canceled || !response.filePaths || response.filePaths.length === 0) return;
    const input = card.querySelector('[data-field="imagePath"]');
    if (input) {
        input.value = response.filePaths[0];
    }
}

async function bulkImportMedia() {
    const profile = getActiveProfile();
    if (!profile) return;

    const response = await ipcRenderer.invoke('show-open-dialog', {
        extensions: MEDIA_EXTENSIONS,
        allowMultiple: true
    });
    if (!response || response.canceled || !response.filePaths || response.filePaths.length === 0) {
        return;
    }

    const draftProfile = cloneActiveProfileFromDom();
    if (!draftProfile) return;

    const emptySlots = draftProfile.slots
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => !slot.sourcePath);

    let importedCount = 0;
    response.filePaths.forEach((filePath, fileIndex) => {
        const target = emptySlots[fileIndex];
        if (!target) return;
        const fileName = filePath.split(/[\\/]/).pop() || '';
        const displayName = fileName.replace(/\.[^.]+$/, '');
        draftProfile.slots[target.index] = {
            ...draftProfile.slots[target.index],
            sourcePath: filePath,
            type: getMediaTypeFromPath(filePath),
            name: draftProfile.slots[target.index].name || displayName,
            shortcutKey: SHORTCUT_ORDER[target.index] || draftProfile.slots[target.index].shortcutKey || ''
        };
        importedCount += 1;
    });

    if (importedCount === 0) {
        setStatus(t('live_effects_panel.status_bulk_import_no_space', 'Bos slot bulunamadi. Once mevcut slotlardan birini temizleyin.'));
        return;
    }

    const saveResponse = await ipcRenderer.invoke('live-effects-save-profile', draftProfile);
    state.activeProfileId = saveResponse.state.activeProfileId;
    state.profiles = saveResponse.state.profiles || [];
    render();

    const skippedCount = response.filePaths.length - importedCount;
    setStatus(skippedCount > 0
        ? t('live_effects_panel.status_bulk_import_partial', '{imported} medya eklendi, {skipped} dosya bos slot kalmadigi icin atlandi.', {
            imported: importedCount,
            skipped: skippedCount
        })
        : t('live_effects_panel.status_bulk_import_done', '{count} medya slota eklendi.', { count: importedCount }));
}

function handleSlotInputChange(event) {
    const target = event.target;
    if (!target) return;
    if (target.matches('[data-field="name"]')) {
        target.dataset.autoName = '';
        return;
    }
    if (!target.matches('[data-field="sourcePath"]')) return;
    const card = target.closest('.slot-card');
    const sourcePath = target.value.trim();
    updateCardTypeFromSource(card, sourcePath);
    updateCardNameFromSource(card, sourcePath, { force: true });
}

function focusSlotByShortcutKey(shortcutKey) {
    const slotIndex = SHORTCUT_ORDER.indexOf(shortcutKey);
    if (slotIndex < 0) return false;

    const slotCards = Array.from(els.slotList.querySelectorAll('.slot-card'));
    const targetCard = slotCards[slotIndex];
    if (!targetCard) return false;

    const focusTarget = targetCard.querySelector('[data-field="name"]')
        || targetCard.querySelector('input, select, textarea, button');

    if (!focusTarget) return false;

    targetCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    focusTarget.focus();
    if (typeof focusTarget.select === 'function' && focusTarget.matches('input[type="text"]')) {
        focusTarget.select();
    }
    setStatus(t('live_effects_panel.status_slot_focused', 'Slot {index} alanina gidildi.', {
        index: slotIndex + 1
    }));
    return true;
}

function focusProfileSelect() {
    if (!els.profileSelect) return false;
    els.profileSelect.focus();
    setStatus(t('live_effects_panel.status_profile_focused', 'Profil seçimine gidildi.'));
    return true;
}

function getFocusedSlotCard() {
    const activeElement = document.activeElement;
    if (!activeElement) return null;
    return activeElement.closest('.slot-card');
}

async function toggleFocusedSlotPreview() {
    const card = getFocusedSlotCard();
    if (!card) {
        setStatus(t('live_effects_panel.status_preview_no_slot', 'Önizleme için önce bir slot alanına gidin.'));
        return false;
    }

    const slotId = card.dataset.slotId || '';
    const sourceInput = card.querySelector('[data-field="sourcePath"]');
    const sourcePath = sourceInput ? sourceInput.value.trim() : '';
    if (!sourcePath) {
        setStatus(t('live_effects_panel.status_preview_missing_source', 'Bu slotta oynatilacak bir medya dosyasi yok.'));
        return false;
    }

    const audio = ensurePreviewAudio();
    if (state.previewSlotId === slotId && !audio.paused && !audio.ended) {
        audio.pause();
        audio.currentTime = 0;
        state.previewSlotId = null;
        setStatus(t('live_effects_panel.status_preview_stopped', 'Slot onizlemesi durduruldu.'));
        return true;
    }

    try {
        audio.pause();
        audio.currentTime = 0;
    } catch (error) { }

    audio.src = sourcePath;
    state.previewSlotId = slotId;
    try {
        await audio.play();
        const slotTitle = card.querySelector('strong')?.textContent?.trim() || t('live_effects_panel.slot_label', 'Slot');
        setStatus(t('live_effects_panel.status_preview_playing', '{slot} onizlemesi caliyor.', {
            slot: slotTitle
        }));
        return true;
    } catch (error) {
        state.previewSlotId = null;
        setStatus(t('live_effects_panel.status_preview_failed', 'Slot onizlemesi baslatilamadi.'));
        return false;
    }
}

function handleKeydown(event) {
    if (event.altKey && event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const lowerKey = String(event.key || '').toLowerCase();
        if (lowerKey === 'p') {
            event.preventDefault();
            closePanel();
            return;
        }
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        // These are dialog-local navigation shortcuts, so they intentionally stay
        // fixed here instead of being exposed in the global keyboard manager.
        const lowerKey = String(event.key || '').toLowerCase();

        if (lowerKey === 'k') {
            event.preventDefault();
            saveActiveProfile();
            return;
        }

        if (lowerKey === 'p') {
            event.preventDefault();
            toggleFocusedSlotPreview();
            return;
        }

        if (lowerKey === 'r') {
            event.preventDefault();
            focusProfileSelect();
            return;
        }

        if (SHORTCUT_ORDER.includes(event.key)) {
            event.preventDefault();
            focusSlotByShortcutKey(event.key);
            return;
        }
    }

}

function bindEvents() {
    els.profileSelect.addEventListener('change', async () => {
        await selectProfile(els.profileSelect.value);
    });
    els.btnSaveProfile.addEventListener('click', saveActiveProfile);
    els.btnNewProfile.addEventListener('click', createProfile);
    els.btnBulkImport.addEventListener('click', bulkImportMedia);
    els.btnDeleteProfile.addEventListener('click', deleteActiveProfile);
    if (els.btnClosePanel) {
        els.btnClosePanel.addEventListener('click', closePanel);
    }
    els.slotList.addEventListener('click', async (event) => {
        const fileButton = event.target.closest('button[data-action="browse"]');
        if (fileButton) {
            await browseSlotFile(fileButton);
            return;
        }
        const imageButton = event.target.closest('button[data-action="browse-image"]');
        if (imageButton) {
            await browseSlotImage(imageButton);
        }
    });
    els.slotList.addEventListener('input', handleSlotInputChange);
    document.addEventListener('keydown', handleKeydown);
}

async function init() {
    await i18nState.init();
    bindEvents();
    await loadState();
    setStatus(t(
        'live_effects_panel.shortcuts_announcement',
        'Alt+R ile profil seçimine gidebilir, Alt+1-0 ile slotlar arasında geçebilir, Alt+P ile bulunduğunuz slotu oynatip durdurabilir, Alt+Ctrl+P ile paneli kapatabilirsiniz.'
    ));
}

init().catch((error) => {
    console.error('[LiveEffectsPanel] Init failed:', error);
    setStatus(`${t('live_effects_panel.status_error', 'Bir hata olustu')}: ${error.message}`);
});
