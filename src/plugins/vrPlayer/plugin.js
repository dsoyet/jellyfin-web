import './style.scss';

import { playbackManager } from '../../components/playback/playbackmanager';
import profileBuilder from '../../scripts/browserDeviceProfile';
import { appHost } from '../../components/apphost';
import browser from '../../scripts/browser';
import Events from '../../utils/events.ts';
import loading from '../../components/loading/loading';
import globalize from '../../lib/globalize';

function requireHlsPlayer() {
    return import(/* webpackChunkName: "hls.js" */ 'hls.js/dist/hls.js')
        .then(({ default: Hls }) => {
            Hls.DefaultConfig.lowLatencyMode = false;
            Hls.DefaultConfig.backBufferLength = Infinity;
            Hls.DefaultConfig.liveBackBufferLength = 90;
            return Hls;
        });
}

export class VrPlayer {
    name = 'VR Player';
    type = 'mediaplayer';
    id = 'vrplayer';
    priority = 0;
    isLocalPlayer = true;
    isFetching = false;

    #mediaElement = null;
    #hls = null;
    #vrScene = null;
    #vrSky = null;
    #vrFlat = null;
    #vrCamera = null;
    #isVR = true;
    #currentSrc = null;
    #streamInfo = null;
    #progressBar = null;
    #progressFill = null;
    #progressTimer = 0;
    #statsEl = null;
    #fpsCnt = 0;
    #lastFps = 0;
    #fps = 0;
    #rafId = 0;

    static #aframeLoaded = false;
    static #hlsLib = null;

