const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RecordingMedia } = require('./recording-media');
const { EgressClient, RoomServiceClient, EncodedFileOutput, EncodedFileType, EncodingOptionsPreset, S3Upload } = require('livekit-server-sdk');

const PENDING = new Set(['starting', 'active', 'ending', 'unknown', 'pausing', 'paused', 'assembling']);
const RETENTION_MS = 7 * 86400000;
const EMPTY_ROOM_GRACE_MS = 120000;
class ServerRecordings {
    constructor({ config, roomStore, onRoomChanged = () => {}, client, roomClient, now = Date.now, media }) {
        this.config = config; this.rooms = roomStore; this.notify = onRoomChanged; this.now = now;
        this.file = path.join(config.dataDir, 'server-recordings.json');
        this.root = path.resolve(config.recordingFilesDir || path.join(config.dataDir, 'recording-files'));
        if (config.frontendPublicDir) {
            const relative = path.relative(path.resolve(config.frontendPublicDir), this.root);
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('recording_public_directory_forbidden');
        }
        if (config.recordingEgressDir && !path.posix.isAbsolute(config.recordingEgressDir)) throw new Error('recording_egress_directory_invalid');
        this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, recordings: [] };
        if (this.state.version !== 1 || !Array.isArray(this.state.recordings)) throw new Error('recording_store_invalid');
        this.state.downloadGrants ||= [];
        this.client = client || new EgressClient(config.livekitUrl.replace(/^ws/, 'http'), config.livekitApiKey, config.livekitApiSecret,
            { requestTimeout: 15, failover: false });
        this.queue = Promise.resolve(); this.timer = null; this.polling = false;
        this.roomClient = roomClient || new RoomServiceClient(config.livekitUrl.replace(/^ws/, 'http'), config.livekitApiKey, config.livekitApiSecret,
            { requestTimeout: 15, failover: false });
        this.emptySince = new Map();
        this.media = media || new RecordingMedia({ root: this.root, ffmpeg: config.recordingFfmpeg || 'ffmpeg', ffprobe: config.recordingFfprobe || 'ffprobe' });
        this.assembling = new Map();
        this.meetingAcknowledgements = new Map();
        const s3 = config.recordingS3;
        this.s3 = s3?.endpoint && s3?.bucket && s3?.accessKey && s3?.secret ? s3 : null;
        if (this.s3 && new URL(this.s3.endpoint).protocol !== 'https:') throw new Error('recording_storage_https_required');
        this.ready = config.recordingEnabled === true && !!(this.s3 || config.recordingEgressDir);
    }
    save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
        fs.renameSync(`${this.file}.tmp`, this.file);
    }
    serial(work) {
        const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
    }
    pending(roomId) { return this.state.recordings.some(row => (!roomId || row.roomId === roomId) && PENDING.has(row.status)); }
    meetingId(room) {
        if (!room.recordingMeetingId) {
            room.recordingMeetingId = crypto.randomUUID();
            this.rooms.savePersistentRooms?.();
        }
        return room.recordingMeetingId;
    }
    consent(room, actor, remember = false) {
        const key = `${room.recordingMeetingId || ''}:${room.settings?.sessionEndedAt || 0}`;
        let entry = this.meetingAcknowledgements.get(room.roomId);
        if (!entry || entry.key !== key) {
            entry = { key, actors: new Set() };
            this.meetingAcknowledgements.set(room.roomId, entry);
        }
        if (remember && room.recordingMeetingId) entry.actors.add(actor);
        return { key, confirmed: entry.actors.has(actor) };
    }
    share(roomId, meetingId, issuedTo) {
        const now = this.now();
        this.state.downloadGrants = this.state.downloadGrants.filter(item => item.expires > now);
        if (this.state.downloadGrants.filter(item => item.issuedTo === issuedTo && item.createdAt > now - 3600000).length >= 20) throw new Error('rate_limited');
        const token = crypto.randomBytes(32).toString('base64url');
        const grant = { id: crypto.randomUUID(), roomId, meetingId, issuedTo, createdAt: now, expires: now + 7 * 86400000,
            hash: crypto.createHash('sha256').update(token).digest('hex'), revoked: false };
        this.state.downloadGrants.push(grant); this.save();
        return { id: grant.id, expires: grant.expires, url: `${this.config.appBaseUrl}${this.config.broadcastRoomBasePath || '/yayinodasi'}/recordings.html#${token}` };
    }
    shared(token) {
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('recording_link_invalid');
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const grant = this.state.downloadGrants.find(item => !item.revoked && item.expires > this.now()
            && crypto.timingSafeEqual(Buffer.from(item.hash, 'hex'), Buffer.from(hash, 'hex')));
        if (!grant) throw new Error('recording_link_invalid');
        return { grant, rows: this.state.recordings.filter(row => row.status !== 'deleted' && row.roomId === grant.roomId && row.meetingId === grant.meetingId) };
    }
    owned(id, userId) {
        const row = this.state.recordings.find(item => item.id === id && item.userId === userId);
        if (!row) throw new Error('recording_not_found');
        return row;
    }
    localFile(row) {
        if (this.now() >= row.createdAt + RETENTION_MS) return null;
        if (!/^[a-f0-9-]+\.mp4$/.test(row.fileName)) return null;
        try {
            const root = fs.realpathSync(this.root), file = path.join(root, row.fileName);
            if (fs.lstatSync(file).isSymbolicLink()) return null;
            const real = fs.realpathSync(file), relative = path.relative(root, real);
            if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
            const stat = fs.statSync(real);
            return stat.isFile() && stat.size > 0 ? { path: real, size: stat.size } : null;
        } catch (_error) { return null; }
    }
    public(row) {
        const file = row.status === 'complete' ? this.localFile(row) : null;
        return { id: row.id, roomId: row.roomId, title: row.title, createdAt: row.createdAt,
            status: row.status === 'deleted' ? 'deleted' : this.now() >= row.createdAt + RETENTION_MS ? 'expired' : row.status,
            expiresAt: row.createdAt + RETENTION_MS, available: !!file, size: file?.size || 0, checkFailed: row.checkFailed === true };
    }
    fileNames(row) {
        return [...new Set([row.fileName, row.assemblyFileName, `${row.id}.m4a`, ...(row.assemblyInputs || []), ...(row.segments || []).map(segment => segment.fileName)])]
            .filter(name => typeof name === 'string' && /^[a-f0-9-]+\.(mp4|m4a)$/.test(name));
    }
    deleteFiles(row) {
        for (const name of this.fileNames(row)) {
            try { fs.unlinkSync(path.join(this.root, name)); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    async purgeExpired() {
        let changed = false;
        for (const row of this.state.recordings) {
            if (row.status === 'deleted') continue;
            if (this.now() < row.createdAt + RETENTION_MS) continue;
            if (PENDING.has(row.status)) { row.stopRequested = true; await this.reconcile(row); }
            if (PENDING.has(row.status)) continue;
            if (/^[a-f0-9-]+\.mp4$/.test(row.fileName)) {
                // Unlink the direct child only; never follow a symlink outside the private root.
                try { this.deleteFiles(row); }
                catch (error) { if (error.code !== 'ENOENT') { row.checkFailed = true; continue; } }
            }
            if (row.status !== 'expired') { row.status = 'expired'; changed = true; }
        }
        const grants = this.state.downloadGrants.filter(grant => grant.expires > this.now());
        if (grants.length !== this.state.downloadGrants.length) { this.state.downloadGrants = grants; changed = true; }
        if (changed) this.save();
    }
    list(userId) { return this.state.recordings.filter(row => row.status !== 'deleted' && row.userId === userId).map(row => this.public(row)); }
    signal(row) {
        const room = this.rooms.getRoom(row.roomId); if (!room) return;
        // Never reuse hostRecordingActive: that flag controls desktop/guest audio backup routing.
        const next = this.state.recordings.some(item => item.roomId === row.roomId && PENDING.has(item.status));
        const status = next ? row.status : 'idle';
        if (room.settings.serverRecordingStatus === status) return;
        room.settings.serverRecordingStatus = status;
        room.settings.updatedAt = this.now(); this.notify(room);
    }
    apply(row, info) {
        if (!info || (row.egressId && info.egressId !== row.egressId) || info.roomName !== row.roomId) return;
        row.egressId = info.egressId;
        row.status = ({ 0: 'starting', 1: 'active', 2: 'ending', 3: 'complete', 4: 'failed', 5: 'failed', 6: 'failed' })[info.status] || 'unknown';
        if (row.pauseRequested && ['starting', 'active', 'ending'].includes(row.status)) row.status = 'pausing';
        if (row.status === 'complete') row.status = row.pauseRequested ? 'paused' : row.segments?.length ? 'assembling' : 'complete';
        row.checkedAt = this.now(); row.checkFailed = false;
        this.save(); this.signal(row);
    }
    start(room, userId, authorize = () => true) {
        return this.serial(async () => {
            if (!authorize()) throw new Error('recording_not_found');
            if (!this.ready) throw new Error('recording_unavailable');
            if (!room.active || !room.participants.some(p => p.connected !== false)) throw new Error('recording_room_empty');
            if (this.pending(room.roomId)) throw new Error('recording_already_running');
            if (this.state.recordings.filter(row => PENDING.has(row.status)).length >= (this.config.recordingMaxConcurrent || 1)) throw new Error('recording_capacity');
            fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
            fs.accessSync(this.root, fs.constants.R_OK | fs.constants.W_OK);
            const disk = fs.statfsSync(this.root);
            if (disk.bavail * disk.bsize < (this.config.recordingMinFreeBytes || 5 * 1024 ** 3)) throw new Error('recording_disk_full');
            const id = crypto.randomUUID();
            const row = { id, roomId: room.roomId, meetingId: this.meetingId(room), userId, title: room.title, createdAt: this.now(), status: 'starting',
                fileName: `${id}.mp4`, egressId: '', stopRequested: false, checkedAt: 0 };
            // The private S3 gateway writes these objects to the shared local root.
            // Credentials are supplied to Egress only, never persisted in recording rows.
            row.egressPath = this.s3 ? row.fileName : path.posix.join(this.config.recordingEgressDir, row.fileName);
            this.state.recordings.push(row); this.save(); this.signal(row);
            try {
                const info = await this.client.startRoomCompositeEgress(room.roomId,
                    new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath: row.egressPath, disableManifest: true,
                        ...(this.s3 ? { output: { case: 's3', value: new S3Upload({ ...this.s3, forcePathStyle: true }) } } : {}) }),
                    { layout: 'grid', encodingOptions: EncodingOptionsPreset.H264_720P_30 });
                this.apply(row, info);
            } catch (error) {
                // A lost RPC reply does not prove that the remote job failed. Never retry Start automatically.
                const rejected = ['invalid_argument', 'unauthenticated', 'permission_denied', 'resource_exhausted', 'not_found', 'failed_precondition'].includes(error.code);
                row.status = rejected ? 'failed' : 'unknown'; row.checkFailed = true; this.save(); this.signal(row);
            }
            return this.public(row);
        });
    }
    async checkEmptyRoom(row) {
        try {
            let participants;
            try { participants = await this.roomClient.listParticipants(row.roomId); }
            catch (error) {
                if (error.code !== 'not_found') throw error;
                participants = [];
            }
            // LiveKit ParticipantInfo.Kind.EGRESS = 2: the recorder must not keep its own room alive.
            if (participants.some(participant => participant.kind !== 2)) {
                this.emptySince.delete(row.id);
                return;
            }
            if (!this.emptySince.has(row.id)) this.emptySince.set(row.id, this.now());
            if (this.now() - this.emptySince.get(row.id) >= EMPTY_ROOM_GRACE_MS) {
                row.stopRequested = true;
                row.stopReason = 'empty_room';
                this.save();
            }
        } catch (_error) {
            // An unavailable presence API is not proof of an empty room; require a fresh grace period.
            this.emptySince.delete(row.id);
            row.checkFailed = true;
            this.save();
        }
    }
    async reconcile(row) {
        try {
            if (row.status === 'assembling') { this.finishAssembly(row); return; }
            if (row.status === 'paused') {
                const room = this.rooms.getRoom(row.roomId);
                await this.checkEmptyRoom(row);
                if (!room?.active || room.recordingMeetingId !== row.meetingId || row.stopReason === 'empty_room'
                    || this.now() - row.createdAt >= (this.config.recordingMaxMinutes || 180) * 60000
                    || this.now() >= row.createdAt + RETENTION_MS) {
                    row.pauseRequested = false; row.status = row.segments?.length ? 'assembling' : 'complete';
                    this.save(); this.signal(row); if (row.status === 'assembling') this.finishAssembly(row);
                }
                return;
            }
            const results = await this.client.listEgress(row.egressId ? { egressId: row.egressId } : { roomName: row.roomId });
            const info = results.find(item => item.roomName === row.roomId && (row.egressId ? item.egressId === row.egressId
                : item.request?.case === 'roomComposite' && item.request.value.fileOutputs?.some(output => output.filepath === row.egressPath)));
            if (!info) { this.emptySince.delete(row.id); row.checkFailed = true; this.save(); return; }
            this.apply(row, info);
            const room = this.rooms.getRoom(row.roomId);
            const ended = !room || !room.active || (row.meetingId && room.recordingMeetingId !== row.meetingId) || Number(room.settings?.sessionEndedAt || 0) > row.createdAt;
            if (ended || this.now() - row.createdAt >= (this.config.recordingMaxMinutes || 180) * 60000) row.stopRequested = true;
            if (!row.stopRequested && ['starting', 'active'].includes(row.status)) await this.checkEmptyRoom(row);
            if (!PENDING.has(row.status)) this.emptySince.delete(row.id);
            try {
                const disk = fs.statfsSync(this.root);
                if (disk.bavail * disk.bsize < (this.config.recordingMinFreeBytes || 5 * 1024 ** 3) / 5) row.stopRequested = true;
            } catch (_error) { row.stopRequested = true; }
            if (row.stopRequested && ['starting', 'active', 'pausing'].includes(row.status)) await this.stopRemote(row);
            if (row.status === 'assembling') this.finishAssembly(row);
        } catch (_error) { this.emptySince.delete(row.id); row.checkFailed = true; this.save(); }
    }
    async stopRemote(row) {
        if (!row.egressId) return;
        try { this.apply(row, await this.client.stopEgress(row.egressId)); }
        catch (_error) { row.checkFailed = true; this.save(); }
    }
    stop(id, userId, authorize = () => true) {
        return this.serial(async () => {
            if (!authorize()) throw new Error('recording_not_found');
            const row = this.owned(id, userId);
            row.pauseRequested = false;
            if (row.status === 'paused') {
                row.status = row.segments?.length ? 'assembling' : 'complete';
                this.save(); this.signal(row);
                if (row.status === 'assembling') this.finishAssembly(row);
                return this.public(row);
            }
            if (PENDING.has(row.status)) {
                row.stopRequested = true; this.save();
                await this.reconcile(row);
            }
            return this.public(row);
        });
    }
    pause(id, userId, authorize = () => true) {
        return this.serial(async () => {
            if (!authorize()) throw new Error('recording_not_found');
            const row = this.owned(id, userId);
            if (['paused', 'pausing'].includes(row.status)) return this.public(row);
            if (row.status !== 'active') throw new Error('recording_not_ready');
            row.pauseRequested = true; row.stopRequested = true; row.status = 'pausing';
            this.save(); this.signal(row); await this.stopRemote(row);
            return this.public(row);
        });
    }
    resume(id, userId, authorize = () => true) {
        return this.serial(async () => {
            if (!authorize()) throw new Error('recording_not_found');
            const row = this.owned(id, userId), room = this.rooms.getRoom(row.roomId);
            if (row.status !== 'paused') throw new Error('recording_not_ready');
            if ((row.segments || []).length >= 200) throw new Error('recording_capacity');
            if (!this.ready || !room?.active || room.recordingMeetingId !== row.meetingId
                || this.now() - row.createdAt >= (this.config.recordingMaxMinutes || 180) * 60000) throw new Error('recording_not_ready');
            if (!this.localFile(row)) throw new Error('recording_not_ready');
            this.media.checkDisk();
            (row.segments ||= []).push({ fileName: row.fileName, egressId: row.egressId });
            row.fileName = `${crypto.randomUUID()}.mp4`;
            row.egressPath = this.s3 ? row.fileName : path.posix.join(this.config.recordingEgressDir, row.fileName);
            row.egressId = ''; row.pauseRequested = false; row.stopRequested = false; row.stopReason = '';
            row.status = 'starting'; this.save(); this.signal(row);
            try {
                const info = await this.client.startRoomCompositeEgress(room.roomId,
                    new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath: row.egressPath, disableManifest: true,
                        ...(this.s3 ? { output: { case: 's3', value: new S3Upload({ ...this.s3, forcePathStyle: true }) } } : {}) }),
                    { layout: 'grid', encodingOptions: EncodingOptionsPreset.H264_720P_30 });
                this.apply(row, info);
            } catch (error) {
                // Reconcile by unique output path. Never issue a second Start after an ambiguous reply.
                const rejected = ['invalid_argument', 'unauthenticated', 'permission_denied', 'resource_exhausted', 'not_found', 'failed_precondition'].includes(error.code);
                if (rejected) {
                    const prior = row.segments.pop();
                    row.fileName = prior.fileName; row.egressId = prior.egressId;
                    row.egressPath = this.s3 ? row.fileName : path.posix.join(this.config.recordingEgressDir, row.fileName);
                    row.status = row.segments.length ? 'assembling' : 'complete';
                } else row.status = 'unknown';
                row.checkFailed = true; this.save(); this.signal(row);
                if (row.status === 'assembling') this.finishAssembly(row);
            }
            return this.public(row);
        });
    }
    finishAssembly(row) {
        if (this.assembling.has(row.id)) return;
        row.assemblyFileName ||= `${crypto.randomUUID()}.mp4`;
        row.assemblyInputs ||= [...(row.segments || []).map(segment => segment.fileName), row.fileName];
        row.assemblyWaitingAt ||= this.now();
        this.save();
        // Egress completion can precede the private storage gateway's final rename.
        if (!row.assemblyInputs.every(fileName => this.localFile({ ...row, fileName }))) {
            if (this.now() - row.assemblyWaitingAt >= 10 * 60000) {
                row.status = 'processing_failed'; row.checkFailed = true; this.save(); this.signal(row);
            }
            return;
        }
        const job = this.media.assemble(row.assemblyInputs, row.assemblyFileName)
            .then(() => { row.fileName = row.assemblyFileName; row.status = 'complete'; row.checkFailed = false; })
            .catch(() => { row.status = 'processing_failed'; row.checkFailed = true; })
            .finally(() => { this.assembling.delete(row.id); this.save(); this.signal(row); });
        this.assembling.set(row.id, job);
    }
    refresh(userId) {
        return this.serial(async () => {
            for (const row of this.state.recordings.filter(item => item.userId === userId && PENDING.has(item.status))) await this.reconcile(row);
            return this.list(userId);
        });
    }
    remove(id, userId, authorize = () => true) {
        return this.serial(async () => {
            if (!authorize()) throw new Error('recording_not_found');
            const row = this.owned(id, userId);
            if (PENDING.has(row.status)) throw new Error('recording_delete_running');
            if (!/^[a-f0-9-]+\.mp4$/.test(row.fileName)) throw new Error('recording_not_found');
            // Remove the direct child, not a symlink target. No remote Egress remains active here.
            try { this.deleteFiles(row); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            row.status = 'deleted'; row.deletedAt = this.now(); this.save();
            return this.public(row);
        });
    }
    download(id, userId, language = 'tr') {
        const row = this.owned(id, userId);
        const file = row.status === 'complete' ? this.localFile(row) : null;
        if (!file) throw new Error('recording_not_ready');
        const lang = ['tr','en','de','es','fr'].includes(language) ? language : 'tr';
        const strings = JSON.parse(fs.readFileSync(path.join(this.config.localeDir || path.resolve(__dirname, '../../../../locales'), `${lang}.json`), 'utf8')).admin_auth;
        const timeZone = this.config.recordingTimeZone || 'Europe/Istanbul';
        const date = new Intl.DateTimeFormat(lang, { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(row.createdAt);
        const time = new Intl.DateTimeFormat(lang, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(row.createdAt).replace(/:/g, '.');
        const room = String(row.title || '').slice(0, 120);
        const name = strings.recording_filename.replace(/\{(date|time|room)\}/g, (_match, key) => ({ date, time, room })[key])
            .normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '-').trim().replace(/[. ]+$/, '');
        return { ...file, name: `${name}.mp4` };
    }
    async audioDownload(id, userId, language = 'tr', authorize = () => true) {
        if (!authorize()) throw new Error('recording_not_found');
        const file = this.download(id, userId, language), row = this.owned(id, userId);
        const output = await this.media.audio(row.fileName, `${row.id}.m4a`);
        // Deletion, permission revocation and expiry may happen while extracting audio.
        if (row.status !== 'complete' || this.now() >= row.createdAt + RETENTION_MS) {
            fs.rmSync(output, { force: true }); throw new Error('recording_not_found');
        }
        if (!authorize()) throw new Error('recording_not_found');
        return { path: output, name: file.name.replace(/\.mp4$/, '.m4a') };
    }
    startMonitor() {
        if (this.timer) return;
        const checked = new Map();
        const tick = () => {
            if (this.polling) return;
            this.polling = true;
            this.serial(async () => {
                const pending = this.state.recordings.filter(item => PENDING.has(item.status));
                const ids = new Set(pending.map(row => row.id));
                for (const id of checked.keys()) if (!ids.has(id)) checked.delete(id);
                for (const row of pending) {
                    // Poll transitions promptly, without increasing steady-state room queries.
                    const interval = ['starting', 'pausing', 'ending', 'assembling'].includes(row.status) ? 2000 : 10000;
                    if (checked.has(row.id) && this.now() - checked.get(row.id) < interval) continue;
                    checked.set(row.id, this.now());
                    await this.reconcile(row);
                }
                await this.purgeExpired();
            })
                .catch(() => console.error('recording_monitor_failed')).finally(() => { this.polling = false; });
        };
        tick(); this.timer = setInterval(tick, 2000); this.timer.unref();
    }
    close() { clearInterval(this.timer); this.timer = null; }
}
module.exports = { ServerRecordings, PENDING };
