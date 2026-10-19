const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scrypt = require('util').promisify(crypto.scrypt);

const MINUTE = 60000;
function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)) throw new Error('email_invalid');
    return email;
}
function safeEqual(a, b) {
    const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// One service process owns this store. Multi-instance deployment requires a
// transactional database before enabling accounts on more than one worker.
class AdminAccountStore {
    constructor(filePath, { now = Date.now } = {}) {
        this.filePath = filePath;
        this.now = now;
        this.state = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {
            version: 1, pepper: crypto.randomBytes(32).toString('hex'), users: [], challenges: [], sessions: [], rates: []
        };
        if (this.state.version !== 1 || !this.state.pepper) throw new Error('account_store_invalid');
        this.state.roomBindings ||= [];
        this.state.roomManagers ||= [];
        this.state.audit ||= [];
        this.save();
    }
    hash(value) { return crypto.createHmac('sha256', this.state.pepper).update(value).digest('hex'); }
    save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
        fs.renameSync(tmp, this.filePath);
    }
    prune() {
        const now = this.now();
        for (const field of ['challenges', 'sessions', 'rates']) this.state[field] = this.state[field].filter(item => item.expires > now);
    }
    limit(key, maximum, duration) {
        const digest = this.hash(`rate:${key}`);
        let rate = this.state.rates.find(item => item.key === digest);
        if (!rate) { rate = { key: digest, count: 0, expires: this.now() + duration }; this.state.rates.push(rate); }
        rate.count += 1;
        if (rate.count > maximum) { this.save(); throw new Error('rate_limited'); }
    }
    request(emailInput, ip) {
        const email = normalizeEmail(emailInput);
        this.prune();
        this.limit('send-global', 200, 60 * MINUTE);
        this.limit(`send-ip:${ip}`, 20, 60 * MINUTE);
        this.limit(`send-email:${email}`, 3, 15 * MINUTE);
        const id = crypto.randomBytes(18).toString('hex');
        const token = crypto.randomBytes(32).toString('base64url');
        const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
        this.state.challenges = this.state.challenges.filter(item => item.email !== email);
        this.state.challenges.push({ id, email, token: this.hash(`link:${id}:${token}`), code: this.hash(`code:${id}:${code}`),
            expires: this.now() + 10 * MINUTE, attempts: 0 });
        this.save();
        return { id, email, token, code };
    }
    cancel(id) { this.state.challenges = this.state.challenges.filter(item => item.id !== id); this.save(); }
    verify({ id, token, code, email, remember, ip }) {
        this.prune();
        this.limit(`verify-ip:${ip}`, 30, 15 * MINUTE);
        const challenge = this.state.challenges.find(item => item.id === id);
        if (!challenge || challenge.attempts >= 5) { this.save(); throw new Error('verification_invalid'); }
        challenge.attempts += 1;
        const valid = token ? safeEqual(challenge.token, this.hash(`link:${id}:${token}`))
            : safeEqual(challenge.email, String(email || '').trim().toLowerCase()) && /^\d{8}$/.test(String(code))
                && safeEqual(challenge.code, this.hash(`code:${id}:${code}`));
        if (!valid) { this.save(); throw new Error('verification_invalid'); }
        this.state.challenges = this.state.challenges.filter(item => item.id !== id);
        let user = this.state.users.find(item => item.email === challenge.email);
        if (!user) {
            user = { id: crypto.randomUUID(), email: challenge.email, verifiedAt: this.now() };
            this.state.users.push(user);
        }
        user.verifiedAt = this.now();
        const session = crypto.randomBytes(32).toString('base64url');
        const expires = this.now() + (remember ? 30 * 24 * 60 : 12 * 60) * MINUTE;
        // No owner/admin role is inferred from email or account creation.
        this.state.sessions.push({ hash: this.hash(`session:${session}`), userId: user.id, expires });
        const own = this.state.sessions.filter(item => item.userId === user.id);
        if (own.length > 10) this.state.sessions = this.state.sessions.filter(item => !own.slice(0, own.length - 10).includes(item));
        this.save();
        return { session, expires, user: this.userView(user) };
    }
    session(token) {
        if (!token) return null;
        const session = this.state.sessions.find(item => item.expires > this.now() && safeEqual(item.hash, this.hash(`session:${token}`)));
        const user = session && this.state.users.find(item => item.id === session.userId);
        return user ? this.userView(user) : null;
    }
    logout(token) {
        const hash = this.hash(`session:${token || ''}`);
        this.state.sessions = this.state.sessions.filter(item => item.hash !== hash);
        this.save();
    }
    rememberDesktop(token) {
        const user = this.session(token);
        if (!user || user.passwordChangeRequired) throw new Error('session_required');
        const session = this.state.sessions.find(item => safeEqual(item.hash, this.hash(`session:${token}`)));
        // Explicit trusted-device consent. Password reset, logout and the session
        // limit still revoke this grant; room ownership is checked on every use.
        session.expires = 8640000000000000;
        session.desktopDevice = true;
        this.save();
    }
    userView(user) {
        return { id: user.id, email: user.email, ...(user.displayName ? { displayName: user.displayName } : {}), ...(user.passwordChangeRequired ? { passwordChangeRequired: true } : {}) };
    }
    updateProfile(userId, displayName) {
        const user = this.state.users.find(item => item.id === userId);
        if (!user) throw new Error('session_required');
        if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 120 || /[\x00-\x1f\x7f]/.test(displayName)) throw new Error('display_name_invalid');
        user.displayName = displayName.trim(); this.save();
        return this.userView(user);
    }
    issueSession(user, remember) {
        const session = crypto.randomBytes(32).toString('base64url');
        const expires = this.now() + (remember ? 30 * 24 * 60 : 12 * 60) * MINUTE;
        this.state.sessions.push({ hash: this.hash(`session:${session}`), userId: user.id, expires });
        const own = this.state.sessions.filter(item => item.userId === user.id);
        if (own.length > 10) this.state.sessions = this.state.sessions.filter(item => !own.slice(0, own.length - 10).includes(item));
        this.save();
        return { session, expires, user: this.userView(user) };
    }
    async passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
        if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('password_policy');
        const hash = await scrypt(password, salt, 64);
        return { salt, hash: hash.toString('hex') };
    }
    async provision(emailInput, password, reset = false) {
        const email = normalizeEmail(emailInput);
        let user = this.state.users.find(item => item.email === email);
        if (user && !reset) throw new Error('account_exists');
        const credential = await this.passwordHash(password);
        // Recheck after asynchronous hashing, before creating or changing an account.
        user = this.state.users.find(item => item.email === email);
        if (user && !reset) throw new Error('account_exists');
        if (!user) { user = { id: crypto.randomUUID(), email, provisionedAt: this.now() }; this.state.users.push(user); }
        user.password = credential; user.passwordChangeRequired = true;
        this.state.sessions = this.state.sessions.filter(item => item.userId !== user.id);
        this.state.challenges = this.state.challenges.filter(item => item.email !== email);
        this.auditAction('system-admin', '', reset ? 'account_password_reset' : 'account_provisioned', user.id);
        return this.userView(user);
    }
    async passwordLogin({ email: input, password, remember, ip }) {
        this.prune();
        const email = String(input || '').trim().toLowerCase();
        this.limit('password-global', 300, 15 * MINUTE);
        this.limit(`password-ip:${ip}`, 30, 15 * MINUTE);
        this.limit(`password-email:${email}`, 10, 15 * MINUTE); this.save();
        const user = this.state.users.find(item => item.email === email);
        const credential = user?.password;
        const validInput = typeof password === 'string' && password.length >= 12 && password.length <= 128;
        const calculated = await this.passwordHash(validInput ? password : 'invalid-password-placeholder', credential?.salt || 'invalid-account-salt');
        if (!validInput || !credential || !safeEqual(credential.hash, calculated.hash) || user.password !== credential) throw new Error('credentials_invalid');
        return this.issueSession(user, remember === true);
    }
    async changePassword(userId, password) {
        const current = this.state.users.find(item => item.id === userId);
        if (!current?.passwordChangeRequired) throw new Error('session_required');
        const previous = current.password;
        const credential = await this.passwordHash(password);
        const user = this.state.users.find(item => item.id === userId);
        if (!user || user.password !== previous || !user.passwordChangeRequired) throw new Error('session_required');
        user.password = credential; user.passwordChangeRequired = false;
        this.state.sessions = this.state.sessions.filter(item => item.userId !== userId);
        this.state.challenges = this.state.challenges.filter(item => item.email !== user.email);
        this.auditAction(userId, '', 'password_changed');
        return this.issueSession(user, false);
    }
    assignRoom(emailInput, room, transfer = false) {
        const email = normalizeEmail(emailInput);
        const user = this.state.users.find(item => item.email === email);
        if (!user) throw new Error('account_missing');
        const existing = this.state.roomBindings.find(item => item.roomId === room.roomId);
        if (existing && existing.userId !== user.id && !transfer) throw new Error('owner_transfer_confirmation');
        if (existing && existing.userId !== user.id) {
            this.state.roomBindings = this.state.roomBindings.filter(item => item !== existing);
            this.state.roomManagers = this.state.roomManagers.filter(item => item.roomId !== room.roomId);
            // A transferred account must not leave the previous desktop owner's API key usable.
            room.settings.ownerKey = crypto.randomBytes(32).toString('hex');
        }
        this.bindRoom(user.id, room);
        this.auditAction('system-admin', room.roomId, 'owner_assigned', user.id);
        return this.userView(user);
    }
    ownsRoom(userId, room) {
        const binding = this.state.roomBindings.find(item => item.roomId === room?.roomId && item.userId === userId);
        return !!binding && !!room.settings?.ownerKey && safeEqual(binding.proof, this.hash(`room:${room.roomId}:${room.settings.ownerKey}`));
    }
    roomOwner(room) {
        return this.state.roomBindings.find(binding => binding.roomId === room?.roomId && this.ownsRoom(binding.userId, room))?.userId || null;
    }
    roomAccess(userId, room) {
        const ownerId = this.roomOwner(room);
        if (!ownerId) return null;
        if (ownerId === userId) return { role: 'owner', recordings: true, ownerId };
        const user = this.state.users.find(item => item.id === userId);
        const grant = this.state.roomManagers.find(item => item.roomId === room.roomId && item.ownerId === ownerId
            && item.proof === this.hash(`room:${room.roomId}:${room.settings.ownerKey}`)
            && item.email === user?.email && item.acceptedAt && !item.revokedAt);
        return grant ? { role: 'manager', recordings: grant.recordings === true, ownerId } : null;
    }
    auditAction(userId, roomId, action, target = '') {
        this.state.audit.push({ at: this.now(), userId, roomId, action, target });
        this.state.audit = this.state.audit.slice(-10000);
        this.save();
    }
    inviteManager(userId, room, emailInput, recordings) {
        if (!this.ownsRoom(userId, room)) throw new Error('room_not_found');
        const email = normalizeEmail(emailInput);
        if (email === this.state.users.find(user => user.id === userId)?.email) throw new Error('manager_self');
        if (this.state.roomManagers.some(item => item.roomId === room.roomId && item.email === email && !item.revokedAt
            && (item.acceptedAt || item.expires > this.now()))) throw new Error('manager_exists');
        this.prune(); this.limit('manager-invite-global', 200, 60 * MINUTE); this.limit(`manager-invite:${userId}`, 20, 60 * MINUTE);
        const invitation = { id: crypto.randomUUID(), roomId: room.roomId, ownerId: userId, email,
            proof: this.hash(`room:${room.roomId}:${room.settings.ownerKey}`), recordings: recordings === true,
            createdAt: this.now(), expires: this.now() + 7 * 24 * 60 * MINUTE, acceptedAt: 0, revokedAt: 0 };
        this.state.roomManagers.push(invitation);
        try { this.auditAction(userId, room.roomId, 'manager_invited', invitation.id); }
        catch (error) { this.state.roomManagers = this.state.roomManagers.filter(item => item !== invitation); throw error; }
        return invitation;
    }
    acceptManager(userId, invitationId, room) {
        const user = this.state.users.find(item => item.id === userId);
        const invite = this.state.roomManagers.find(item => item.id === invitationId && item.email === user?.email);
        if (!invite || invite.revokedAt || invite.expires <= this.now() || invite.acceptedAt
            || invite.roomId !== room?.roomId || this.roomOwner(room) !== invite.ownerId
            || invite.proof !== this.hash(`room:${room.roomId}:${room.settings.ownerKey}`)) throw new Error('manager_invite_invalid');
        invite.acceptedAt = this.now();
        try { this.auditAction(userId, room.roomId, 'manager_accepted', invite.id); }
        catch (error) { invite.acceptedAt = 0; throw error; }
    }
    async assignPasswordManager(userId, room, emailInput, password, recordings) {
        if (!this.ownsRoom(userId, room)) throw new Error('room_not_found');
        this.prune(); this.limit(`manager-account:${userId}`, 20, 60 * MINUTE); this.save();
        const email = normalizeEmail(emailInput);
        const existing = this.state.users.find(item => item.email === email);
        if (existing && password) throw new Error('manager_account_exists');
        const credential = existing ? null : await this.passwordHash(password);
        // Recheck after hashing; another request must not overwrite an existing account.
        if (!existing && this.state.users.some(item => item.email === email)) throw new Error('manager_account_exists');
        const invite = this.inviteManager(userId, room, email, recordings);
        if (!existing) this.state.users.push({ id: crypto.randomUUID(), email, password: credential,
            provisionedAt: this.now(), passwordChangeRequired: true });
        invite.acceptedAt = this.now(); invite.method = 'account';
        this.auditAction(userId, room.roomId, 'manager_account_assigned', invite.id);
        return invite;
    }
    revokeManager(userId, room, id) {
        if (!this.ownsRoom(userId, room)) throw new Error('room_not_found');
        const invite = this.state.roomManagers.find(item => item.id === id && item.roomId === room.roomId && item.ownerId === userId);
        if (!invite) throw new Error('manager_invite_invalid');
        invite.revokedAt = this.now();
        this.auditAction(userId, room.roomId, 'manager_revoked', invite.id);
    }
    bindRoom(userId, room) {
        if (!this.state.users.some(user => user.id === userId) || !room?.settings?.ownerKey) throw new Error('room_link_invalid');
        const existing = this.state.roomBindings.find(item => item.roomId === room.roomId);
        if (existing && existing.userId !== userId) throw new Error('room_link_invalid');
        const previous = this.state.roomBindings;
        this.state.roomBindings = previous.filter(item => item.roomId !== room.roomId).concat({
            roomId: room.roomId, userId, proof: this.hash(`room:${room.roomId}:${room.settings.ownerKey}`)
        });
        try { this.save(); } catch (error) { this.state.roomBindings = previous; throw error; }
    }
}
module.exports = { AdminAccountStore, normalizeEmail };
