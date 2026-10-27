// Internal playback implementation; existing playback shortcuts remain unchanged.
class SeamlessPreview {
    constructor(player) {
        this.player = player;
        this.generation = 0;
        this.active = false;
        this.pending = false;
        this.nodes = new Set();
    }

    eligible(segments, audition = false) {
        const p = this.player;
        return window.api.getTimelinePreviewAudio && segments.length > (audition ? 0 : 1)
            && !p.ignoreTimeline && (audition || (!p.isRangePlaying && !p.isPreviewingCut))
            && !p.isScrubbing && (!p.allowPlaybackWithOpenDialog || (audition && p.allowContinuousDialogPreview))
            && segments.every(s => !!(s.sourceFile || Timeline.sourceFile)
                && (s.speed || 1) === 1 && s.end > s.start
                && !s.backgroundAudio && !s.speedBgAudio && !s.overlays?.length && !s.audioEffects?.length
                && !s.noiseReduction?.enabled && (!s.audioChannelMode || s.audioChannelMode === 'source'));
    }

    position() {
        return Math.min(this.total, this.startPosition + Math.max(0, this.player.audioContext.currentTime - this.origin));
    }

    timelinePosition() {
        return this.audition ? this.locate(this.position()).timeline : this.position();
    }

    auditionSegments(segments, ranges) {
        const result = [];
        for (const [from, to] of ranges) {
            let elapsed = 0;
            for (const [index, segment] of segments.entries()) {
                const speed = segment.speed || 1;
                const duration = (segment.end - segment.start) / speed;
                const start = Math.max(from, elapsed), end = Math.min(to, elapsed + duration);
                if (end > start) result.push({ ...segment,
                    start: segment.start + (start - elapsed) * speed,
                    end: segment.start + (end - elapsed) * speed,
                    auditionTimelineStart: start, auditionOriginalIndex: index });
                elapsed += duration;
            }
        }
        return result;
    }

    locate(time) {
        let elapsed = 0;
        for (let i = 0; i < this.segments.length; i++) {
            const s = this.segments[i];
            if (time < elapsed + s.end - s.start || i === this.segments.length - 1) {
                return { index: s.auditionOriginalIndex ?? i, segmentIndex: i,
                    timeline: (s.auditionTimelineStart ?? elapsed) + time - elapsed,
                    source: Math.min(s.end, s.start + time - elapsed) };
            }
            elapsed += s.end - s.start;
        }
    }

