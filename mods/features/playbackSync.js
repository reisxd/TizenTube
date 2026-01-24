import { configRead, configChangeEmitter } from '../config.js';
import { showToast } from '../ui/ytUI.js';

/**
 * PlaybackSync: Subtile Audio-Video-Synchronisierung für Tizen TVs
 * 
 * Problem: Bei hoher Playback-Speed (1.5x+) auf 50/60fps YouTube-Videos werden viele Frames gedroppt
 * → Audio und Video laufen asynchron, Drift kann sehr schnell >5s werden
 * 
 * Lösung: Aktive, frame-drop-aware Synchronisierung:
 * - Monitort DROPPED FRAMES direkt aus getVideoStats() (primär)
 * - Monitort auch Drift zwischen Audio/Video (fallback)
 * - Bei hohem Frame-Drop sofort aggressiv synchen (keine 3s Wartezeit)
 * - Bei niedrigem Frame-Drop subtil und selten synchen
 * - User merkt nichts - sieht nur flüssiges Playback
 */

class SubtlePlaybackSync {
  constructor() {
    this.videoEl = null;
    this.player = null;
    this._running = false;
    this.timerId = null;

    // Baseline tracking für Drift-Berechnung
    this.lastBaselineTime = 0;
    this.lastBaselineCurrentTime = 0;
    this.lastRate = 1;

    // Anpassungs-Tracking
    this.lastAdjustmentTime = 0;
    this.lastAdjustmentAmount = 0;
    this.consecutiveHighDrifts = 0;

    // Frame-Drop Tracking (primär für Erkennung)
    this.lastDroppedFrameCount = 0;
    this.lastTotalFrameCount = 0;
    this.droppedFrameRate = 0;

    // Video-Tracking für Toast
    this.currentVideoId = null;
    this.hasShownToastForVideo = false;

    // Thresholds
    this.criticalDriftThreshold = 0.18; // 180ms - klassische Drift-Schwelle
    this.warningDriftThreshold = 0.15; // 150ms
    this.droppedFrameRateWarning = 0.15; // 15% dropped frames = reagiere
    this.droppedFrameRateCritical = 0.25; // 25% dropped frames = aggressiv
    
    // Anpassungsparameter
    this.maxAdjustmentPerTick = 0.04; // Max 40ms normal
    this.maxAdjustmentPerTickAggressive = 0.08; // Max 80ms bei hohem Frame-Drop
    
    // Interval-Parameter
    this.minAdjustmentInterval = 3000; // Normal: 3s minimum zwischen Anpassungen
    this.minAdjustmentIntervalAggressive = 1000; // Aggressive: 1s wenn Frames fallen
    
    this.intervalMs = 500; // Check alle 500ms (schneller für Frame-Drop Erkennung)
    this.enabled = true;
  }

  attach(videoEl) {
    if (this.videoEl) this.detach();

    this.videoEl = videoEl;

    // Find player element for stats
    try {
      this.player = document.querySelector('.html5-video-player');
    } catch (e) {
      console.warn('[SubtlePlaybackSync] Could not find player element');
    }

    // Listener für Speed-Änderungen
    this._onRateChange = () => {
      this.resetBaseline();
      this.consecutiveHighDrifts = 0;
      this.lastDroppedFrameCount = 0;
      this.lastTotalFrameCount = 0;
    };

    this._onSeeked = () => {
      this.resetBaseline();
      this.consecutiveHighDrifts = 0;
      this.lastDroppedFrameCount = 0;
      this.lastTotalFrameCount = 0;
    };

    this._onConfigChange = (ev) => {
      if (ev.detail?.key === 'enableCpuStressOptimization') {
        this.enabled = configRead('enableCpuStressOptimization');
      }
    };

    this.videoEl.addEventListener('ratechange', this._onRateChange);
    this.videoEl.addEventListener('seeked', this._onSeeked);
    configChangeEmitter.addEventListener('configChange', this._onConfigChange);

    this.enabled = configRead('enableCpuStressOptimization');
    this.start();

    console.info('[SubtlePlaybackSync] Attached to video element');
  }

  detach() {
    if (this.videoEl) {
      this.videoEl.removeEventListener('ratechange', this._onRateChange);
      this.videoEl.removeEventListener('seeked', this._onSeeked);
      configChangeEmitter.removeEventListener('configChange', this._onConfigChange);
    }
    this.stop();
    this.videoEl = null;
    this.player = null;
  }

  resetBaseline() {
    if (this.videoEl) {
      this.lastBaselineTime = performance.now();
      this.lastBaselineCurrentTime = this.videoEl.currentTime;
      this.lastRate = this.videoEl.playbackRate || 1;
    }
  }

  start() {
    if (!this._running) {
      this._running = true;
      this.resetBaseline();
      this._schedule();
    }
  }

