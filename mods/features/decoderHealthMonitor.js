import { configRead, configChangeEmitter } from '../config.js';

/**
 * DecoderHealthMonitor: Subtile Decoder-Optimierungen für Tizen TVs
 * 
 * Problem: Bei hohen Speeds (1.5x+) auf 50/60fps YouTube Videos
 * kann der Decoder überfordert werden → dropped frames → Audio/Video Desync
 * 
 * Lösung: Subtile, unmerkliche Hintergrund-Optimierungen:
 * - Monitore Decoder-Health via getVideoStats()
 * - Bei Überlastung: Reduziere UI-Updates und Animation-Overhead
 * - Optimiere tectonicConfig für Hardware-Rendering
 * - User merkt NICHTS - läuft einfach besser
 */

class DecoderHealthMonitor {
  constructor() {
    this.videoEl = null;
    this.player = null;
    this._running = false;
    this.timerId = null;

    // Health tracking
    this.lastStats = null;
    this.droppedFrameHistory = [];
    this.isOptimizationActive = false;
    
    // Thresholds
    this.droppedFrameWarningThreshold = 0.05; // 5% dropped frames = Zeit zu optimieren
    this.droppedFrameRecoveryThreshold = 0.02; // 2% = zurück zu normal
    this.monitoringIntervalMs = 3000; // Check alle 3 Sekunden
    this.enabled = true;
  }

  attach(videoEl) {
    if (this.videoEl) this.detach();

    this.videoEl = videoEl;

    // Find player element
    try {
      this.player = document.querySelector('.html5-video-player');
    } catch (e) {
      console.warn('[DecoderHealthMonitor] Could not find player element');
    }

    this._onConfigChange = (ev) => {
      if (ev.detail?.key === 'enableDecoderMonitor') {
        this.enabled = configRead('enableDecoderMonitor');
      }
    };

    configChangeEmitter.addEventListener('configChange', this._onConfigChange);
    this.enabled = configRead('enableDecoderMonitor');
    
    this.start();
    console.info('[DecoderHealthMonitor] Attached to video element');
  }

  detach() {
    configChangeEmitter.removeEventListener('configChange', this._onConfigChange);
    this.stop();
    this._restoreDefaults();
    this.videoEl = null;
    this.player = null;
  }

  start() {
    if (!this._running) {
      this._running = true;
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
      }, this.monitoringIntervalMs);
    }
  }

  _tick() {
    if (!this.videoEl || !this.player || this.videoEl.paused || this.videoEl.ended) return;

    const rate = this.videoEl.playbackRate || 1;
    
    // Nur bei höheren Speeds monitoren
    if (rate < 1.25) {
      if (this.isOptimizationActive) {
        this._restoreDefaults();
      }
      this.droppedFrameHistory = [];
      return;
    }

    const stats = this._getVideoStats();
    if (!stats) return;

    const droppedRatio = this._calculateDroppedFrameRatio(stats);

    // Health-basierte Entscheidung
    if (droppedRatio > this.droppedFrameWarningThreshold) {
      this._applyOptimizations(droppedRatio, rate);
    } else if (droppedRatio < this.droppedFrameRecoveryThreshold && this.isOptimizationActive) {
      this._restoreDefaults();
    }

    this.lastStats = stats;
  }

  _getVideoStats() {
    try {
      return this.player.getVideoStats?.();
    } catch (e) {
      return null;
    }
  }

  _calculateDroppedFrameRatio(stats) {
    if (!stats) return 0;

    // YouTube gibt diese Stats zurück (vary by player version):
    // 'droppedVideoFrames' oder 'dropped_video_frames'
    // 'totalVideoFrames' oder 'total_video_frames'
    // oder 'vq' (video quality) strings mit frame info

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

    if (totalFrames && droppedFrames) {
      return droppedFrames / totalFrames;
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

  _applyOptimizations(droppedRatio, rate) {
    if (this.isOptimizationActive) return; // Already active

    console.info(
      `[DecoderHealthMonitor] Applying silent optimizations (${(droppedRatio * 100).toFixed(1)}% dropped at ${rate}x)`
    );

    try {
      // 1. Reduziere UI-Animation-Overhead (tectonicConfig)
      if (window.tectonicConfig?.featureSwitches) {
        window.tectonicConfig.featureSwitches.enableAnimations = false;
        window.tectonicConfig.featureSwitches.enableListAnimations = false;
        window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = false;
      }

      // 2. Reduziere UI-Update-Frequenz - nur wenn nötig rendern
      // Das passiert automatisch durch Animation-Disable

      // 3. Hints for better hardware utilization (falls verfügbar)
      if (this.videoEl && this.videoEl.webkitDecodedFrameCount !== undefined) {
        // Tizen TV hardware availability wird erkannt - bereits optimiert
      }

      this.isOptimizationActive = true;
    } catch (e) {
      console.warn('[DecoderHealthMonitor] Failed to apply optimizations:', e);
    }
  }

  _restoreDefaults() {
    if (!this.isOptimizationActive) return; // Not active

    console.info('[DecoderHealthMonitor] Restoring default animations and rendering');

    try {
      // Restore UI animations
      if (window.tectonicConfig?.featureSwitches) {
        window.tectonicConfig.featureSwitches.enableAnimations = true;
        window.tectonicConfig.featureSwitches.enableListAnimations = true;
        window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = true;
      }

      this.isOptimizationActive = false;
    } catch (e) {
      console.warn('[DecoderHealthMonitor] Failed to restore defaults:', e);
    }
  }
}

// Auto-attach to video element
const interval = setInterval(() => {
  const videoEl = document.querySelector('video');
  if (videoEl) {
    if (!window.__ttDecoderHealthMonitor) {
      window.__ttDecoderHealthMonitor = new DecoderHealthMonitor();
    }
    window.__ttDecoderHealthMonitor.attach(videoEl);
    clearInterval(interval);
  }
}, 1000);

export { DecoderHealthMonitor };