    async windowAt(time, generation) {
        let elapsed = 0;
        let remaining = 12;
        const spans = [];
        for (const [index, s] of this.segments.entries()) {
            const duration = s.end - s.start;
            if (elapsed + duration > time && remaining > 0 && spans.length < 128) {
                const start = s.start + Math.max(0, time - elapsed);
                const end = Math.min(s.end, start + remaining);
                const boundary = (a,b) => a && b && ((a.sourceFile || this.source)!==(b.sourceFile || this.source) || Math.abs(a.end-b.start)>1e-7
                    || (a.audioVolume ?? 100)!==(b.audioVolume ?? 100) || !!a.isMuted!==!!b.isMuted);
                spans.push({ source:s.sourceFile || this.source, start, end, segmentStart:s.start, segmentEnd:s.end,
                    fadeIn:!!boundary(this.segments[index-1],s), fadeOut:!!boundary(s,this.segments[index+1]),
                    volume: s.isMuted ? 0 : Math.max(0, Math.min(4, Number(s.audioVolume ?? 100)/100)) });
                remaining -= end - start;
            }
            elapsed += duration;
        }
        if (!spans.length) return null;
        const result = await window.api.getTimelinePreviewAudio({ source: this.source, spans });
        if (generation !== this.generation) return null;
        const bytes = new Uint8Array(result.pcm);
        const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength/4);
        const buffer = this.player.audioContext.createBuffer(result.channels, floats.length/result.channels, result.sampleRate);
        for (let channel = 0; channel < result.channels; channel++) {
            const target = buffer.getChannelData(channel);
            for (let i = 0; i < target.length; i++) target[i] = floats[i*result.channels+channel];
        }
        return buffer;
    }

    async start(time, segments, { audition = false } = {}) {
        this.stop();
        this.audition = audition;
        const generation = this.generation;
        this.source = Timeline.sourceFile || this.player.currentFilePath;
        this.segments = segments.map(s => ({ ...s }));
        this.fingerprint = JSON.stringify(audition ? Timeline.segments : segments);
        this.total = segments.reduce((n, s) => n+s.end-s.start, 0);
        this.pending = true;
        try {
            const buffer = await this.windowAt(time, generation);
            if (!buffer || generation !== this.generation) return false;
            const ctx = this.player.audioContext;
            await ctx.resume();
            if (generation !== this.generation) return false;
            this.pending = false;
            this.active = true;
            this.player.applyEffectivePlaybackVolume?.();
            this.startPosition = time;
            this.origin = ctx.currentTime + .05;
            this.gain = ctx.createGain();
            this.gain.connect(ctx.destination);
            this.scheduledUntil = time;
            this.schedule(buffer);
            this.timer = setInterval(() => this.tick(), 20);
            this.tick();
            return true;
        } catch (error) {
            if (generation === this.generation) this.stop();
            console.warn('Continuous preview unavailable; using media playback.', error);
            return false;
        }
    }

    schedule(buffer) {
        const ctx = this.player.audioContext;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(this.gain);
        this.nodes.add(node);
        node.onended = () => { this.nodes.delete(node); node.disconnect(); };
        node.start(this.origin + this.scheduledUntil - this.startPosition);
        this.scheduledUntil += buffer.duration;
    }

    tick() {
        if (!this.active) return;
        const p = this.player;
        const time = this.position();
        if (time >= this.total-.001) {
            p.pause({ announce: false });
            return;
        }
        if (time >= this.scheduledUntil && this.scheduledUntil < this.total-.001) {
            p.pause({ announce: false });
            return;
        }
        if (!this.lastCheck || performance.now() - this.lastCheck > 200) {
            this.lastCheck = performance.now();
            if (JSON.stringify(Timeline.segments) !== this.fingerprint) {
                p.pause({ announce: false });
                return;
            }
            p.updateTimeDisplay();
        }
        this.gain.gain.value = p.playbackVolumePercent/100;
        const target = this.locate(time);
        const source = this.segments[target.segmentIndex].sourceFile || this.source;
        if (source !== p.currentFilePath && !this.switchingVideo) {
            const generation = this.generation;
            this.switchingVideo = true;
            p.loadVideoSilent(source).then(() => {
                if (generation !== this.generation || !this.active) return;
                this.switchingVideo = false;
                this.tick(); // Catch up to the audio clock, not the old load position.
            }).catch(error => {
                if (generation !== this.generation) return;
                console.warn('Continuous preview video load failed', error);
                p.pause({ announce:false });
            });
        }
        if (!this.switchingVideo && (p._currentTimelineSegmentIndex !== target.index || Math.abs(p.video.currentTime-target.source) > .12)) {
            p._currentTimelineSegmentIndex = target.index;
            if (!p.video.seeking) p.video.currentTime = target.source;
        }
        if (!this.switchingVideo && p.video.paused) p.video.play().catch(() => { if (this.active) p.pause({ announce: false }); });
        if (!this.fetching && this.scheduledUntil < this.total-.001 && this.scheduledUntil-time < 8) {
            const generation = this.generation;
            this.fetching = true;
            this.windowAt(this.scheduledUntil, generation).then(buffer => {
                if (generation !== this.generation || !this.active) return;
                this.fetching = false;
                if (!buffer || this.position() >= this.scheduledUntil) {
                    p.pause({ announce: false }); // Never silently skip audio after a buffer underrun.
                    return;
                }
                this.schedule(buffer);
            }).catch(error => {
                if (generation !== this.generation) return;
                console.warn('Continuous preview buffering failed', error);
                p.pause({ announce: false });
            });
        }
    }

    stop() {
        this.generation++;
        this.active = false;
        this.pending = false;
        this.audition = false;
        this.fetching = false;
        this.switchingVideo = false;
        clearInterval(this.timer);
        for (const node of this.nodes) { try { node.stop(); node.disconnect(); } catch (_) {} }
        this.nodes.clear();
        this.gain?.disconnect();
        this.gain = null;
    }
}
window.SeamlessPreview = SeamlessPreview;
