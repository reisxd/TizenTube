import { configRead, configChangeEmitter } from '../config.js';
import { showToast } from '../ui/ytUI.js';

/**
 * PlaybackSync: Subtile Audio-Video-Synchronisierung für Tizen TVs
 * 
 * Problem: Bei hoher Playback-Speed (1.5x+) auf 50/60fps YouTube-Videos werden Frames gedroppt
 * → Audio und Video laufen asynchron, besonders bei höheren Resolutionen.
 * 
 * Lösung: Subtile, unmerkliche Anpassungen der Video-Position:
 * - Monitort Drift zwischen Audio und Video (wird über currentTime erkannt)
 * - Nur bei kritischem Drift (>200ms) kleine Sprünge (~20-50ms)
 * - Extrem seltene Anpassungen (mindestens 5-10 Sekunden zwischen Korrektionen)
 * - User merkt nichts davon - es sieht aus wie normales Abspielen
 */

class SubtlePlaybackSync {
  constructor() {
    this.videoEl = null;
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

    // Video-Tracking für Toast
    this.currentVideoId = null;
    this.hasShownToastForVideo = false;

    // Thresholds - extrem konservativ, damit User nichts merkt
    this.criticalDriftThreshold = 0.2; // 200ms - erst dann anpassen
    this.warningDriftThreshold = 0.15; // 150ms - vorher warnen
    this.maxAdjustmentPerTick = 0.03; // Max 30ms Anpassung pro Mal
    this.minAdjustmentInterval = 7000; // Mindestens 7 Sekunden zwischen Anpassungen
    this.intervalMs = 2000; // Check alle 2 Sekunden
    this.enabled = true;
  }

  attach(videoEl) {
    if (this.videoEl) this.detach();

    this.videoEl = videoEl;

    // Listener für Speed-Änderungen
    this._onRateChange = () => {
      this.resetBaseline();
      this.consecutiveHighDrifts = 0;
    };

    this._onSeeked = () => {
      this.resetBaseline();
      this.consecutiveHighDrifts = 0;
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

  _tick() {
    if (!this.videoEl || this.videoEl.paused || this.videoEl.ended) return;

    const now = performance.now();
    const elapsedSeconds = (now - this.lastBaselineTime) / 1000;
    const rate = this.videoEl.playbackRate || 1;

    // Erwartete Zeit basierend auf Playback-Rate
    const expectedCurrentTime = this.lastBaselineCurrentTime + elapsedSeconds * rate;
    const actualCurrentTime = this.videoEl.currentTime;
    
    // Drift: wie weit Audio/Video auseinander sind
    const drift = Math.abs(expectedCurrentTime - actualCurrentTime);

    // Debug logging (optional)
    // console.log(`[SubtleSync] Drift: ${drift.toFixed(3)}s at ${rate}x speed`);

    // Nur bei hohen Speeds und 50/60fps monitoren
    if (rate < 1.25) {
      this.consecutiveHighDrifts = 0;
      return;
    }

    // Zähle konsekutive High-Drift-Events
    if (drift > this.warningDriftThreshold) {
      this.consecutiveHighDrifts++;
    } else {
      this.consecutiveHighDrifts = 0;
    }

    // Nur wenn kritischer Drift UND genug Zeit seit letzter Anpassung vergangen
    if (drift > this.criticalDriftThreshold) {
      const timeSinceLastAdjustment = now - this.lastAdjustmentTime;
      
      if (timeSinceLastAdjustment > this.minAdjustmentInterval) {
        this.performSubtleCorrection(expectedCurrentTime, actualCurrentTime, drift);
      }
    }
  }

  performSubtleCorrection(expectedTime, actualTime, drift) {
    const now = performance.now();
    const timeDiff = expectedTime - actualTime;

    // Berechne Korrekturgröße: kleiner, je kleiner der Drift
    // Bei 200ms Drift: ~30ms Anpassung
    // Bei 250ms Drift: ~30ms Anpassung
    const correctionAmount = Math.min(
      Math.abs(timeDiff) * 0.15, // 15% des Drifts
      this.maxAdjustmentPerTick
    );

    const direction = timeDiff > 0 ? 1 : -1; // Forward oder backward
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
        `[SubtleSync] Subtle correction applied: drift=${drift.toFixed(3)}s, ` +
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
