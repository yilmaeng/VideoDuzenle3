const UpdateManager = {
    updateUrl: 'https://evd.drenginyilmaz.net/update.json',
    currentVersion: '0.0.0',
    isPortableMode: false,
    startupCheckDone: false,
    pendingUpdateInfo: null,
    pendingPromptFlushTimer: null,

    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },

    setCurrentVersion(version) {
        if (typeof version === 'string' && version.trim()) {
            this.currentVersion = version.trim();
        }
    },

    setPortableMode(isPortable) {
        this.isPortableMode = isPortable === true;
    },

    shouldCheckOnStartup() {
        return Settings.get('checkForUpdatesOnStartup') !== false;
    },

    shouldDelayPrompt() {
        return !!window.StartupWelcome?.dialog?.open;
    },

    async checkForUpdatesOnStartup() {
        if (this.startupCheckDone || !this.shouldCheckOnStartup()) {
            return;
        }

        this.startupCheckDone = true;
        await this.checkForUpdates({ silent: true, announceIfCurrent: false });
    },

    async maybeShowPendingUpdatePrompt() {
        if (!this.pendingUpdateInfo || this.shouldDelayPrompt()) {
            return false;
        }

        const info = this.pendingUpdateInfo;
        this.pendingUpdateInfo = null;
        if (this.pendingPromptFlushTimer) {
            clearInterval(this.pendingPromptFlushTimer);
            this.pendingPromptFlushTimer = null;
        }
        await this.showUpdatePrompt(info);
        return true;
    },

    schedulePendingPromptFlush() {
        if (this.pendingPromptFlushTimer) {
            return;
        }

        this.pendingPromptFlushTimer = setInterval(() => {
            if (!this.pendingUpdateInfo) {
                clearInterval(this.pendingPromptFlushTimer);
                this.pendingPromptFlushTimer = null;
                return;
            }

            this.maybeShowPendingUpdatePrompt();
        }, 500);
    },

    parseVersion(version) {
        return String(version || '')
            .split('.')
            .map((part) => parseInt(part, 10))
            .map((part) => (Number.isFinite(part) ? part : 0));
    },

    compareVersions(a, b) {
        const left = this.parseVersion(a);
        const right = this.parseVersion(b);
        const maxLength = Math.max(left.length, right.length);

        for (let index = 0; index < maxLength; index += 1) {
            const leftPart = left[index] || 0;
            const rightPart = right[index] || 0;
            if (leftPart > rightPart) return 1;
            if (leftPart < rightPart) return -1;
        }

        return 0;
    },

    getPreferredLanguage() {
        const rawLanguage = window.i18nHelper?.currentLang || document.documentElement?.lang || 'en';
        return String(rawLanguage || 'en').trim().toLowerCase();
    },

    getLocalizedReleaseNotes(info) {
        if (!info) return '';

        if (typeof info.notes === 'string' && info.notes.trim()) {
            return info.notes.trim();
        }

        const releaseNotes = info.releaseNotes;
        if (!releaseNotes || typeof releaseNotes !== 'object') {
            return '';
        }

        const language = this.getPreferredLanguage();
        const baseLanguage = language.split('-')[0];
        const candidates = [language, baseLanguage, 'en', 'tr'];

        for (const candidate of candidates) {
            if (typeof releaseNotes[candidate] === 'string' && releaseNotes[candidate].trim()) {
                return releaseNotes[candidate].trim();
            }
        }

        return '';
    },

    async fetchUpdateInfo() {
        const response = await fetch(this.updateUrl, {
            method: 'GET',
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(this.t('runtime.update.http_error', 'Update information could not be retrieved. HTTP {status}', {
                status: response.status
            }));
        }

        return response.json();
    },

    async checkForUpdates({ silent = false, announceIfCurrent = false } = {}) {
        try {
            const info = await this.fetchUpdateInfo();
            const latestVersion = String(info?.version || '').trim();
            if (!latestVersion) {
                throw new Error(this.t('runtime.update.invalid_file', 'The update file is missing a valid version number.'));
            }

            if (this.compareVersions(latestVersion, this.currentVersion) <= 0) {
                if (announceIfCurrent) {
                    Accessibility.announce(this.t('runtime.update.up_to_date', 'You are using the latest version.'));
                }
                return { updateAvailable: false, info };
            }

            if (this.shouldDelayPrompt()) {
                this.pendingUpdateInfo = info;
                this.schedulePendingPromptFlush();
                return { updateAvailable: true, info, deferred: true };
            }

            await this.showUpdatePrompt(info);
            return { updateAvailable: true, info };
        } catch (error) {
            console.error('Update check failed:', error);
            if (!silent) {
                Accessibility.announce(this.t('runtime.update.check_failed', 'Update check failed: {error}', {
                    error: error.message || String(error)
                }));
            }
            return { updateAvailable: false, error };
        }
    },

    async showUpdatePrompt(info) {
        const latestVersion = String(info.version || '').trim();
        const releaseNotes = this.getLocalizedReleaseNotes(info);
        const result = await Dialogs.showAccessibleChoice({
            title: this.t('runtime.update.available_title', 'New Version Available'),
            message: this.t(
                'runtime.update.available_message',
                'A new version of EVD is available. Current version: {current}. New version: {latest}. Do you want to open the download page now?',
                {
                    current: this.currentVersion,
                    latest: latestVersion
                }
            ),
            buttons: [
                this.t('runtime.update.download_now', 'Download'),
                this.t('runtime.update.later', 'Later')
            ],
            cancelValue: 1,
            focusIndex: 0,
            details: releaseNotes,
            detailsLabel: this.t('runtime.update.release_notes_label', 'Release notes')
        });

        if (result === 0) {
            const platform = String(window.api?.platform || '').toLowerCase();
            const preferPortable = platform === 'win32' && this.isPortableMode === true;
            const downloadUrl = platform === 'darwin'
                ? (info.macUrl || info.url || info.downloadUrl || '')
                : preferPortable
                    ? (info.portableUrl || info.setupUrl || info.url || info.downloadUrl || '')
                    : (info.setupUrl || info.url || info.downloadUrl || info.portableUrl || '');
            if (downloadUrl) {
                const openExternalUrl = window.api && typeof window.api.openExternalUrl === 'function'
                    ? window.api.openExternalUrl.bind(window.api)
                    : null;
                const openExternal = window.api && typeof window.api.openExternal === 'function'
                    ? window.api.openExternal.bind(window.api)
                    : null;

                if (openExternalUrl) {
                    const openResult = await openExternalUrl(downloadUrl);
                    if (!openResult || openResult.success !== true) {
                        throw new Error(openResult?.error || 'open_external_failed');
                    }
                } else if (openExternal) {
                    await openExternal(downloadUrl);
                } else if (typeof window.open === 'function') {
                    window.open(downloadUrl, '_blank', 'noopener');
                } else {
                    throw new Error('openExternal_unavailable');
                }
                Accessibility.announce(this.t('runtime.update.download_opened', 'The download page was opened in your browser.'));
            } else {
                Accessibility.announce(this.t('runtime.update.download_missing', 'The update file does not contain a download link.'));
            }
        }
    }
};

window.UpdateManager = UpdateManager;
