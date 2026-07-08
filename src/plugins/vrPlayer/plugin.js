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
    isFetching = false;

    _media = null;
    _hls = null;
    _container = null;
    _playing = false;
    _keyHandler = null;

    static _hlsLib = null;
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
        return VrPlayer._profile(item).then(function(p) {
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
        console.log('[VR] play() called, url=', opts.url);
        try {
            loading.show();
            await VrPlayer._initHls();
            console.log('[VR] HLS ready');
            this._build();
            this._keys(true);

            var url = opts.url;
            await this._load(url);

            loading.hide();
            console.log('[VR] loaded, triggering playing');
            Events.trigger(this, 'playing');

            if (opts.playerStartPositionTicks) {
                this._media.currentTime = opts.playerStartPositionTicks / 10000000;
            }
        } catch (e) {
            console.error('[VR] fail:', e);
            loading.hide();
        }
    }

    stop() {
        console.log('[VR] stop()');
        this._playing = false;
        if (this._hls) { this._hls.destroy(); this._hls = null; }
        if (this._container) { this._container.remove(); this._container = null; }
        this._media = null;
        this._keys(false);
        Events.trigger(this, 'stopped');
    }

    pause() { if (this._media) this._media.pause(); Events.trigger(this, 'pause'); }
    unpause() { if (this._media) this._media.play().catch(function(){}); Events.trigger(this, 'unpause'); }
    toggleVr() {}

    _build() {
        console.log('[VR] _build()');
        var div = document.createElement('div');
        div.id = 'vrPlayerContainer';
        div.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:#000';
        document.body.appendChild(div);
        this._container = div;

        var vid = document.createElement('video');
        vid.crossOrigin = 'anonymous';
        vid.playsInline = true;
        vid.controls = true;
        vid.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:90vw;max-height:90vh';
        div.appendChild(vid);
        this._media = vid;

        var self = this;
        vid.addEventListener('ended', function() {
            Events.trigger(self, 'stopped');
            playbackManager.nextTrack();
        });
        vid.addEventListener('error', function() {
            Events.trigger(self, 'error');
        });
    }

    async _load(url) {
        var Hls = VrPlayer._hlsLib;
        var vid = this._media;
        var self = this;

        if (this._hls) { this._hls.destroy(); this._hls = null; }

        var isHls = /\.m3u8(\?|$)/i.test(url) || /\.m3u(\?|$)/i.test(url);

        if (isHls && Hls.isSupported()) {
            console.log('[VR] HLS load:', url);
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
                    console.log('[VR] MANIFEST_PARSED');
                    vid.play().catch(function(){});
                    resolve();
                });
                self._hls.on(Hls.Events.ERROR, function(_e, d) {
                    console.error('[VR] HLS error:', d);
                    if (d.fatal) { self.stop(); reject(d); }
                });
            });
        } else {
            console.log('[VR] native load:', url);
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
                }
            };
            window.addEventListener('keydown', this._keyHandler);
        } else {
            if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
        }
    }
}

export default VrPlayer;
