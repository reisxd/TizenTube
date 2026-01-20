import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';

const interval = setInterval(() => {
	const videoElement = document.querySelector('video');
	if (videoElement) {
		execute_once_dom_loaded_speed();
		clearInterval(interval);
	}
}, 1000);

function execute_once_dom_loaded_speed() {
	let currentRate = configRead('videoSpeed') || 1;

	const applyPlaybackRate = (el, rate = currentRate) => {
		if (!el) return;
		el.defaultPlaybackRate = rate;
		el.playbackRate = rate;
	};

	const applyPlaybackRateToAll = (rate = currentRate) => {
		const mediaEls = document.querySelectorAll('video, audio');
		for (const el of mediaEls) applyPlaybackRate(el, rate);
	};

	const canplayHandler = () => {
		currentRate = configRead('videoSpeed') || 1;
		applyPlaybackRateToAll(currentRate);
	};

	const firstVideo = document.querySelector('video');
	if (firstVideo) {
		firstVideo.addEventListener('canplay', canplayHandler);
	}

	// Observe for newly added media elements and apply current speed (throttled)
	const pendingNodes = [];
	let observerScheduled = false;
	const processPending = () => {
		observerScheduled = false;
		if (!pendingNodes.length) return;
		// Collect unique media elements from pending nodes
		const toProcess = new Set();
		while (pendingNodes.length) {
			const node = pendingNodes.shift();
			if (!(node instanceof HTMLElement)) continue;
			if (node.matches && (node.matches('video') || node.matches('audio'))) {
				toProcess.add(node);
			}
			const descendants = node.querySelectorAll ? node.querySelectorAll('video, audio') : [];
			for (const el of descendants) toProcess.add(el);
		}
		for (const el of toProcess) applyPlaybackRate(el);
	};
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			for (const node of m.addedNodes) pendingNodes.push(node);
		}
		if (!observerScheduled) {
			observerScheduled = true;
			setTimeout(processPending, 100);
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });

	const eventHandler = (evt) => {
		if (evt.keyCode == 406 || evt.keyCode == 191) {
			evt.preventDefault();
			evt.stopPropagation();
			if (evt.type === 'keydown') {
				speedSettings();
				return false;
			}
			return true;
		};
	}

	// Red, Green, Yellow, Blue
	// 403, 404, 405, 406
	// ---, 172, 170, 191
	document.addEventListener('keydown', eventHandler, true);

	// Lightweight A/V sync controller to reduce drift at high speeds (e.g., 60fps @ 1.75x)
	class PlaybackSyncController {
		constructor() {
			this.videoEl = null;
			this.timerId = null;
			this._running = false;
			this.lastBaselineWall = 0;
			this.lastBaselineMedia = 0;
			this.lastRate = 1;
			this.lastDroppedFrames = null;
			this.lastAdjustmentWall = 0;
			this.threshold = 0.15; // seconds
			this.margin = 0.05; // seconds to avoid overshoot
			this.intervalMs = 250;
			this._tickCount = 0;
			this._qualitySampleModulo = 4; // sample droppedFrames every N ticks
		}

		attach(videoEl) {
			if (this.videoEl === videoEl) return;
			this.detach();
			this.videoEl = videoEl;

			const onPlaying = () => {
				this.resetBaseline();
				this.start();
			};
			const onPause = () => this.stop();
			const onRateChange = () => this.resetBaseline();
			const onSeeked = () => this.resetBaseline();
			const onCanPlay = () => this.resetBaseline();

			this._onPlaying = onPlaying;
			this._onPause = onPause;
			this._onRateChange = onRateChange;
			this._onSeeked = onSeeked;
			this._onCanPlay = onCanPlay;

			videoEl.addEventListener('playing', onPlaying);
			videoEl.addEventListener('pause', onPause);
			videoEl.addEventListener('ratechange', onRateChange);
			videoEl.addEventListener('seeked', onSeeked);
			videoEl.addEventListener('canplay', onCanPlay);

			// If already playing, start immediately
			if (!videoEl.paused && !videoEl.ended) {
				onPlaying();
			}
		}

		detach() {
			if (this.videoEl) {
				this.videoEl.removeEventListener('playing', this._onPlaying);
				this.videoEl.removeEventListener('pause', this._onPause);
				this.videoEl.removeEventListener('ratechange', this._onRateChange);
				this.videoEl.removeEventListener('seeked', this._onSeeked);
				this.videoEl.removeEventListener('canplay', this._onCanPlay);
			}
			this.stop();
			this.videoEl = null;
			this._onPlaying = null;
			this._onPause = null;
			this._onRateChange = null;
			this._onSeeked = null;
			this._onCanPlay = null;
		}

		resetBaseline() {
			if (!this.videoEl) return;
			this.lastBaselineWall = performance.now();
			this.lastBaselineMedia = this.videoEl.currentTime;
			this.lastRate = this.videoEl.playbackRate || 1;
			const quality = this.videoEl.getVideoPlaybackQuality?.();
			this.lastDroppedFrames = quality?.droppedFrames ?? null;
		}

		start() {
			if (this._running) return;
			this._running = true;
			this._schedule();
		}

		stop() {
			if (!this.timerId) return;
			clearTimeout(this.timerId);
			this.timerId = null;
			this._running = false;
		}

		_schedule() {
			if (!this._running) return;
			const v = this.videoEl;
			const rate = v ? (v.playbackRate || this.lastRate || 1) : 1;
			const delay = rate >= 1.5 ? 250 : 500; // slower cadence for lower rates
			this.timerId = setTimeout(() => {
				this._tick();
				this._schedule();
			}, delay);
		}

		_tick() {
			const v = this.videoEl;
			if (!v || v.paused || v.ended) return;

			const now = performance.now();
			const wallDelta = (now - this.lastBaselineWall) / 1000;
			const expected = this.lastBaselineMedia + wallDelta * this.lastRate;
			const diff = expected - v.currentTime; // positive if video is lagging behind expected timeline
			// Sample dropped frames less frequently to reduce overhead
			let droppedDelta = 0;
			this._tickCount = (this._tickCount + 1) % 1024;
			if (this._tickCount % this._qualitySampleModulo === 0) {
				const quality = v.getVideoPlaybackQuality?.();
				const droppedFrames = quality?.droppedFrames ?? null;
				droppedDelta = (droppedFrames != null && this.lastDroppedFrames != null) ? (droppedFrames - this.lastDroppedFrames) : 0;
				this.lastDroppedFrames = droppedFrames;
			}

			const rate = v.playbackRate || this.lastRate;
			const shouldConsider = rate >= 1.5 || droppedDelta > 0;

			// Limit adjustments frequency
			const sinceAdjust = (now - this.lastAdjustmentWall) / 1000;

			if (shouldConsider && diff > this.threshold && sinceAdjust > 0.5) {
				// Nudge video forward towards expected time with a small margin
				const target = expected - this.margin;
				// Avoid going backwards
				if (target > v.currentTime) {
					v.currentTime = target;
					this.lastAdjustmentWall = now;
					// After a jump, rebuild baseline to avoid over-correction
					this.resetBaseline();
				}
			}
		}
	}

	const setupSyncController = () => {
		const videoEl = document.querySelector('video');
		if (!videoEl) return;
		if (!window.__ttPlaybackSyncController) {
			window.__ttPlaybackSyncController = new PlaybackSyncController();
		}
		window.__ttPlaybackSyncController.attach(videoEl);
	};

	// Initialize sync controller
	setupSyncController();
}

