(() => {
    'use strict';
    // Account and room actions use native form navigation; no desktop shortcuts are intercepted.
    const $ = id => document.getElementById(id);
    let context, rooms = [], editing = null, deleting = null, originControl = null, busy = false;
    const t = key => context.t(key);
    function close(id, focus = true) {
        $(id).close();
        $('room-password').value = ''; $('link-key').value = '';
        if (focus) (originControl?.isConnected ? originControl : $('rooms-heading')).focus();
    }
    function open(id, origin) { originControl = origin; $(id).showModal(); }
    function passwordFields() { $('room-password-fields').hidden = !$('room-password-enabled').checked; }
    function form(room, origin) {
        editing = room || null;
        $('room-title').value = room?.title || '';
        $('room-kind').value = room?.persistent === false ? 'temporary' : 'persistent';
        $('room-kind').disabled = !!room;
        $('room-password-enabled').checked = room?.passwordEnabled === true;
        $('room-password').value = ''; $('room-error').textContent = '';
        $('room-absent').checked = room?.allowJoinWhenHostAbsent === true;
        if ($('room-waiting-enabled')) $('room-waiting-enabled').checked = room?.waitingRoomEnabled === true;
        if ($('room-waiting-decision')) $('room-waiting-decision').value = '';
        for (const [id, key] of [['room-microphone', 'allowGuestMicrophone'], ['room-camera', 'allowGuestCamera'], ['room-share', 'allowGuestScreenShare']]) $(id).checked = room?.[key] !== false;
        passwordFields(); open('room-dialog', origin); $('room-title').focus();
    }
    function render() {
        window.EvdAdminRecordings?.setRooms(rooms);
        $('rooms-empty').hidden = rooms.length > 0;
        const fragment = document.createDocumentFragment();
        for (const room of rooms) {
            const item = document.createElement('li');
            const heading = document.createElement('h3'); heading.textContent = room.title; item.append(heading);
            const detail = document.createElement('p'); detail.textContent = t(room.persistent ? 'room_persistent' : 'room_temporary') + (room.accessRole === 'manager' ? ` · ${t('manager_active')}` : ''); item.append(detail);
            const link = document.createElement('a'); link.href = room.inviteUrl; link.textContent = t('room_guest_link'); item.append(link);
            const hostLink = document.createElement('a');
            const hostUrl = new URL(room.inviteUrl); hostUrl.searchParams.set('host', '1'); hostUrl.searchParams.set('lang', document.documentElement.lang);
            hostLink.href = hostUrl.href; hostLink.textContent = `${t('meeting_join')}: ${room.title}`; item.append(hostLink);
            if (room.accessRole === 'manager') { fragment.append(item); continue; }
            for (const [key, handler] of [
                ['room_copy', async () => { await navigator.clipboard.writeText(room.inviteUrl); context.status('room_copied'); }],
                ['manager_title', button => window.EvdAdminManagers.open(room, button)],
                ['room_edit', button => form(room, button)],
                ['room_delete', button => { deleting = room; $('delete-room-name').textContent = room.title; $('delete-error').textContent = ''; open('delete-dialog', button); }]
            ]) {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = t(key);
                button.setAttribute('aria-label', `${t(key)}: ${room.title}`);
                button.addEventListener('click', () => Promise.resolve(handler(button)).catch(() => context.status('request_failed')));
                item.append(button);
            }
            fragment.append(item);
        }
        // Only replace on an explicit refresh or a completed mutation, never on a timer.
        $('room-list').replaceChildren(fragment);
    }
    async function refresh() { rooms = (await context.request('/rooms')).rooms; render(); }
    function acceptRoom(room) { rooms = rooms.filter(item => item.roomId !== room.roomId).concat(room); render(); }
    async function mutation(errorId, work) {
        if (busy) return;
        context.status('');
        busy = true; $(errorId).textContent = t('working');
        const dialog = $(errorId).closest('dialog');
        dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try { await work(); } catch (error) {
            const allowed = ['waiting_setting_invalid','waiting_disable_decision_required','session_required','room_link_invalid','room_not_found','room_title_invalid','room_settings_invalid','room_password_required','room_limit','room_busy','room_delete_confirmation','rate_limited'];
            $(errorId).textContent = t(allowed.includes(error.message) ? error.message : 'request_failed');
        } finally { busy = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
    }
    document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => close(button.dataset.closeDialog)));
    for (const id of ['room-dialog', 'link-dialog', 'delete-dialog']) $(id).addEventListener('cancel', event => { event.preventDefault(); if (!busy) close(id); });
    $('new-room').addEventListener('click', event => form(null, event.currentTarget));
    $('refresh-rooms').addEventListener('click', () => refresh().then(() => context.status('rooms_refreshed')).catch(() => context.status('request_failed')));
    $('link-room').addEventListener('click', event => { $('link-error').textContent = ''; open('link-dialog', event.currentTarget); $('link-invite').focus(); });
    $('room-password-enabled').addEventListener('change', passwordFields);
    $('room-form').addEventListener('submit', event => {
        event.preventDefault(); mutation('room-error', async () => {
            const body = { title: $('room-title').value, persistent: $('room-kind').value === 'persistent',
                passwordEnabled: $('room-password-enabled').checked, password: $('room-password').value,
                allowJoinWhenHostAbsent: $('room-absent').checked, allowGuestMicrophone: $('room-microphone').checked,
                allowGuestCamera: $('room-camera').checked, allowGuestScreenShare: $('room-share').checked };
            if ($('room-waiting-enabled')) body.waitingRoomEnabled = $('room-waiting-enabled').checked;
            if ($('room-waiting-decision')) body.waitingRoomDecision = $('room-waiting-decision').value;
            const result = await context.request(editing ? `/rooms/${encodeURIComponent(editing.roomId)}/settings` : '/rooms', body);
            acceptRoom(result.room); close('room-dialog'); context.status('room_saved');
        });
    });
    $('link-form').addEventListener('submit', event => {
        event.preventDefault(); mutation('link-error', async () => {
            const result = await context.request('/rooms/link', { inviteId: $('link-invite').value, ownerKey: $('link-key').value });
            acceptRoom(result.room); close('link-dialog'); context.status('room_linked');
        });
    });
    $('confirm-delete').addEventListener('click', () => mutation('delete-error', async () => {
        await context.request(`/rooms/${encodeURIComponent(deleting.roomId)}/delete`, { confirm: true });
        rooms = rooms.filter(item => item.roomId !== deleting.roomId); render(); close('delete-dialog'); context.status('room_deleted');
    }));
    window.EvdAdminRooms = {
        async start(value) { context = value; await refresh(); },
        refresh,
        translate() { if (context) render(); },
        clear() { rooms = []; if (context) render(); for (const id of ['room-dialog','link-dialog','delete-dialog']) close(id, false); }
    };
})();
