(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    let context, room, origin, revoking, busy = false;
    const t = key => context.t(key);
    async function action(work, target = 'manager-dialog-status') {
        if (busy) return;
        busy = true; $(target).textContent = t('working');
        try { const pending = await work(); $(target).textContent = t(pending === true ? 'manager_mail_pending' : 'manager_done'); }
        catch (error) { $(target).textContent = t(['manager_self','manager_exists','manager_invite_invalid','email_invalid','rate_limited','mail_unavailable','room_not_found','password_policy','manager_account_exists'].includes(error.message) ? error.message : 'request_failed'); }
        finally { busy = false; }
    }
    async function invitations() {
        const result = await context.request('/managers/invitations');
        $('manager-invitations').replaceChildren(...result.invitations.map(invite => {
            const li = document.createElement('li'), description = document.createElement('p'), button = document.createElement('button');
            description.textContent = `${invite.title}: ${t(invite.recordings ? 'manager_recordings' : 'manager_no_recordings')}`;
            button.type = 'button'; button.textContent = t('manager_accept'); button.setAttribute('aria-label', `${t('manager_accept')}: ${invite.title}`);
            button.addEventListener('click', () => action(async () => {
                await context.request(`/managers/invitations/${encodeURIComponent(invite.id)}/accept`, {});
                await invitations(); await window.EvdAdminRooms.refresh(); $('manager-refresh').focus();
            }, 'manager-status'));
            li.append(description, button); return li;
        }));
    }
    async function managers() {
        const result = await context.request(`/managers/${encodeURIComponent(room.roomId)}`);
        $('manager-list').replaceChildren(...result.managers.map(manager => {
            const li = document.createElement('li'), description = document.createElement('p'), button = document.createElement('button');
            description.textContent = `${manager.email}: ${t(manager.status)}. ${t(manager.recordings ? 'manager_recordings' : 'manager_no_recordings')}`;
            button.type = 'button'; button.textContent = t('manager_revoke'); button.setAttribute('aria-label', `${t('manager_revoke')}: ${manager.email}`);
            button.addEventListener('click', () => {
                revoking = manager; $('manager-revoke-text').textContent = `${manager.email}. ${t('manager_revoke_hint')}`;
                $('manager-revoke-dialog').showModal(); $('manager-revoke-cancel').focus();
            });
            li.append(description, button); return li;
        }));
    }
    function close() { if (busy) return; $('manager-password').value = ''; $('manager-dialog').close(); origin?.focus(); }
    function cancelRevoke() { $('manager-revoke-dialog').close(); revoking = null; $('manager-email').focus(); }
    $('manager-close').addEventListener('click', close);
    $('manager-dialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
    $('manager-revoke-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelRevoke(); });
    $('manager-revoke-cancel').addEventListener('click', cancelRevoke);
    $('manager-revoke-ok').addEventListener('click', () => {
        const selected = revoking; cancelRevoke();
        if (selected) action(async () => { await context.request(`/managers/${encodeURIComponent(room.roomId)}/revoke`, { invitationId: selected.id, confirm: true }); await managers(); });
    });
    $('manager-form').addEventListener('submit', event => {
        event.preventDefault(); action(async () => {
            const password = $('manager-password').value; $('manager-password').value = '';
            const result = await context.request(`/managers/${encodeURIComponent(room.roomId)}/invite`, { email: $('manager-email').value, method: $('manager-method').value, password: $('manager-method').value === 'account' ? password : '', recordings: $('manager-recordings').checked, lang: document.documentElement.lang });
            $('manager-email').value = ''; $('manager-recordings').checked = false; await managers(); $('manager-email').focus();
            return result.notificationPending;
        });
    });
    $('manager-method').addEventListener('change', () => { $('manager-password-fields').hidden = $('manager-method').value !== 'account'; $('manager-password').value = ''; });
    $('manager-refresh').addEventListener('click', () => action(invitations, 'manager-status'));
    // Native form navigation; no global shortcut is registered for account delegation.
    window.EvdAdminManagers = {
        async start(value) { context = value; await invitations(); },
        async open(value, button) {
            room = value; origin = button; $('manager-email').value = ''; $('manager-recordings').checked = false;
            $('manager-password').value = ''; $('manager-method').value = 'email'; $('manager-password-fields').hidden = true;
            $('manager-room-name').textContent = room.title; $('manager-dialog-status').textContent = '';
            $('manager-dialog').showModal(); $('manager-email').focus(); await action(managers);
        },
        clear() { $('manager-invitations').replaceChildren(); $('manager-list').replaceChildren(); $('manager-dialog').close(); $('manager-revoke-dialog').close(); },
        translate() { if (context) invitations().catch(() => {}); }
    };
})();