function speedSettings() {
	const currentSpeed = configRead('videoSpeed');
	let selectedIndex = 0;
	const maxSpeed = 5;
	const increment = configRead('speedSettingsIncrement') || 0.25;
	const buttons = [];
	for (let speed = increment; speed <= maxSpeed; speed += increment) {
		const fixedSpeed = Math.round(speed * 100) / 100;
		buttons.push(
			buttonItem({ title: `${fixedSpeed}x` },
				null,
				[{
						signalAction: {
							signal: 'POPUP_BACK'
						}
					},
					{
						setClientSettingEndpoint: {
							settingDatas: [{
								clientSettingEnum: {
									item: 'videoSpeed'
								},
								intValue: fixedSpeed.toString()
							}]
						}
					},
					{
						customAction: {
							action: 'SET_PLAYER_SPEED',
							parameters: fixedSpeed.toString()
						}
					}
				]
			)
		);
		if (currentSpeed === fixedSpeed) {
			selectedIndex = buttons.length - 1;
		}
	}

	buttons.push(
		buttonItem({ title: `Fix stuttering (1.0001x)` },
			null,
			[{
					signalAction: {
						signal: 'POPUP_BACK'
					}
				},
				{
					setClientSettingEndpoint: {
						settingDatas: [{
							clientSettingEnum: {
								item: 'videoSpeed'
							},
							intValue: '1.0001'
						}]
					}
				},
				{
					customAction: {
						action: 'SET_PLAYER_SPEED',
						parameters: '1.0001'
					}
				}
			]
		)
	);

	showModal('Playback Speed', overlayPanelItemListRenderer(buttons, selectedIndex), 'tt-speed');
}

export {
	speedSettings
}