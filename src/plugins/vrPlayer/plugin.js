import { playbackManager } from '../../components/playback/playbackmanager';
import profileBuilder from '../../scripts/browserDeviceProfile';
import Events from '../../utils/events.ts';
import loading from '../../components/loading/loading';

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

    _media = null;
    _hls = null;
    _container = null;
    _isVr = true;
    _sphere = null;
    _flat = null;
    _cam = null;
    _keyHandler = null;
    _playing = false;

    static _aframeOk = false;
    static _hlsLib = null;

    static async _initAframe() {
        if (VrPlayer._aframeOk) return;
        // Patch webcomponents.js conflict
        if (!HTMLElement.prototype.doConnectedCallback) {
            HTMLElement.prototype.doConnectedCallback = function() {};
        }
        return new Promise(function(resolve) {
            var s = document.createElement('script');
            s.src = 'https://aframe.io/releases/1.6.0/aframe.min.js';
            s.onload = function() { VrPlayer._aframeOk = true; resolve(); };
            document.head.appendChild(s);
        });
    }

    static async _initHls() {
        if (VrPlayer._hlsLib) return VrPlayer._hlsLib;
        VrPlayer._hlsLib = await requireHlsPlayer();
        return VrPlayer._hlsLib;
    }

    canPlayMediaType(t) { return t === 'Video'; }
    canPlayItem(item) { return item && item.MediaType === 'Video'; }

    currentTime(v) { var m = this._media; if (m) { if (v != null) m.currentTime = v; return m.currentTime; } return 0; }
    duration() { var m = this._media; return m ? m.duration : 0; }
    paused() { var m = this._media; return m ? m.paused : true; }
    volume(v) { var m = this._media; if (m) { if (v != null) m.volume = v; return m.volume; } return 1; }
    setMute(m) { if (this._media) this._media.muted = m; }
    isMuted() { var m = this._media; return m ? m.muted : false; }
    getSupportedFeatures() { return ['PlaybackRate']; }

    getDeviceProfile(item) {
        return VrPlayer._profile().then(function(p) {
            p.PlayableMediaTypes = ['Video'];
            return p;
        });
    }

    static _profile() {
        var p = profileBuilder({});
        p.MaxStaticBitrate = 200000000;
        return Promise.resolve(p);
    }

    async play(opts) {
        if (this._playing) return;
        this._playing = true;
        try {
            loading.show();
            await VrPlayer._initAframe();
            await VrPlayer._initHls();
            this._build();
            this._keys(true);

            var url = opts.url;
            await this._load(url);

            document.body.classList.add('vrPlayerActive');
            loading.hide();
            Events.trigger(this, 'playing');

            if (opts.playerStartPositionTicks) {
                this._media.currentTime = opts.playerStartPositionTicks / 10000000;
            }
        } catch (e) {
            console.error('[VR] fail:', e);
            loading.hide();
            this.stop();
        }
    }

    stop() {
        this._playing = false;
        if (this._hls) { this._hls.destroy(); this._hls = null; }
        if (this._container) { this._container.remove(); this._container = null; }
        this._media = null; this._sphere = null; this._flat = null; this._cam = null;
        this._keys(false);
        document.body.classList.remove('vrPlayerActive');
        Events.trigger(this, 'stopped');
    }

    pause() { if (this._media) this._media.pause(); Events.trigger(this, 'pause'); }
    unpause() { if (this._media) this._media.play().catch(function(){}); Events.trigger(this, 'unpause'); }
    toggleVr() {
        this._isVr = !this._isVr;
        if (this._sphere) this._sphere.setAttribute('visible', this._isVr);
        if (this._flat) this._flat.setAttribute('visible', !this._isVr);
    }

    _build() {
        this._isVr = true;
        var self = this;

        var div = document.createElement('div');
        div.id = 'vrPlayerContainer';
        div.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:#000';
        document.body.appendChild(div);
        this._container = div;

        // Use innerHTML - this worked before
        div.innerHTML =
            '<a-scene embedded style="width:100%;height:100%" vr-mode-ui="enabled:true">' +
                '<a-assets><video id="vr-src" crossorigin="anonymous" playsinline autoplay muted loop></video></a-assets>' +
                '<a-sky id="vr-sphere" src="#vr-src" phi-start="180" phi-length="180" radius="5000"></a-sky>' +
                '<a-video id="vr-flat" src="#vr-src" width="16" height="9" position="0 0 -5" visible="false"></a-video>' +
                '<a-camera id="vr-cam" position="0 0 0" wasd-controls="acceleration:50" look-controls="reverseMouseDrag:true"></a-camera>' +
            '</a-scene>';

        // Wait for A-Frame to initialize then grab references and fix UV
        setTimeout(function() {
            self._media = document.getElementById('vr-src');
            self._sphere = document.getElementById('vr-sphere');
            self._flat = document.getElementById('vr-flat');
            self._cam = document.getElementById('vr-cam');

            // 180° SBS UV fix
            (function fixUV() {
                var sphere = self._sphere;
                if (!sphere) return;
                try {
                    var mesh = sphere.getObject3D('mesh');
                    if (!mesh) { sphere.addEventListener('loaded', fixUV); return; }
                    var uv = mesh.geometry.attributes.uv;
                    if (!uv) return;
                    for (var i = 0; i < uv.count; i++) {
                        uv.setX(i, uv.getX(i) * 0.5);
                    }
                    uv.needsUpdate = true;
                } catch(e) { /* A-Frame not ready yet */ }
            })();

            var vid = self._media;
            if (vid) {
                vid.addEventListener('ended', function() {
                    Events.trigger(self, 'stopped');
                    playbackManager.nextTrack();
                });
                vid.addEventListener('error', function() {
                    Events.trigger(self, 'error');
                });
            }
        }, 300);
    }

    async _load(url) {
        var Hls = VrPlayer._hlsLib;
        var vid = this._media;
        var self = this;

        if (this._hls) { this._hls.destroy(); this._hls = null; }

        // Wait for A-Frame to provide the video element
        if (!vid) {
            await new Promise(function(r) { setTimeout(r, 500); });
            vid = this._media;
        }

        var isHls = /\.m3u8(\?|$)/i.test(url) || /\.m3u(\?|$)/i.test(url);

        if (isHls && Hls.isSupported()) {
            this._hls = new Hls({
                maxBufferLength: 2, maxMaxBufferLength: 2,
                manifestLoadingMaxRetry: 1, manifestLoadingRetryDelay: 500,
                levelLoadingMaxRetry: 1, levelLoadingRetryDelay: 500,
                fragLoadingMaxRetry: 2, fragLoadingRetryDelay: 300
            });
            this._hls.loadSource(url);
            this._hls.attachMedia(vid);

            return new Promise(function(resolve, reject) {
                self._hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    vid.play().catch(function(){});
                    resolve();
                });
                self._hls.on(Hls.Events.ERROR, function(_e, d) {
                    if (d.fatal) { self.stop(); reject(d); }
                });
            });
        } else {
            vid.src = url;
            return vid.play().catch(function(){});
        }
    }

    _keys(on) {
        var self = this;
        if (on) {
            this._keyHandler = function(e) {
                var v = self._media;
                if (!v || !v.duration) return;
                switch (e.key) {
                    case 'ArrowLeft': v.currentTime = Math.max(0, v.currentTime - 30); e.preventDefault(); break;
                    case 'ArrowRight': v.currentTime = Math.min(v.duration, v.currentTime + 30); v.muted = false; e.preventDefault(); break;
                    case ' ': v.paused ? v.play() : v.pause(); e.preventDefault(); break;
                    case 'v': if (!e.ctrlKey && !e.altKey) self.toggleVr(); break;
                }
            };
            window.addEventListener('keydown', this._keyHandler);
        } else {
            if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
        }
    }
}

export default VrPlayer;