  stop() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this._running = false;
  }

  _schedule() {
    if (this._running) {
      this.timerId = setTimeout(() => {
        if (this.enabled) {
          this._tick();
        }
        this._schedule();
      }, this.intervalMs);
    }
  }

  _getCurrentVideoId() {
    try {
      const player = document.querySelector('.html5-video-player');
      return player?.getVideoData?.()?.video_id || null;
    } catch (e) {
      return null;
    }
  }

  _getVideoStats() {
    try {
      return this.player?.getVideoStats?.();
    } catch (e) {
      return null;
    }
  }

  _updateDroppedFrameRate() {
    const stats = this._getVideoStats();
    if (!stats) return 0;

    // Versuche dropped frames zu extrahieren
    const droppedFrames = this._getStatValue(stats, [
      'droppedVideoFrames',
      'dropped_video_frames',
      'droppedFrames'
    ]);

    const totalFrames = this._getStatValue(stats, [
      'totalVideoFrames',
      'total_video_frames',
      'totalFrames'
    ]);

    if (totalFrames > 0) {
      this.droppedFrameRate = droppedFrames / totalFrames;
      return this.droppedFrameRate;
    }

    return 0;
  }

  _getStatValue(stats, keys) {
    if (!stats || typeof stats !== 'object') return 0;

    for (const key of keys) {
      const val = stats[key];
      if (val !== undefined && val !== null) {
        const num = parseInt(val, 10);
        if (!isNaN(num)) return num;
      }
    }
    return 0;
  }

  _tick() {
    if (!this.videoEl || this.videoEl.paused || this.videoEl.ended) return;

    const now = performance.now();
    const elapsedSeconds = (now - this.lastBaselineTime) / 1000;
    const rate = this.videoEl.playbackRate || 1;

    // Nur bei hohen Speeds monitoren
    if (rate < 1.25) {
      this.consecutiveHighDrifts = 0;
      this.droppedFrameRate = 0;
      return;
    }

    // 1. PRIMÄR: Prüfe Dropped Frames (zuverlässiger als currentTime bei Frame-Drop)
    const droppedFrameRate = this._updateDroppedFrameRate();
    const hasHighFrameDrop = droppedFrameRate > this.droppedFrameRateWarning;
    const hasCriticalFrameDrop = droppedFrameRate > this.droppedFrameRateCritical;

    // 2. SEKUNDÄR: Klassische Drift-Erkennung
    const expectedCurrentTime = this.lastBaselineCurrentTime + elapsedSeconds * rate;
    const actualCurrentTime = this.videoEl.currentTime;
    const drift = Math.abs(expectedCurrentTime - actualCurrentTime);

    if (drift > this.warningDriftThreshold) {
      this.consecutiveHighDrifts++;
    } else {
      this.consecutiveHighDrifts = 0;
    }

    // 3. ENTSCHEIDUNG: Wann synchronisieren?
    const timeSinceLastAdjustment = now - this.lastAdjustmentTime;

    // Aggressive Sync bei kritischem Frame-Drop
    if (hasCriticalFrameDrop && timeSinceLastAdjustment > this.minAdjustmentIntervalAggressive) {
      console.warn(
        `[SubtleSync] HIGH FRAME DROP RATE: ${(droppedFrameRate * 100).toFixed(1)}% at ${rate}x - aggressive sync`
      );
      this.performSubtleCorrection(expectedCurrentTime, actualCurrentTime, drift, true);
      return;
    }

    // Moderate Sync bei erhöhtem Frame-Drop
    if (hasHighFrameDrop && timeSinceLastAdjustment > this.minAdjustmentIntervalAggressive * 2) {
      console.warn(
        `[SubtleSync] Moderate frame drop: ${(droppedFrameRate * 100).toFixed(1)}% at ${rate}x - moderate sync`
      );
      this.performSubtleCorrection(expectedCurrentTime, actualCurrentTime, drift, false);
      return;
    }

    // Subtile Sync nur bei klassischem Drift (wenn keine Frame-Drops)
    if (!hasHighFrameDrop && drift > this.criticalDriftThreshold) {
      if (timeSinceLastAdjustment > this.minAdjustmentInterval) {
        this.performSubtleCorrection(expectedCurrentTime, actualCurrentTime, drift, false);
      }
    }
  }

  performSubtleCorrection(expectedTime, actualTime, drift, isAggressive) {
    const now = performance.now();
    const timeDiff = expectedTime - actualTime;

    // Adaptive Korrekturgröße basierend auf Mode
    const maxAdjustment = isAggressive 
      ? this.maxAdjustmentPerTickAggressive 
      : this.maxAdjustmentPerTick;

    const correctionAmount = Math.min(
      Math.abs(timeDiff) * (isAggressive ? 0.25 : 0.15), // Aggressiver oder subtil
      maxAdjustment
    );

    const direction = timeDiff > 0 ? 1 : -1;
    const newTime = actualTime + (correctionAmount * direction);

    try {
      this.videoEl.currentTime = newTime;
      this.lastAdjustmentTime = now;
      this.lastAdjustmentAmount = correctionAmount * direction;

      // Zeige Toast nur beim ersten Mal pro Video
      const currentVideoId = this._getCurrentVideoId();
      if (currentVideoId !== this.currentVideoId) {
        this.currentVideoId = currentVideoId;
        this.hasShownToastForVideo = false;
      }

      if (!this.hasShownToastForVideo && currentVideoId) {
        showToast('TizenTube', `Syncing audio and video at ${this.videoEl.playbackRate}x speed`);
        this.hasShownToastForVideo = true;
      }

      console.info(
        `[SubtleSync] ${isAggressive ? 'AGGRESSIVE' : 'Subtle'} correction: ` +
        `drift=${drift.toFixed(3)}s, dropped=${(this.droppedFrameRate * 100).toFixed(1)}%, ` +
        `adjustment=${(correctionAmount * direction).toFixed(3)}s at ${this.videoEl.playbackRate}x speed`
      );

      // Baseline nach Anpassung zurücksetzen
      this.resetBaseline();
    } catch (e) {
      console.warn('[SubtleSync] Failed to apply correction:', e);
    }
  }
}

// Auto-attach to video element
const interval = setInterval(() => {
  const videoEl = document.querySelector('video');
  if (videoEl) {
    if (!window.__ttSubtlePlaybackSync) {
      window.__ttSubtlePlaybackSync = new SubtlePlaybackSync();
    }
    window.__ttSubtlePlaybackSync.attach(videoEl);
    clearInterval(interval);
  }
}, 1000);

export { SubtlePlaybackSync };
