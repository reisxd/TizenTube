// TizenTube Cobalt v2.1.0 - SponsorBlock Full-Ad Rozet Modülü
(function () {
  'use strict';

  const SPONSORBLOCK_API = 'https://sponsor.ajay.app/api/skipSegments';
  const BADGE_ID = 'cobalt-fullad-badge';
  const FULL_AD_THRESHOLD = 0.88;

  let lastVideoId = '';
  let activeAbortController = null;
  let domObserver = null;

  function init() {
    window.addEventListener('yt-navigate-finish', handleVideoChange);

    const originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      handleVideoChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      handleVideoChange();
    };

    window.addEventListener('popstate', handleVideoChange);
    handleVideoChange();
  }

  function handleVideoChange() {
    const videoId = getVideoId();
    if (!videoId || videoId === lastVideoId) return;

    lastVideoId = videoId;
    cleanup();
    checkVideo(videoId);
  }

  function getVideoId() {
    const match = window.location.href.match(/(?:v=|\/watch\?v=)([^&?#/]+)/);
    return match ? match[1] : null;
  }

  function cleanup() {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    removeBadge();
  }

  function checkVideo(videoId) {
    activeAbortController = new AbortController();
    const { signal } = activeAbortController;

    const categories = encodeURIComponent(JSON.stringify(["sponsor", "selfpromo", "full"]));
    const url = `${SPONSORBLOCK_API}?videoID=${videoId}&categories=${categories}`;

    fetch(url, { signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((segments) => {
        if (!Array.isArray(segments) || segments.length === 0) return;

        const videoEl = document.querySelector('video');

        if (videoEl && (isNaN(videoEl.duration) || videoEl.duration === 0)) {
          videoEl.addEventListener('loadedmetadata', function onMetadata() {
            videoEl.removeEventListener('loadedmetadata', onMetadata);
            evaluateSegments(segments, videoEl.duration);
          }, { once: true });
        } else {
          const duration = videoEl ? videoEl.duration : 0;
          evaluateSegments(segments, duration);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {}
      });
  }

  function evaluateSegments(segments, duration) {
    const isFullAd = segments.some((seg) => {
      const [start, end] = seg.segment;
      if (seg.category === 'full') return true;
      return duration > 0 && (end - start) / duration >= FULL_AD_THRESHOLD;
    });

    if (isFullAd) {
      observeAndInjectBadge();
    }
  }

  function observeAndInjectBadge() {
    if (document.getElementById(BADGE_ID)) return;

    const container = getTitleContainer();
    if (container) {
      injectCobaltBadge(container);
      return;
    }

    domObserver = new MutationObserver((_, observer) => {
      const targetContainer = getTitleContainer();
      if (targetContainer) {
        injectCobaltBadge(targetContainer);
        observer.disconnect();
        domObserver = null;
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function getTitleContainer() {
    return (
      document.querySelector('.player-metadata-title') ||
      document.querySelector('.ytlr-tile-title') ||
      document.querySelector('.html5-video-title')
    );
  }

  function injectCobaltBadge(container) {
    if (document.getElementById(BADGE_ID)) return;

    const badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.style.backgroundColor = '#cc0000';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = 'bold';
    badge.style.padding = '2px 6px';
    badge.style.marginLeft = '10px';
    badge.style.borderRadius = '3px';
    badge.style.display = 'inline-block';
    badge.style.verticalAlign = 'middle';
    badge.innerText = '📢 TAMAMI SPONSORLU';

    container.appendChild(badge);
  }

  function removeBadge() {
    const el = document.getElementById(BADGE_ID);
    if (el) el.remove();
  }

  init();
})();
