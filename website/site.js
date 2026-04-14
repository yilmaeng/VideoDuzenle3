(function () {
    const siteText = window.__EVD_SITE_TEXT || {};
    const preferredKey = 'evd-site-language';
    const tutorialPlaylistId = 'PLHs9m0QEyULCSQ7kIonyUQ5AXl5NwNGHQ';
    const tutorialPlaylistUrl = `https://www.youtube.com/playlist?list=${tutorialPlaylistId}`;
    const tutorialJsonUrl = '/tutorials.json';

    function safeText(key, fallback) {
        return Object.prototype.hasOwnProperty.call(siteText, key) ? siteText[key] : fallback;
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
                const releaseDate = release.date || '-';
                const channel = release.channel ? `<span class="release-badge">${release.channel}</span>` : '';
                const setupButton = release.setupUrl
                    ? `<a class="btn btn-primary" href="/${release.setupUrl}">${safeText('setupLabel', 'Windows Setup')}</a>`
                    : '';
                const portableButton = release.portableUrl
                    ? `<a class="btn btn-secondary" href="/${release.portableUrl}">${safeText('portableLabel', 'Portable')}</a>`
                    : '';
                const notesButton = release.notesUrl
                    ? `<a class="btn btn-secondary" href="/${release.notesUrl}">${safeText('notesLabel', 'Release Notes')}</a>`
                    : '';

                return `
                    <section class="release-card" aria-label="${release.title || release.version || 'EVD release'}">
                        <div class="release-meta">
                            ${channel}
                            <span>${safeText('versionLabel', 'Version')}: ${release.version || '-'}</span>
                            <span>${safeText('dateLabel', 'Date')}: ${releaseDate}</span>
                        </div>
                        <h3>${release.title || `EVD ${release.version || ''}`}</h3>
                        <p>${release.notes || safeText('releaseFallback', 'No description was added for this release yet.')}</p>
                        <div class="release-actions">
                            ${setupButton}
                            ${portableButton}
                            ${notesButton}
                        </div>
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
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString(document.documentElement.lang || 'en', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
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
