(function () {
    const siteText = window.__EVD_SITE_TEXT || {};
    const preferredKey = 'evd-site-language';
    const tutorialPlaylistId = 'PLHs9m0QEyULCSQ7kIonyUQ5AXl5NwNGHQ';
    const tutorialPlaylistUrl = `https://www.youtube.com/playlist?list=${tutorialPlaylistId}`;
    const assetVersion = '4.9.0';
    const tutorialJsonUrl = `/tutorials.json?v=${assetVersion}`;

    function safeText(key, fallback) {
        return Object.prototype.hasOwnProperty.call(siteText, key) ? siteText[key] : fallback;
    }

    function parseStableDate(value) {
        if (!value || typeof value !== 'string') return null;
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            const fallback = new Date(value);
            return Number.isNaN(fallback.getTime()) ? null : fallback;
        }

        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        return new Date(Date.UTC(year, month, day, 12, 0, 0));
    }

    function formatReleaseDate(value) {
        if (!value) return '-';
        const date = parseStableDate(value);
        if (!date) return value;

        return date.toLocaleDateString(document.documentElement.lang || 'en', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC'
        });
    }

    function localizedValue(value, fallback = '') {
        if (!value || typeof value !== 'object') {
            return value || fallback;
        }
        const lang = String(document.documentElement.lang || 'en').toLowerCase().split('-')[0] || 'en';
        return value[lang] || value.en || value.tr || fallback;
    }

    function rememberLanguage() {
        const links = document.querySelectorAll('[data-lang-code]');
        links.forEach((link) => {
            link.addEventListener('click', () => {
                try {
                    localStorage.setItem(preferredKey, link.getAttribute('data-lang-code') || '');
                } catch (error) {
                    console.warn('Preferred language could not be stored.', error);
                }
            });
        });
    }

    async function loadReleases() {
        const releaseList = document.getElementById('release-list');
        if (!releaseList) return;

        try {
            const response = await fetch('/releases.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const releases = Array.isArray(data.releases) ? data.releases : [];

            if (!releases.length) {
                releaseList.innerHTML = `<p class="release-empty">${safeText('noReleases', 'No published releases are available yet.')}</p>`;
                return;
            }

            releaseList.innerHTML = releases.map((release) => {
                const releaseDate = formatReleaseDate(release.date);
                const setupButton = release.setupUrl
                    ? `<a class="btn btn-primary" href="/${release.setupUrl}">${safeText('setupLabel', 'Windows Setup')}</a>`
                    : '';
                const portableButton = release.portableUrl
                    ? `<a class="btn btn-secondary" href="/${release.portableUrl}">${safeText('portableLabel', 'Portable')}</a>`
                    : '';
                const macButton = release.macUrl
                    ? `<a class="btn btn-secondary" href="/${release.macUrl}">${safeText('macLabel', 'Download for Mac (Apple Silicon)')}</a>`
                    : '';
                const notesButton = release.notesUrl
                    ? `<a class="btn btn-secondary" href="/${release.notesUrl}">${safeText('notesLabel', 'Release Notes')}</a>`
                    : '';
                const lang = String(document.documentElement.lang || 'en').toLowerCase().split('-')[0] || 'en';
                const guideUrl = release.guideUrls && typeof release.guideUrls === 'object'
                    ? (release.guideUrls[lang] || release.guideUrls.en || release.guideUrls.tr || '')
                    : (release.guideUrl || '');
                const guideButton = guideUrl
                    ? `<a class="btn btn-secondary" href="/${guideUrl}">${safeText('guideLabel', 'Broadcast Room Guide')}</a>`
                    : '';

                const macBeta = release.macBeta && typeof release.macBeta === 'object' ? release.macBeta : null;
                const macBetaId = `mac-beta-${String(release.version || 'release').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                const macBetaBlock = macBeta && macBeta.url
                    ? `
                        <section class="mac-beta" aria-labelledby="${macBetaId}">
                            <h4 id="${macBetaId}">${safeText('macBetaTitle', 'Public Beta for Mac')}</h4>
                            <p class="mac-beta-platform">${safeText('macBetaPlatform', 'macOS · Apple Silicon (arm64)')}</p>
                            <p class="mac-beta-warning" role="note">${safeText('macBetaWarning', 'OBS and native helper support are not available in this beta yet. They are coming soon.')}</p>
                            <div class="release-actions">
                                <a class="btn btn-primary" href="/${macBeta.url}">${safeText('macBetaLabel', 'Download Mac Public Beta')}</a>
                            </div>
                        </section>
                    `
                    : '';
                const localizedTitle = localizedValue(release.title, `EVD ${release.version || ''}`);
                const localizedNotes = localizedValue(release.notes, safeText('releaseFallback', 'No description was added for this release yet.'));
                const localizedChannel = localizedValue(release.channel, release.channel || '');
                const channelBadge = localizedChannel ? `<span class="release-badge">${localizedChannel}</span>` : '';

                return `
                    <section class="release-card" aria-label="${localizedTitle || release.version || 'EVD release'}">
                        <div class="release-meta">
                            ${channelBadge}
                            <span>${safeText('versionLabel', 'Version')}: ${release.version || '-'}</span>
                            <span>${safeText('dateLabel', 'Date')}: ${releaseDate}</span>
                        </div>
                        <h3>${localizedTitle}</h3>
                        <p>${localizedNotes}</p>
                        <div class="release-actions">
                            ${setupButton}
                            ${portableButton}
                            ${macButton}
                            ${notesButton}
                            ${guideButton}
                        </div>
                        ${macBetaBlock}
                    </section>
                `;
            }).join('');
        } catch (error) {
            releaseList.innerHTML = `<p class="release-empty">${safeText('releaseError', 'Releases could not be loaded. Please try again later.')}</p>`;
            console.error('Release list could not be loaded:', error);
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatTutorialDate(value) {
        if (!value) return '';
        const date = parseStableDate(value);
        if (!date) return value;
        return date.toLocaleDateString(document.documentElement.lang || 'en', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC'
        });
    }

    async function loadTutorials() {
        const tutorialList = document.getElementById('tutorial-list');
        if (!tutorialList) return;

        try {
            const response = await fetch(tutorialJsonUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const entries = Array.isArray(data.items) ? data.items.slice(0, 5) : [];

            if (!entries.length) {
                tutorialList.innerHTML = `<p class="release-empty">${safeText('noTutorials', 'No public tutorials are available yet.')}</p>`;
                return;
            }

            tutorialList.innerHTML = entries.map((entry) => {
                const videoId = entry.videoId || '';
                const title = entry.title || 'YouTube';
                const published = entry.published || '';
                const videoUrl = entry.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : (data.playlistUrl || tutorialPlaylistUrl));
                const thumbUrl = entry.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');

                return `
                    <article class="tutorial-card">
                        ${thumbUrl ? `<img class="tutorial-thumb" src="${thumbUrl}" alt="${escapeHtml(title)}">` : ''}
                        <div class="tutorial-body">
                            <h3>${escapeHtml(title)}</h3>
                            <div class="tutorial-meta">${safeText('tutorialDateLabel', 'Published')}: ${escapeHtml(formatTutorialDate(published) || '-')}</div>
                            <div class="release-actions">
                                <a class="btn btn-primary" href="${videoUrl}" target="_blank" rel="noopener noreferrer">${safeText('tutorialWatchLabel', 'Open video')}</a>
                            </div>
                        </div>
                    </article>
                `;
            }).join('');
        } catch (error) {
            tutorialList.innerHTML = `<p class="release-empty">${safeText('tutorialError', 'Tutorials could not be loaded right now. Please use the playlist link below.')}</p>`;
            console.error('Tutorial feed could not be loaded:', error);
        }
    }

    rememberLanguage();
    loadReleases();
    loadTutorials();
})();