    static async #ensureAframe() {
        if (VrPlayer.#aframeLoaded) return;
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://aframe.io/releases/1.6.0/aframe.min.js';
            script.onload = () => {
                VrPlayer.#aframeLoaded = true;
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    static async #ensureHls() {
        if (VrPlayer.#hlsLib) return VrPlayer.#hlsLib;
        VrPlayer.#hlsLib = await requireHlsPlayer();
        return VrPlayer.#hlsLib;
    }

    canPlayMediaType(mediaType) {
        return mediaType === 'Video';
    }

    canPlayItem(item) {
        return item?.MediaType === 'Video';
    }

    currentTime(val) {
        const media = this.#mediaElement;
        if (media) {
            if (val != null) {
                media.currentTime = val;
            }
            return media.currentTime;
        }
        return 0;
    }

    duration() {
        return this.#mediaElement?.duration ?? 0;
    }

    paused() {
        return this.#mediaElement?.paused ?? true;
    }

    volume(val) {
        const media = this.#mediaElement;
        if (media) {
            if (val != null) {
                media.volume = val;
            }
            return media.volume;
        }
        return 1;
    }

    setMute(mute) {
        if (this.#mediaElement) {
            this.#mediaElement.muted = mute;
        }
    }

    isMuted() {
        return this.#mediaElement?.muted ?? false;
    }

    getSupportedFeatures() {
        return ['PlaybackRate'];
    }

    getDeviceProfile(item) {
        return VrPlayer.getDeviceProfileInternal(item).then(profile => ({
            PlayableMediaTypes: ['Video'],
            ...profile
        }));
    }

    static getDeviceProfileInternal(_item) {
        const profile = profileBuilder({});
        profile.MaxStaticBitrate = 200000000;
        profile.MusicStreamingTranscodingBitrate = 200000000;
        return Promise.resolve(profile);
    }

    getStats() {
        const media = this.#mediaElement;
        if (!media) return Promise.resolve({ categories: [] });

        return Promise.resolve({
            categories: [{
                stats: [
                    { label: 'Resolution', value: `${media.videoWidth || '--'}x${media.videoHeight || '--'}` },
                    { label: 'Mode', value: this.#isVR ? 'VR 180°' : '2D Flat' }
                ],
                type: 'video'
            }]
        });
    }

    // ── Main lifecycle ──

    async play(options) {
        this.#streamInfo = options;

        loading.show();
        await VrPlayer.#ensureAframe();
        await VrPlayer.#ensureHls();
        this.#createScene();
        this.#registerShortcuts();
        this.#startStats();

        const streamInfo = playbackManager.getPlayerState(this).streamInfo;
        const url = streamInfo.url;
        const mimeType = streamInfo.mediaSource?.Container === 'mpd' ? 'application/dash+xml' : 'application/x-mpegURL';

        await this.#setSrc(url, mimeType);

        document.body.classList.add('vrPlayerActive');
        loading.hide();

        Events.trigger(this, 'playing');

        if (options.playerStartPositionTicks) {
            const seconds = options.playerStartPositionTicks / 10000000;
            this.#mediaElement.currentTime = seconds;
        }
    }

    stop() {
        this.#destroyHls();
        this.#destroyScene();
        this.#stopStats();
        document.body.classList.remove('vrPlayerActive');
        Events.trigger(this, 'stopped');
    }

    pause() {
        this.#mediaElement?.pause();
        Events.trigger(this, 'pause');
    }

    unpause() {
        this.#mediaElement?.play().catch(() => {});
        Events.trigger(this, 'unpause');
    }

    toggleVr() {
        this.#isVR = !this.#isVR;
        if (this.#vrSky) this.#vrSky.setAttribute('visible', this.#isVR);
        if (this.#vrFlat) this.#vrFlat.setAttribute('visible', !this.#isVR);
        if (this.#vrCamera) {
            this.#vrCamera.setAttribute('wasd-controls',
                this.#isVR ? 'acceleration:50' : 'enabled:false');
        }
    }

    // ── A-Frame scene ──

    #createScene() {
        this.#isVR = true;

        const container = document.createElement('div');
        container.id = 'vrPlayerContainer';
        container.innerHTML = `
            <a-scene embedded id="vrScene" vr-mode-ui="enabled:true">
                <a-assets>
                    <video id="vrVideo" crossorigin="anonymous" playsinline autoplay></video>
                </a-assets>
                <a-sky id="vrSky" src="#vrVideo" phi-start="180" phi-length="180" radius="5000"></a-sky>
                <a-video id="vrFlat" src="#vrVideo" width="23" height="12.9375"
                    position="0 0 -7.7" visible="false"></a-video>
                <a-camera id="vrCamera" position="0 0 0"
                    wasd-controls="acceleration:50"
                    look-controls="reverseMouseDrag:true"></a-camera>
            </a-scene>
            <div id="vrSubOverlay" style="display:none">
                <span></span>
            </div>
            <div id="vrProgressBar" style="display:none">
                <div id="vrProgressFill"></div>
            </div>
            <div id="vrStats"></div>
        `;

        document.body.appendChild(container);

        this.#mediaElement = document.getElementById('vrVideo');
        this.#vrScene = document.getElementById('vrScene');
        this.#vrSky = document.getElementById('vrSky');
        this.#vrFlat = document.getElementById('vrFlat');
        this.#vrCamera = document.getElementById('vrCamera');
        this.#progressBar = document.getElementById('vrProgressBar');
        this.#progressFill = document.getElementById('vrProgressFill');
        this.#statsEl = document.getElementById('vrStats');

        // 180° SBS UV fix: use left-eye portion
        const scene = this.#vrScene;
        const fixUV = () => {
            const sky = this.#vrSky;
            const mesh = sky?.getObject3D?.('mesh');
            if (!mesh) { sky?.addEventListener?.('loaded', fixUV); return; }
            const uv = mesh.geometry.attributes.uv;
            if (!uv) return;
            for (let i = 0; i < uv.count; i++) {
                uv.setX(i, uv.getX(i) * 0.5);
            }
            uv.needsUpdate = true;
        };
        fixUV();

        // Auto-detect VR based on aspect ratio
        this.#mediaElement.addEventListener('loadedmetadata', () => {
            const ratio = this.#mediaElement.videoWidth / this.#mediaElement.videoHeight;
            const isVr = ratio > 1.8 && ratio < 2.2;
            if (isVr !== this.#isVR) {
                this.#isVR = isVr;
                this.#vrSky.setAttribute('visible', isVr);
                this.#vrFlat.setAttribute('visible', !isVr);
            }
        });

        // Fullscreen fix: make a-scene fullscreen instead of canvas
        setTimeout(() => {
            const canvas = scene?.querySelector('canvas');
            if (canvas?.requestFullscreen) {
                const orig = canvas.requestFullscreen.bind(canvas);
                canvas.requestFullscreen = () => {
                    return scene.requestFullscreen ? scene.requestFullscreen() : orig();
                };
            }
        }, 2000);

        // Progress on timeupdate
        this.#mediaElement.addEventListener('timeupdate', () => this.#updateProgress());
        this.#mediaElement.addEventListener('ended', () => {
            Events.trigger(this, 'stopped');
            playbackManager.nextTrack();
        });
        this.#mediaElement.addEventListener('error', () => {
            Events.trigger(this, 'error');
        });
    }

    #destroyScene() {
        this.#mediaElement = null;
        this.#vrScene = null;
        this.#vrSky = null;
        this.#vrFlat = null;
        this.#vrCamera = null;
        const container = document.getElementById('vrPlayerContainer');
        if (container) container.remove();
    }

    // ── HLS playback ──

    async #setSrc(url, mimeType) {
        const Hls = VrPlayer.#hlsLib;
        const media = this.#mediaElement;

        if (this.#hls) {
            this.#hls.destroy();
            this.#hls = null;
        }

        if (Hls.isSupported() && mimeType === 'application/x-mpegURL') {
            this.#hls = new Hls({
                maxBufferLength: 2,
                maxMaxBufferLength: 2,
                manifestLoadingMaxRetry: 1,
                manifestLoadingRetryDelay: 500,
                levelLoadingMaxRetry: 1,
                levelLoadingRetryDelay: 500,
                fragLoadingMaxRetry: 2,
                fragLoadingRetryDelay: 300
            });
            this.#hls.loadSource(url);
            this.#hls.attachMedia(media);

            return new Promise((resolve) => {
                this.#hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    media.play().catch(() => {});
                    resolve();
                });
                this.#hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (data.fatal) {
                        console.error('[VR Player] HLS fatal error', data);
                        this.#destroyHls();
                        Events.trigger(this, 'error');
                    }
                });
            });
        } else {
            media.src = url;
            media.play().catch(() => {});
        }
    }

    #destroyHls() {
        if (this.#hls) {
            this.#hls.destroy();
            this.#hls = null;
        }
    }

    // ── Keyboard shortcuts ──

    #onKeyDown(e) {
        if (!this.#mediaElement?.duration) return;

        switch (e.key) {
            case 'ArrowLeft':
                this.#mediaElement.currentTime = Math.max(0, this.#mediaElement.currentTime - 30);
                this.#showProgress();
                e.preventDefault();
                break;
            case 'ArrowRight':
                this.#mediaElement.currentTime = Math.min(this.#mediaElement.duration, this.#mediaElement.currentTime + 30);
                this.#mediaElement.muted = false;
                this.#showProgress();
                e.preventDefault();
                break;
            case ' ':
                this.#mediaElement.paused ? this.#mediaElement.play() : this.#mediaElement.pause();
                e.preventDefault();
                break;
            case 'v':
                if (!e.ctrlKey && !e.altKey) {
                    this.toggleVr();
                }
                break;
            case 's':
                if (!e.ctrlKey && !e.altKey) {
                    const s = this.#statsEl;
                    s.style.display = s.style.display === 'block' ? 'none' : 'block';
                }
                break;
            default:
                break;
        }
    }

    #registerShortcuts() {
        this._keyHandler = this.#onKeyDown.bind(this);
        window.addEventListener('keydown', this._keyHandler);
    }

    #unregisterShortcuts() {
        if (this._keyHandler) {
            window.removeEventListener('keydown', this._keyHandler);
        }
    }

    // ── Progress bar ──

    #showProgress() {
        if (!this.#progressBar) return;
        this.#progressBar.style.display = 'block';
        clearTimeout(this.#progressTimer);
        this.#progressTimer = setTimeout(() => {
            if (this.#progressBar) this.#progressBar.style.display = 'none';
        }, 2000);
    }

    #updateProgress() {
        const media = this.#mediaElement;
        if (!media?.duration || !this.#progressFill) return;
        this.#progressFill.style.width = (media.currentTime / media.duration * 100) + '%';
    }

    // ── Stats ──

    #startStats() {
        const loop = () => {
            if (!this.#statsEl || this.#statsEl.style.display !== 'block') {
                this.#rafId = requestAnimationFrame(loop);
                return;
            }
            const v = this.#mediaElement;
            if (!v?.duration) { this.#rafId = requestAnimationFrame(loop); return; }
            this.#fpsCnt++;
            const now = performance.now();
            if (now - this.#lastFps >= 1000) {
                this.#fps = this.#fpsCnt;
                this.#fpsCnt = 0;
                this.#lastFps = now;
            }
            this.#statsEl.innerHTML =
                `${v.videoWidth || '--'}x${v.videoHeight || '--'} | FPS: ${this.#fps} | ${(v.currentTime || 0).toFixed(1)}/${(v.duration || 0).toFixed(1)}s<br>` +
                `Dropped: ${v.webkitDroppedFrameCount ?? 0} | Mode: ${this.#isVR ? 'VR' : '2D'}`;
            this.#rafId = requestAnimationFrame(loop);
        };
        this.#rafId = requestAnimationFrame(loop);
    }

    #stopStats() {
        if (this.#rafId) cancelAnimationFrame(this.#rafId);
    }
}

export default VrPlayer;
