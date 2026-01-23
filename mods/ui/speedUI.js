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
			this.threshold = 0.08; // seconds - more aggressive
			this.margin = 0.02; // seconds to avoid overshoot - smaller margin
			this.intervalMs = 150; // faster checks
			this._tickCount = 0;
			this._qualitySampleModulo = 3; // sample droppedFrames every N ticks
			this.maxAdjustmentPerTick = 0.5; // max seconds to jump forward per correction
			this.criticalDriftThreshold = 0.2; // seconds - trigger micro pause/resume
			this.lastMicroPauseWall = 0;
			this.microPauseCooldown = 2; // seconds between micro pauses
			this.cpuStressThreshold = 5; // dropped frames per check to consider CPU stress
			this.smoothCorrectionQueue = [];
			this.lastFrameDropCount = 0;
			this.cpuStressNotified = false;
		}

		attach(videoEl) {
			if (this.videoEl === videoEl) return;
			this.detach();
			this.videoEl = videoEl;

			const onPlaying = () => {
				this.resetBaseline();
				this.start();
			};
			const onPause = () => {
				this.forceSync(); // Immediate sync on pause to fix runaway video
				this.stop();
			};
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

		forceSync() {
			// Force immediate sync check and correction on pause/seek events
			if (!this.videoEl) return;
			const now = performance.now();
			const wallDelta = (now - this.lastBaselineWall) / 1000;
			const expected = this.lastBaselineMedia + wallDelta * this.lastRate;
			const diff = expected - this.videoEl.currentTime;

			// More aggressive immediate correction
			if (Math.abs(diff) > 0.05) {
				this.videoEl.currentTime = expected;
				this.resetBaseline();
			}
		}

		performMicroPauseResume(driftAmount) {
			if (!this.videoEl || this.videoEl.paused) return;

			// Ultra-short, visually imperceptible correction
			this.lastMicroPauseWall = performance.now();

			// Store current state
			const wasPlaying = !this.videoEl.paused;
			const targetTime = this.videoEl.currentTime + driftAmount * 0.7; // Jump forward by 70% of drift

			if (wasPlaying) {
				// Ultra-micro pause - almost imperceptible
				this.videoEl.pause();

				// Set corrected time and resume after minimal delay
				setTimeout(() => {
					if (this.videoEl) {
						this.videoEl.currentTime = targetTime;
						this.resetBaseline();

						// Resume playback immediately
						setTimeout(() => {
							if (this.videoEl && wasPlaying) {
								this.videoEl.play().catch(() => {});
							}
						}, 15); // Ultra-short 15ms resume delay
					}
				}, 20); // Ultra-short 20ms pause duration
			}
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
			// Faster checks for high speeds and 60fps content
			const delay = rate >= 1.5 ? this.intervalMs : Math.min(this.intervalMs * 2, 400);
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
			let cpuStressDetected = false;
			this._tickCount = (this._tickCount + 1) % 1024;
			if (this._tickCount % this._qualitySampleModulo === 0) {
				const quality = v.getVideoPlaybackQuality?.();
				const droppedFrames = quality?.droppedFrames ?? null;
				droppedDelta = (droppedFrames != null && this.lastDroppedFrames != null) ? (droppedFrames - this.lastDroppedFrames) : 0;
				this.lastDroppedFrames = droppedFrames;

				// CPU stress detection
				cpuStressDetected = droppedDelta >= this.cpuStressThreshold;
				if (cpuStressDetected && rate >= 1.25 && !this.cpuStressNotified) {
					this.handleCpuStress(rate);
				}
			}

			const rate = v.playbackRate || this.lastRate;
			const shouldConsider = rate >= 1.25 || droppedDelta > 0; // Lower threshold for activation

			// More frequent adjustments for persistent drift
			const sinceAdjust = (now - this.lastAdjustmentWall) / 1000;
			const adjustmentCooldown = rate >= 1.5 ? 0.25 : 0.4; // Shorter cooldown for high speeds

			if (shouldConsider && diff > this.threshold && sinceAdjust > adjustmentCooldown) {
				// Use smooth corrections instead of hard jumps for better UX
				const correctionAmount = Math.min(diff * 0.6, this.maxAdjustmentPerTick); // 60% of drift, more conservative

				if (correctionAmount > 0.01) {
					// Queue smooth correction instead of immediate jump
					this.queueSmoothCorrection(correctionAmount);
					this.lastAdjustmentWall = now;
				}
			}

			// Process smooth correction queue
			this.processSmoothCorrections();
			// Check for critical drift that requires micro pause/resume
			if (diff > this.criticalDriftThreshold) {
				const sinceMicroPause = (now - this.lastMicroPauseWall) / 1000;
				if (sinceMicroPause > this.microPauseCooldown) {
					this.performMicroPauseResume(diff);
				}
			}
		}

		handleCpuStress(currentRate) {
			// CPU stress handling
			this.cpuStressNotified = true;
			console.warn(`TizenTube Sync: CPU stress detected at ${currentRate}x speed (${this.lastDroppedFrames || 'N/A'} dropped frames)`);

			try {
				// More aggressive sync corrections during CPU stress - no quality reduction
				this.threshold = 0.05; // Even more aggressive sync threshold
				this.intervalMs = 100; // Faster monitoring during stress
				this.microPauseCooldown = 1.5; // Shorter cooldown for micro-pauses
				this.criticalDriftThreshold = 0.15; // Lower threshold for critical drift

				console.info('TizenTube Sync: Activated aggressive sync mode due to CPU stress');

				// Reset parameters after some time
				setTimeout(() => {
					this.cpuStressNotified = false;
					this.threshold = 0.08; // Reset to normal
					this.intervalMs = 150; // Reset to normal
					this.microPauseCooldown = 2; // Reset to normal
					this.criticalDriftThreshold = 0.2; // Reset to normal
					console.info('TizenTube Sync: Returned to normal sync mode');
				}, 15000); // 15 seconds

			} catch (e) {
				console.warn('TizenTube Sync: Could not adjust sync parameters during CPU stress:', e);
			}
		}

		queueSmoothCorrection(amount) {
			// Split correction into smaller chunks for smoother experience
			const chunkSize = 0.03; // 30ms chunks
			const chunks = Math.ceil(amount / chunkSize);

			for (let i = 0; i < chunks; i++) {
				const chunkAmount = Math.min(chunkSize, amount - (i * chunkSize));
				this.smoothCorrectionQueue.push({
					amount: chunkAmount,
					scheduledTime: performance.now() + (i * 100) // 100ms between chunks
				});
			}
		}

		processSmoothCorrections() {
			if (!this.videoEl || !this.smoothCorrectionQueue.length) return;

			const now = performance.now();
			const ready = this.smoothCorrectionQueue.filter(c => c.scheduledTime <= now);

			for (const correction of ready) {
				this.videoEl.currentTime += correction.amount;
				const index = this.smoothCorrectionQueue.indexOf(correction);
				this.smoothCorrectionQueue.splice(index, 1);
			}

			if (ready.length > 0) {
				this.resetBaseline();
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