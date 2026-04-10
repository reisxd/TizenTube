import sha256 from '../tiny-sha256.js';
import { configRead } from '../config.js';
import { showToast } from '../ui/ytUI.js';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/da1a535de784540ee10166a75a3eb8537073838c/src/config.ts#L113-L134
const barTypes = {
  sponsor:        { color: '#00d400', opacity: '0.7', name: 'sponsored segment' },
  intro:          { color: '#00ffff', opacity: '0.7', name: 'intro' },
  outro:          { color: '#0202ed', opacity: '0.7', name: 'outro' },
  interaction:    { color: '#cc00ff', opacity: '0.7', name: 'interaction reminder' },
  selfpromo:      { color: '#ffff00', opacity: '0.7', name: 'self-promotion' },
  preview:        { color: '#008fd6', opacity: '0.7', name: 'recap or preview' },
  filler:         { color: '#7300FF', opacity: '0.9', name: 'tangents' },
  music_offtopic: { color: '#ff9900', opacity: '0.7', name: 'non-music part' },
  poi_highlight:  { color: '#9b044c', opacity: '0.7', name: 'highlight' }
};

const sponsorblockAPI = 'https://sponsor.ajay.app/api';

class SponsorBlockHandler {
  video = null;
  active = true;

  attachVideoTimeout = null;
  nextSkipTimeout = null;
  sliderInterval = null;

  observer = null;
  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;
  skippableCategories = [];
  manualSkippableCategories = [];
  skippedCategories = new Map();

  constructor(videoID) {
    this.videoID = videoID;
  }

  // FIX: Wrapped in try/catch so a network failure, non-200 response, or unexpected
  // JSON shape doesn't leave the SponsorBlockHandler in a half-initialised state
  // that silently breaks the skip timer for the rest of the video.
  async init() {
    try {
      const videoHash = sha256(this.videoID).substring(0, 4);
      const categories = [
        'sponsor', 'intro', 'outro', 'interaction', 'selfpromo',
        'preview', 'filler', 'music_offtopic', 'poi_highlight'
      ];

      let resp;
      try {
        resp = await fetch(
          `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(JSON.stringify(categories))}`
        );
      } catch (fetchErr) {
        console.warn('[SponsorBlock] Network request failed for', this.videoID, fetchErr);
        return;
      }

      if (!resp.ok) {
        // 404 = no segments for this video, not an error worth warning about
        if (resp.status !== 404) {
          console.warn('[SponsorBlock] API returned', resp.status, 'for', this.videoID);
        } else {
          console.info(this.videoID, 'No segments found (404).');
        }
        return;
      }

      let results;
      try {
        results = await resp.json();
      } catch (parseErr) {
        console.warn('[SponsorBlock] Failed to parse API response for', this.videoID, parseErr);
        return;
      }

      if (!Array.isArray(results)) {
        console.warn('[SponsorBlock] Unexpected API response shape for', this.videoID, typeof results);
        return;
      }

      const result = results.find((v) => v.videoID === this.videoID);
      console.info(this.videoID, 'Got it:', result);

      if (!result || !result.segments || !result.segments.length) {
        console.info(this.videoID, 'No segments found.');
        return;
      }

      this.segments = result.segments;
      this.manualSkippableCategories = configRead('sponsorBlockManualSkips');
      this.skippableCategories = this.getSkippableCategories();

      this.scheduleSkipHandler = () => {
        try {
          const slider = document.querySelector('div[idomkey="slider"]');
          if (!slider) return;
          const sliderRect = slider.getBoundingClientRect();
          const isOldUI = !document.querySelector('div[idomkey="Metadata-Section"]');
          if (isOldUI && this.segmentsoverlay) {
            this.segmentsoverlay.style.setProperty('top', `${sliderRect.top}px`, 'important');
          }
          this.scheduleSkip();
        } catch (e) {
          console.warn('[SponsorBlock] scheduleSkipHandler error:', e);
        }
      };

      this.durationChangeHandler = () => {
        try { this.buildOverlay(); } catch (e) { console.warn('[SponsorBlock] buildOverlay via durationchange failed:', e); }
      };

      this.attachVideo();
      this.buildOverlay();
    } catch (err) {
      console.warn('[SponsorBlock] init() failed for', this.videoID, err);
    }
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor'))      skippableCategories.push('sponsor');
    if (configRead('enableSponsorBlockIntro'))        skippableCategories.push('intro');
    if (configRead('enableSponsorBlockOutro'))        skippableCategories.push('outro');
    if (configRead('enableSponsorBlockInteraction'))  skippableCategories.push('interaction');
    if (configRead('enableSponsorBlockSelfPromo'))    skippableCategories.push('selfpromo');
    if (configRead('enableSponsorBlockPreview'))      skippableCategories.push('preview');
    if (configRead('enableSponsorBlockFiller'))       skippableCategories.push('filler');
    if (configRead('enableSponsorBlockMusicOfftopic')) skippableCategories.push('music_offtopic');
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;

    this.video = document.querySelector('video');
    if (!this.video) {
      console.info(this.videoID, 'No video yet...');
      this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      return;
    }

    console.info(this.videoID, 'Video found, binding...');
    this.video.addEventListener('play', this.scheduleSkipHandler);
    this.video.addEventListener('pause', this.scheduleSkipHandler);
    this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
    this.video.addEventListener('durationchange', this.durationChangeHandler);
  }

