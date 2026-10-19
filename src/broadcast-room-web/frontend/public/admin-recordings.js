(() => {
    const $ = id => document.getElementById(id);
    let context, rooms = [], rows = [], enabled = false, busy = false, timer = null, fetching = false, generation = 0;
    let recordingConsent = {}, consentKey = '';
    let deleting = null, deleteOrigin = null, deleteBusy = false;
    function closeDelete() {
        if (deleteBusy) return;
        $('recording-delete-dialog').close(); deleting = null;
        (deleteOrigin?.isConnected && !deleteOrigin.disabled && !deleteOrigin.hidden ? deleteOrigin : $('recording-refresh')).focus();
    }
    const t = key => context.t(key);
    const pending = row => ['starting','active','pausing','paused','assembling','ending','unknown'].includes(row.status);
    const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const setAttribute = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
    function render() {
        if (!context) return;
        const selected = $('recording-room').value;
        const signature = JSON.stringify(rooms.map(room => [room.roomId, room.title]));
        if ($('recording-room').dataset.signature !== signature) {
            $('recording-room').replaceChildren(...rooms.map(room => {
                const option = document.createElement('option'); option.value = room.roomId; option.textContent = room.title; return option;
            }));
            if (rooms.some(room => room.roomId === selected)) $('recording-room').value = selected;
            $('recording-room').dataset.signature = signature;
        }
        const roomId = $('recording-room').value, consent = recordingConsent[roomId];
        const nextConsentKey = `${roomId}:${consent?.key || ''}`;
        if (nextConsentKey !== consentKey || consent?.confirmed) $('recording-consent').checked = consent?.confirmed === true;
        consentKey = nextConsentKey;
        $('recording-start').disabled = busy || !enabled || !rooms.length || rows.some(row => row.roomId === $('recording-room').value && pending(row));
        $('recording-refresh').disabled = busy;
        setText($('recording-availability'), t(enabled ? 'recording_available' : 'recording_unavailable'));
        const list = $('recording-list');
        for (const row of rows) {
            let item = Array.from(list.children).find(node => node.dataset.id === row.id);
            if (!item) {
                item = document.createElement('li'); item.dataset.id = row.id;
                item.append(document.createElement('h3'), document.createElement('p'), document.createElement('button'), document.createElement('a'), document.createElement('button'), document.createElement('button'), document.createElement('a'), document.createElement('button'), document.createElement('a'));
                const remove = item.children[7]; remove.type = 'button';
                remove.addEventListener('click', () => {
                    deleting = row.id; deleteOrigin = remove;
                    const name = `${row.title} · ${new Date(row.createdAt).toLocaleString(document.documentElement.lang)}`;
                    $('recording-delete-description').textContent = t('recording_delete_confirmation').replace('{name}', name);
                    $('recording-delete-error').textContent = '';
                    $('recording-delete-dialog').showModal(); $('recording-delete-description').focus();
                });
                const button = item.children[2]; button.type = 'button';
                button.addEventListener('click', () => act(async () => { await context.request(`/recordings/${encodeURIComponent(row.id)}/stop`, {}); await refresh(false); }));
                // Append controls to preserve the existing 0..8 child contract.
                item.append(document.createElement('button'), document.createElement('button'), document.createElement('a'));
                for (const [index, action] of [[9, 'pause'], [10, 'resume']]) {
                    const control = item.children[index]; control.type = 'button';
                    control.addEventListener('click', () => {
                        const current = rows.find(value => value.id === row.id);
                        if (!current || current.status !== (action === 'pause' ? 'active' : 'paused')) return;
                        return act(async () => { await context.request(`/recordings/${encodeURIComponent(row.id)}/${action}`, {}); await refresh(false); });
                    });
                }
                const share = item.children[4], revoke = item.children[5], link = item.children[6];
                share.type = revoke.type = 'button'; link.hidden = true;
                share.addEventListener('click', () => act(async () => {
                    const result = await context.request(`/recordings/${encodeURIComponent(row.id)}/share`, {});
                    link.href = result.link.url; link.textContent = t('recording_share_open'); link.hidden = false; link.focus();
                }));
                revoke.addEventListener('click', () => act(async () => {
                    await context.request(`/recordings/${encodeURIComponent(row.id)}/revoke-links`, { confirm: true });
                    link.hidden = true; link.removeAttribute('href');
                }));
                list.append(item);
            }
            const [heading, detail, stop, download] = item.children;
            const title = `${row.title} · ${new Date(row.createdAt).toLocaleString(document.documentElement.lang)}`;
            if (heading.textContent !== title) heading.textContent = title;
            const value = `${t('recording_' + row.status)} ${t('recording_expires').replace('{date}', new Date(row.expiresAt).toLocaleString(document.documentElement.lang))}${row.checkFailed ? ' ' + t('recording_check_failed') : ''}${row.status === 'complete' && !row.available ? ' ' + t('recording_not_ready') : ''}`;
            if (detail.textContent !== value) detail.textContent = value;
            setText(stop, t('recording_stop')); setAttribute(stop, 'aria-label', `${t('recording_stop')}: ${row.title}`);
            stop.hidden = !pending(row); stop.disabled = busy || ['ending', 'assembling'].includes(row.status);
            for (const [index, action, status] of [[9, 'pause', 'active'], [10, 'resume', 'paused']]) {
                const control = item.children[index];
                setText(control, t('recording_' + action));
                setAttribute(control, 'aria-label', `${t('recording_' + action)}: ${title}`);
                control.hidden = !pending(row); control.disabled = busy || row.status !== status;
            }
            setText(download, t('recording_download')); download.hidden = !row.available;
            setAttribute(download, 'href', `/api/admin-auth/recordings/${encodeURIComponent(row.id)}/download?lang=${encodeURIComponent(document.documentElement.lang)}`);
            setAttribute(download, 'aria-label', `${t('recording_download')}: ${row.title}`);
            setAttribute(download, 'target', '_blank'); setAttribute(download, 'rel', 'noopener noreferrer');
            const audio = item.children[11];
            setText(audio, t('recording_download_m4a')); audio.hidden = !row.available;
            setAttribute(audio, 'href', download.getAttribute('href') + '&format=m4a');
            setAttribute(audio, 'aria-label', `${t('recording_download_m4a')}: ${title}`);
            setAttribute(audio, 'target', '_blank'); setAttribute(audio, 'rel', 'noopener noreferrer');
            const open = item.children[8];
            open.hidden = !row.available;
            setText(open, t('recording_open'));
            setAttribute(open, 'aria-label', `${t('recording_open')}: ${title}`);
            setAttribute(open, 'href', download.getAttribute('href') + '&view=1');
            setAttribute(open, 'target', '_blank'); setAttribute(open, 'rel', 'noopener noreferrer');
            const isOwner = rooms.find(room => room.roomId === row.roomId)?.accessRole === 'owner';
            item.children[4].hidden = item.children[5].hidden = !isOwner;
            item.children[4].disabled = item.children[5].disabled = busy;
            setText(item.children[4], t('recording_share'));
            setText(item.children[5], t('recording_revoke_links'));
            const remove = item.children[7];
            setText(remove, t('recording_delete'));
            setAttribute(remove, 'aria-label', `${t('recording_delete')}: ${title}`);
            remove.hidden = !row.canDelete || row.status === 'deleted';
            remove.disabled = busy || pending(row);
        }
        for (const item of Array.from(list.children)) if (!rows.some(row => row.id === item.dataset.id)) item.remove();
    }
    async function refresh(remote) {
        const current = generation;
        const result = await context.request(remote ? '/recordings/refresh' : '/recordings', remote ? {} : undefined);
        if (current !== generation) return;
        if (typeof result.enabled === 'boolean') enabled = result.enabled;
        const changes = result.recordings.filter(row => {
            const old = rows.find(item => item.id === row.id); return old && old.status !== row.status;
        });
        rows = result.recordings.filter(row => row.status !== 'deleted'); recordingConsent = result.recordingConsent || {}; render();
        if (changes.length) $('recording-message').textContent = changes.map(row => `${row.title}: ${t('recording_' + row.status)}`).join(' ');
    }
    async function act(work) {
        if (busy) return;
        busy = true; $('recording-message').textContent = t('working'); render();
        try { await work(); $('recording-message').textContent = t('recording_updated'); }
        catch (error) {
            const key = ['recording_confirmation','recording_unavailable','recording_not_found','recording_not_ready','recording_processing_failed','recording_room_empty','recording_already_running','recording_capacity','recording_disk_full','room_not_found','session_required'].includes(error.message) ? error.message : 'request_failed';
            $('recording-message').textContent = t(key);
        } finally { busy = false; render(); }
    }
    // Web-only action: native dialog buttons and Escape avoid overriding assistive-technology shortcuts.
    $('recording-delete-cancel').addEventListener('click', closeDelete);
    $('recording-delete-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDelete(); });
    $('recording-delete-confirm').addEventListener('click', async () => {
        if (deleteBusy || !deleting) return;
        deleteBusy = true;
        $('recording-delete-confirm').disabled = $('recording-delete-cancel').disabled = true;
        try {
            await context.request(`/recordings/${encodeURIComponent(deleting)}/delete`, { confirm: true });
            await refresh(false);
            deleteBusy = false; closeDelete();
            $('recording-message').textContent = t('recording_deleted');
        } catch (error) {
            $('recording-delete-error').textContent = t(error.message === 'recording_delete_running' ? error.message : 'request_failed');
        } finally {
            deleteBusy = false;
            $('recording-delete-confirm').disabled = $('recording-delete-cancel').disabled = false;
        }
    });
    $('recording-room').addEventListener('change', render);
    $('recording-refresh').addEventListener('click', () => act(() => refresh(true)));
    $('recording-form').addEventListener('submit', event => {
        event.preventDefault(); act(async () => {
            await refresh(false);
            await context.request('/recordings/start', { roomId: $('recording-room').value, confirm: $('recording-consent').checked });
            await refresh(false);
        });
    });
    // No global shortcuts: standard form controls work without overriding assistive-technology commands.
    window.EvdAdminRecordings = {
        async start(value) {
            context = value; clearInterval(timer); generation++; await refresh(false);
            timer = setInterval(async () => {
                if (fetching || busy || document.hidden) return;
                fetching = true;
                try { await refresh(false); } catch (_error) { clearInterval(timer); $('recording-message').textContent = t('recording_check_failed'); }
                finally { fetching = false; }
            }, 5000);
        },
        setRooms(value) { rooms = value; render(); },
        translate: render,
        clear() { generation++; clearInterval(timer); rows = []; rooms = []; recordingConsent = {}; consentKey = ''; $('recording-consent').checked = false; enabled = false; $('recording-list').replaceChildren(); $('recording-message').textContent = ''; render(); }
    };
})();
