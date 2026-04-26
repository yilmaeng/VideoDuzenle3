const StartupWelcome = {
    dialog: null,
    actionsList: null,
    hideCheckbox: null,
    updateCheckbox: null,
    closeButton: null,
    placeholder: null,
    quickStartDialog: null,
    quickStartMoreButton: null,
    quickStartCloseButton: null,
    optionElements: [],
    selectedIndex: 0,
    settingsKey: 'showStartupWelcome',
    eventsSetup: false,
    pendingAction: '',

    isExternalLaunch() {
        try {
            return new URLSearchParams(window.location.search).get('externalLaunch') === '1';
        } catch (error) {
            return false;
        }
    },

    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },

    init() {
        this.dialog = document.getElementById('startup-welcome-dialog');
        this.actionsList = document.getElementById('startup-welcome-actions');
        this.hideCheckbox = document.getElementById('startup-welcome-hide');
        this.updateCheckbox = document.getElementById('startup-welcome-check-updates');
        this.closeButton = document.getElementById('startup-welcome-close');
        this.placeholder = document.getElementById('video-placeholder');
        this.quickStartDialog = document.getElementById('startup-quick-start-dialog');
        this.quickStartMoreButton = document.getElementById('startup-quick-start-more');
        this.quickStartCloseButton = document.getElementById('startup-quick-start-close');
        this.optionElements = Array.from(this.actionsList?.querySelectorAll('[role="option"]') || []);

        if (!this.dialog || !this.actionsList || this.optionElements.length === 0) {
            return;
        }

        if (this.hideCheckbox) {
            this.hideCheckbox.checked = Settings.get(this.settingsKey) === false;
        }
        if (this.updateCheckbox) {
            this.updateCheckbox.checked = Settings.get('checkForUpdatesOnStartup') !== false;
        }

        this.setupEventListeners();
    },

    setupEventListeners() {
        if (this.eventsSetup) return;

        this.optionElements.forEach((option, index) => {
            option.addEventListener('click', () => {
                this.selectIndex(index, { focus: true });
                this.activateSelectedAction();
            });
        });

        this.actionsList.addEventListener('keydown', (event) => {
            this.handleListNavigation(event);
        });

        this.closeButton?.addEventListener('click', () => {
            this.close();
        });

        this.quickStartCloseButton?.addEventListener('click', () => {
            this.quickStartDialog?.close();
        });

        this.quickStartMoreButton?.addEventListener('click', () => {
            this.quickStartDialog?.close();
            Dialogs.showHelpDialog();
        });

        this.hideCheckbox?.addEventListener('change', () => {
            this.persistPreference();
        });

        this.updateCheckbox?.addEventListener('change', () => {
            this.persistPreference();
        });

        this.dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            this.close();
        });

        this.dialog.addEventListener('close', () => {
            this.persistPreference();
            if (window.Keyboard) window.Keyboard.setEnabled(true);
            if (this.pendingAction) {
                const action = this.pendingAction;
                this.pendingAction = '';
                window.App?.runLaunchAction?.(action);
            }
        });

        this.quickStartDialog?.addEventListener('close', () => {
            if (window.Keyboard) window.Keyboard.setEnabled(true);
        });

        window.api?.i18n?.onLanguageChanged?.(() => {
            if (this.dialog?.open) {
                this.selectIndex(this.selectedIndex, { focus: false });
            }
        });

        this.eventsSetup = true;
    },

    shouldShow() {
        if (this.isExternalLaunch()) {
            return false;
        }

        return Settings.get(this.settingsKey) !== false;
    },

    showIfNeeded() {
        if (!this.shouldShow() || this.dialog?.open) {
            return;
        }

        this.show();
    },

    show(options = {}) {
        if (!this.dialog) return;
        const force = options.force === true;

        this.selectIndex(0, { focus: false });
        this.hideCheckbox.checked = Settings.get(this.settingsKey) === false;
        if (this.updateCheckbox) {
            this.updateCheckbox.checked = Settings.get('checkForUpdatesOnStartup') !== false;
        }

        if (window.Keyboard) window.Keyboard.setEnabled(false);
        this.setPlaceholderVisibility(false);
        this.dialog.showModal();

        setTimeout(() => {
            const selected = this.optionElements[this.selectedIndex];
            selected?.focus();
        }, 50);

        Accessibility.announce(this.t(
            'runtime.startup_welcome.dialog_opened',
            'Welcome screen opened. Use the arrow keys to choose an action and press Enter to continue.'
        ));

        setTimeout(() => {
            if (!force) {
                window.UpdateManager?.checkForUpdatesOnStartup?.();
            }
        }, 500);
    },

    close() {
        if (!this.dialog?.open) return;
        this.persistPreference();
        this.setPlaceholderVisibility(true);
        this.dialog.close();

        setTimeout(() => {
            if (window.App?.handlePostStartupTasks) {
                window.App.handlePostStartupTasks();
            }
        }, 80);
    },

    setPlaceholderVisibility(visible) {
        if (!this.placeholder) return;

        this.placeholder.style.display = visible ? '' : 'none';
        this.placeholder.setAttribute('aria-hidden', 'true');
    },

    persistPreference() {
        const shouldShow = !(this.hideCheckbox?.checked);
        Settings.set(this.settingsKey, shouldShow);
        Settings.set('checkForUpdatesOnStartup', this.updateCheckbox?.checked !== false);
    },

    selectIndex(index, { focus = false } = {}) {
        if (!this.optionElements.length) return;

        const normalizedIndex = (index + this.optionElements.length) % this.optionElements.length;
        this.selectedIndex = normalizedIndex;

        this.optionElements.forEach((option, optionIndex) => {
            const isSelected = optionIndex === normalizedIndex;
            option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            option.setAttribute('tabindex', isSelected ? '0' : '-1');
            option.classList.toggle('selected', isSelected);
        });

        if (focus) {
            this.optionElements[normalizedIndex]?.focus();
        }
    },

    handleListNavigation(event) {
        if (!this.dialog?.open) return;

        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            event.preventDefault();
            this.selectIndex(this.selectedIndex + 1, { focus: true });
            return;
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            event.preventDefault();
            this.selectIndex(this.selectedIndex - 1, { focus: true });
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            this.selectIndex(0, { focus: true });
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            this.selectIndex(this.optionElements.length - 1, { focus: true });
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.activateSelectedAction();
        }
    },

    activateSelectedAction() {
        const selected = this.optionElements[this.selectedIndex];
        const action = selected?.dataset?.action;
        if (!action) return;

        this.pendingAction = action;
        this.close();
    },

    showQuickStartDialog() {
        if (!this.quickStartDialog) return;

        if (window.Keyboard) window.Keyboard.setEnabled(false);
        this.quickStartDialog.showModal();

        setTimeout(() => {
            this.quickStartMoreButton?.focus();
        }, 50);

        Accessibility.announce(this.t(
            'runtime.startup_welcome.quick_start_opened',
            'Quick Start guide opened. You can continue with More Information for the full help content.'
        ));
    }
};

window.StartupWelcome = StartupWelcome;

document.addEventListener('DOMContentLoaded', () => {
    StartupWelcome.init();
});