  buildOverlay() {
    if (this.segmentsoverlay) {
      console.info('Overlay already built');
      return;
    }

    if (!this.video || !this.video.duration) {
      console.info('No video duration yet');
      return;
    }

    try {
      const videoDuration = this.video.duration;
      const slider = document.querySelector('div[idomkey="slider"]');
      if (!slider) {
        console.warn('[SponsorBlock] buildOverlay: slider element not found');
        return;
      }

      this.segmentsoverlay = document.createElement('div');
      this.segmentsoverlay.classList.add('ytLrProgressBarSlider', 'ytLrProgressBarSliderRectangularProgressBar');
      this.segmentsoverlay.style.setProperty('z-index', '10', 'important');
      this.segmentsoverlay.style.setProperty('background-color', 'rgba(0, 0, 0, 0)', 'important');
      this.segmentsoverlay.style.setProperty('width', '72rem', 'important');
      this.segmentsoverlay.style.setProperty('left', '4rem', 'important');

      const sliderRect = slider.getBoundingClientRect();
      if (!slider.classList.contains('ytLrProgressBarSlider')) {
        for (let i = 0; i < slider.classList.length; i++) {
          this.segmentsoverlay.classList.add(slider.classList[i]);
        }
        this.segmentsoverlay.style.setProperty('height', `${sliderRect.height}px`, 'important');
        this.segmentsoverlay.style.setProperty('bottom', `${sliderRect.bottom - sliderRect.top}px`, 'important');
      }

      this.segments.forEach((segment) => {
        try {
          const [start, end] = segment.segment;
          const barType = barTypes[segment.category] || { color: 'blue', opacity: 0.7 };
          const leftPercent = videoDuration ? (100.0 * start) / videoDuration : 0;
          const widthPercent = videoDuration ? (100.0 * (end - start)) / videoDuration : 0;

          const elm = document.createElement('div');
          elm.style.setProperty('background-color', barType.color, 'important');
          elm.style.setProperty('opacity', barType.opacity, 'important');
          elm.style.setProperty('height', '100%', 'important');
          elm.style.setProperty('width', `${segment.category === 'poi_highlight' ? 1 : widthPercent}%`, 'important');
          elm.style.setProperty('left', `${leftPercent}%`, 'important');
          elm.style.setProperty('position', 'absolute', 'important');
          console.info('Generated element', elm, 'from', segment);
          this.segmentsoverlay.appendChild(elm);
        } catch (segErr) {
          console.warn('[SponsorBlock] Failed to build segment overlay element:', segErr, segment);
        }
      });

      this.observer = new MutationObserver((mutations) => {
        try {
          mutations.forEach((m) => {
            if (m.removedNodes) {
              for (const node of m.removedNodes) {
                if (node === this.segmentsoverlay) {
                  console.info('bringing back segments overlay');
                  this.slider.appendChild(this.segmentsoverlay);
                }
              }
            }
            const progressBar = document.querySelector('ytlr-progress-bar');
            if (progressBar) {
              if (progressBar.getAttribute('hybridnavfocusable') === 'false') {
                this.segmentsoverlay.style.setProperty('display', 'none', 'important');
              } else {
                this.segmentsoverlay.style.setProperty('display', 'block', 'important');
              }
            }
          });
        } catch (obsErr) {
          console.warn('[SponsorBlock] MutationObserver callback error:', obsErr);
        }
      });

      this.sliderInterval = setInterval(() => {
        try {
          this.slider = document.querySelector('ytlr-redux-connect-ytlr-progress-bar');
          if (this.slider) {
            clearInterval(this.sliderInterval);
            this.sliderInterval = null;
            this.observer.observe(this.slider, { childList: true, subtree: true });
            this.slider.appendChild(this.segmentsoverlay);
          }
        } catch (e) {
          console.warn('[SponsorBlock] sliderInterval error:', e);
          clearInterval(this.sliderInterval);
          this.sliderInterval = null;
        }
      }, 500);
    } catch (err) {
      console.warn('[SponsorBlock] buildOverlay() failed:', err);
      this.segmentsoverlay = null; // reset so it can be retried on durationchange
    }
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;

    if (!this.active) {
      console.info(this.videoID, 'No longer active, ignoring...');
      return;
    }

    if (!this.video || this.video.paused) {
      console.info(this.videoID, 'Currently paused or no video, ignoring...');
      return;
    }

    const nextSegments = this.segments.filter(
      (seg) =>
        seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      console.info(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    console.info(this.videoID, 'Scheduling skip of', segment, 'in', start - this.video.currentTime);

    this.nextSkipTimeout = setTimeout(() => {
      try {
        if (!this.video || this.video.paused) {
          console.info(this.videoID, 'Currently paused, ignoring...');
          return;
        }
        if (!this.skippableCategories.includes(segment.category)) {
          console.info(this.videoID, 'Segment', segment.category, 'is not skippable, ignoring...');
          return;
        }

        const skipName = barTypes[segment.category]?.name || segment.category;
        console.info(this.videoID, 'Skipping', segment);

        if (!this.manualSkippableCategories.includes(segment.category)) {
          const wasSkippedBefore = this.skippedCategories.get(segment.UUID);
          if (wasSkippedBefore) {
            wasSkippedBefore.count++;
            wasSkippedBefore.lastSkipped = Date.now();
            this.skippedCategories.set(segment.UUID, wasSkippedBefore);

            if (wasSkippedBefore.lastSkipped - wasSkippedBefore.firstSkipped < 1000) {
              if (!wasSkippedBefore.hasShownToast) {
                if (configRead('enableSponsorBlockToasts')) {
                  showToast('SponsorBlock', `Not skipping ${skipName} (was skipped ${wasSkippedBefore.count} times)`);
                }
                wasSkippedBefore.hasShownToast = true;
                this.skippedCategories.set(segment.UUID, wasSkippedBefore);
              }
              return;
            }
          } else {
            this.skippedCategories.set(segment.UUID, {
              count: 1,
              firstSkipped: Date.now(),
              lastSkipped: Date.now(),
              hasShownToast: false
            });
          }

          if (configRead('enableSponsorBlockToasts')) {
            showToast('SponsorBlock', `Skipping ${skipName}`);
          }
          if (this.video.duration - end < 1) {
            this.video.currentTime = end - 1;
          } else {
            this.video.currentTime = end;
          }
          this.scheduleSkip();
        }
      } catch (skipErr) {
        console.warn('[SponsorBlock] scheduleSkip timeout handler error:', skipErr);
      }
    }, (start - this.video.currentTime) * 1000 / (this.video.playbackRate || 1));
  }

  destroy() {
    console.info(this.videoID, 'Destroying');
    this.active = false;

    if (this.nextSkipTimeout)    { clearTimeout(this.nextSkipTimeout); this.nextSkipTimeout = null; }
    if (this.attachVideoTimeout) { clearTimeout(this.attachVideoTimeout); this.attachVideoTimeout = null; }
    if (this.sliderInterval)     { clearInterval(this.sliderInterval); this.sliderInterval = null; }
    if (this.observer)           { this.observer.disconnect(); this.observer = null; }
    if (this.segmentsoverlay)    { try { this.segmentsoverlay.remove(); } catch (_) {} this.segmentsoverlay = null; }

    if (this.video) {
      try {
        this.video.removeEventListener('play', this.scheduleSkipHandler);
        this.video.removeEventListener('pause', this.scheduleSkipHandler);
        this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
        this.video.removeEventListener('durationchange', this.durationChangeHandler);
      } catch (e) {
        console.warn('[SponsorBlock] destroy() removeEventListener failed:', e);
      }
    }

    this.skippedCategories.clear();
  }
}

// When this global variable was declared using let and two consecutive hashchange
// events were fired (due to bubbling? not sure...) the second call handled below
// would not see the value change from first call, and that would cause multiple
// SponsorBlockHandler initializations... This has been noticed on Chromium 38.
// This either reveals some bug in chromium/webpack/babel scope handling, or
// shows my lack of understanding of javascript. (or both)
window.sponsorblock = null;

window.addEventListener(
  'hashchange',
  () => {
    try {
      const newURL = new URL(location.hash.substring(1), location.href);
      // A hack, but it works, so...
      const videoID = newURL.search.replace('?v=', '').split('&')[0];
      const needsReload =
        videoID &&
        (!window.sponsorblock || window.sponsorblock.videoID != videoID);

      console.info('hashchange', videoID, window.sponsorblock, window.sponsorblock ? window.sponsorblock.videoID : null, needsReload);

      if (needsReload) {
        if (window.sponsorblock) {
          try {
            window.sponsorblock.destroy();
          } catch (err) {
            console.warn('window.sponsorblock.destroy() failed!', err);
          }
          window.sponsorblock = null;
        }

        if (configRead('enableSponsorBlock')) {
          window.sponsorblock = new SponsorBlockHandler(videoID);
          window.sponsorblock.init();
        } else {
          console.info('SponsorBlock disabled, not loading');
        }
      }
    } catch (err) {
      console.warn('[SponsorBlock] hashchange handler error:', err);
    }
  },
  false
);