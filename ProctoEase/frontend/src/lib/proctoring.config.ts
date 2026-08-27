/**
 * Centralised proctoring configuration.
 *
 * Every tunable number used by the proctoring pipeline lives here so that
 * tuning the demo is a one-file change. Nothing in this file changes
 * behaviour: the values are the ones that were previously hard-coded in
 * `hooks/useProctoring.ts`, `lib/ml-detection.ts` and `lib/constants.ts`.
 *
 * Rules for this file:
 *  - Values only. No imports from stores/hooks, so it stays safe to import
 *    from anywhere (including plain unit tests with no DOM).
 *  - The canonical violation *types* live in `lib/proctoring.catalog.ts`
 *    (mirrored from `app/config/violation_guidelines.py`). Do not redeclare
 *    them here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Detector feature flags
//
// Turning a flag off disables that detector's timer entirely — no inference,
// no events. Used to isolate a misbehaving detector during a demo without
// deleting code.
// ─────────────────────────────────────────────────────────────────────────────

/** MediaPipe face landmarker path: no_face / multiple_faces / gaze / head pose. */
export const ENABLE_FACE_ML = true

/**
 * Gaze + head-pose events (`gaze_away`, `head_turned`).
 * Face counting is unaffected — set this to `false` to keep presence
 * detection while suppressing the noisier orientation events.
 */
export const ENABLE_GAZE = true

/** COCO-SSD object path: phone_detected / unauthorized_object. */
export const ENABLE_OBJECT_DETECTION = true

/** Web Audio microphone level path: audio_anomaly. */
export const ENABLE_AUDIO_DETECTION = true

/**
 * Legacy browser Shape-Detection `FaceDetector` path. Only used when the
 * MediaPipe models fail to load — see the mutual-exclusion note in
 * useProctoring's fallback effect.
 */
export const ENABLE_FACE_DETECTOR_FALLBACK = true

/**
 * Per-frame detector console logging. Off by default: the face loop runs at
 * 2 Hz, so leaving it on floods DevTools and makes real errors invisible
 * during a demo. Flip to `true` when debugging detection.
 */
export const PROCTORING_DEBUG_LOGS = false

/**
 * Audio VAD diagnostic instrumentation. MUST ship as `false`.
 *
 * Prints one numeric line per audio frame (8 Hz) plus microphone start/stop,
 * calibration, state-transition, segment and anomaly lines. Kept separate from
 * PROCTORING_DEBUG_LOGS so the audio signal can be inspected without the face
 * loop's output on top of it.
 *
 * Retained (not deleted) after calibration because the adaptive detector's
 * behaviour depends on the room and the microphone: re-tuning on new hardware
 * means reading the noise floor and the adaptive thresholds it derives.
 *
 * PRIVACY: only derived numbers and browser-reported device metadata are
 * logged — RMS level, noise floor, adaptive thresholds, activity state,
 * durations, frame counts, ratios and timings. No audio is recorded, buffered
 * beyond the live analyser window, transmitted, or printed. There is no path
 * from this flag to audio content.
 */
export const ENABLE_AUDIO_DEBUG = false

// ─────────────────────────────────────────────────────────────────────────────
// Violation gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Violations tolerated before the attempt is auto-submitted.
 *
 * Counts only gating violations: the backend WS ack reports `violation_count`
 * excluding NON_GATING_VIOLATIONS (currently `periodic_check`).
 */
export const MAX_VIOLATIONS = 12

// ─────────────────────────────────────────────────────────────────────────────
// Scan intervals
// ─────────────────────────────────────────────────────────────────────────────

/** MediaPipe face + gaze inference cadence. */
export const ML_FACE_SCAN_MS = 500
/** COCO-SSD object inference cadence (much heavier than the face model). */
export const ML_OBJECT_SCAN_MS = 10_000
/** Browser `FaceDetector` fallback cadence. */
export const FACE_SCAN_MS = 2_000
/**
 * Microphone frame cadence (RMS is measured once per frame).
 *
 * Must be <= the analyser's window length so consecutive reads overlap and no
 * audio falls between frames — see AUDIO_FFT_SIZE.
 */
export const AUDIO_FRAME_MS = 125
/** Devtools window-geometry poll. */
export const DEVTOOLS_CHECK_MS = 2_000
/** Benign `periodic_check` snapshot cadence (non-gating). */
export const PERIODIC_SNAPSHOT_MS = 75_000
/** WebSocket keepalive. */
export const HEARTBEAT_MS = 30_000
/** Idle time before an `inactivity` event. */
export const INACTIVITY_MS = 90_000

// ─────────────────────────────────────────────────────────────────────────────
// Persistence windows — how long a condition must hold before it counts
// ─────────────────────────────────────────────────────────────────────────────

export const NO_FACE_PERSIST_MS = 2_000
export const MULTI_FACE_PERSIST_MS = 1_500
/** Sustained gaze/head deviation required before an event fires. */
export const GAZE_GRACE_MS = 3_000
/**
 * Voiced time one segment must reach before `audio_anomaly` fires. Pauses up to
 * AUDIO_PAUSE_TOLERANCE_MS do not reset it, so this is 3 s of actual voice
 * activity rather than 3 s of wall clock.
 */
export const AUDIO_SUSTAINED_MS = 3_000

// ─────────────────────────────────────────────────────────────────────────────
// Cooldowns and snapshot throttles — how often a type may re-fire
// ─────────────────────────────────────────────────────────────────────────────

export const FACE_VIOLATION_COOLDOWN_MS = 4_000
export const AUDIO_COOLDOWN_MS = 20_000
export const DEVTOOLS_COOLDOWN_MS = 15_000
/** Snapshot throttle for DOM-driven events (tab switch, fullscreen exit). */
export const SNAPSHOT_THROTTLE_MS = 7_000
/** Snapshot throttle for ML face/gaze events. */
export const ML_SNAP_THROTTLE_MS = 8_000
/** Snapshot throttle for object events (deliberately slower than face). */
export const OBJECT_SNAP_THROTTLE_MS = ML_SNAP_THROTTLE_MS * 2
/** `visibilitychange` and `blur` both fire on a tab switch — dedupe window. */
export const TAB_SWITCH_DEDUPE_MS = 500

// ─────────────────────────────────────────────────────────────────────────────
// Derived-pattern detection (client-side aggregation of base events)
// ─────────────────────────────────────────────────────────────────────────────

export const RAPID_TAB_WINDOW_MS = 10_000
export const RAPID_TAB_THRESHOLD = 3
export const RAPID_TAB_COOLDOWN_MS = 10_000

export const BURST_WINDOW_MS = 30_000
export const BURST_THRESHOLD = 5
export const BURST_COOLDOWN_MS = 15_000

/** Pasted characters above which `bulk_paste_detected` is raised. */
export const BULK_PASTE_THRESHOLD = 50

// ─────────────────────────────────────────────────────────────────────────────
// Confidence / decision thresholds
// ─────────────────────────────────────────────────────────────────────────────

/** outerWidth-innerWidth delta treated as "devtools docked". */
export const DEVTOOLS_THRESHOLD = 160

/**
 * Majority-vote window over the last N face counts. Smooths single-frame
 * dropouts so a blink or motion blur does not fire `no_face`.
 */
export const FACE_COUNT_SMOOTHING_WINDOW = 3

/** Normalised head yaw beyond which the head counts as turned left/right. */
export const GAZE_YAW_THRESHOLD = 0.25
/** Normalised head pitch beyond which gaze counts as up/down. */
export const GAZE_PITCH_THRESHOLD = 0.22

/** Minimum COCO-SSD score for an object to be reported. */
export const OBJECT_CONFIDENCE_THRESHOLD = 0.6

// ─────────────────────────────────────────────────────────────────────────────
// Voice / audio activity detection (adaptive energy VAD)
//
// Every parameter of the `audio_anomaly` detector lives in this block, except
// AUDIO_FRAME_MS (scan intervals), AUDIO_SUSTAINED_MS (persistence windows),
// AUDIO_COOLDOWN_MS (cooldowns) and AUDIO_FFT_SIZE (analyser), which stay in
// their topic sections above/below.
//
// The detector measures ENERGY relative to a measured room noise floor. It is
// not speech recognition — see the header of `lib/audio-detection.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quiet period at exam start used to measure the room's noise floor. Detection
 * is disarmed for this long, so it must be short enough not to leave a
 * detection hole and long enough to average out one-off bumps.
 */
export const AUDIO_CALIBRATION_MS = 2_000

/**
 * Percentile of the collected quiet frames taken as the noise floor. 0.5 is the
 * median — a robust statistic, so a door slam during calibration shifts it by
 * one sample's worth instead of dragging a mean upwards.
 */
export const AUDIO_NOISE_PERCENTILE = 0.5

/**
 * Trailing span of quiet frames kept for ongoing noise-floor re-estimation, so
 * a fan switching on mid-exam raises the threshold instead of firing forever.
 * Only frames observed while NOT in a voice segment are admitted, so sustained
 * talking cannot inflate the floor and desensitise the detector.
 */
export const AUDIO_NOISE_WINDOW_MS = 30_000

/**
 * Lower clamp on the measured noise floor. A digitally-silent or muted input
 * measures ~0, which would make the multiplied thresholds collapse toward zero;
 * the absolute minimums below are the real guard, this keeps the ratios sane.
 */
export const AUDIO_MIN_NOISE_FLOOR = 0.0005

/**
 * Upper clamp on the measured noise floor. Prevents a genuinely loud room (or a
 * candidate talking through calibration) from pushing the thresholds so high
 * that nothing is ever detected.
 */
export const AUDIO_MAX_NOISE_FLOOR = 0.05

/**
 * Noise-floor multiple at which a frame counts as the START of voice activity.
 * 5.0 = +14 dB (20·log10(5) = 13.98): conversational speech in a quiet room
 * sits roughly 15 dB or more above the noise floor, so this is the low edge of
 * the speech band rather than an arbitrary number.
 */
export const AUDIO_ENTER_MULTIPLIER = 5.0

/**
 * Noise-floor multiple below which activity counts as STOPPED. 2.5 = +8 dB.
 * Deliberately lower than AUDIO_ENTER_MULTIPLIER — the resulting hysteresis
 * band stops a level hovering near one threshold from chattering between
 * states and fragmenting a single utterance into many tiny segments.
 */
export const AUDIO_EXIT_MULTIPLIER = 2.5

/**
 * Absolute floor under the adaptive ENTER threshold, whichever is larger wins.
 *
 * Calibrated from the captured Bluetooth-headset session: quiet-to-normal
 * speech measured 0.040–0.079 RMS, while non-speech excursions during silence
 * peaked at 0.033. 0.020 therefore sits below the observed speech band and
 * above the observed room-noise band, and prevents an unusually quiet room from
 * producing an unsafely sensitive threshold.
 */
export const AUDIO_MIN_ENTER_RMS = 0.020

/** Absolute floor under the adaptive EXIT threshold. Keeps the hysteresis band. */
export const AUDIO_MIN_EXIT_RMS = 0.012

/**
 * Length of the UNBROKEN run of above-exit audio a segment must contain before
 * it is treated as voice activity at all.
 *
 * Rejects taps, clicks, single coughs and door slams (typically 150–300 ms)
 * without needing a spectral model. Because it is a contiguous run and not a
 * total, it also rejects impulse trains: keyboard typing accumulates plenty of
 * energy but each click is one frame, so it never promotes. A voiced syllable
 * or word clears 400 ms easily.
 */
export const AUDIO_MIN_ACTIVITY_MS = 400

/**
 * Quiet run tolerated inside one voice segment before the segment is closed.
 *
 * Sized from the captured session: Chrome's noise suppression plus the headset's
 * own gate drop the level to the noise floor for up to four consecutive 250 ms
 * samples (~1 s) BETWEEN WORDS of continuous speech. A shorter tolerance splits
 * one sentence into several sub-threshold segments — which is exactly why the
 * previous duty-cycle detector stalled below its ratio.
 */
export const AUDIO_PAUSE_TOLERANCE_MS = 1_200

// ─────────────────────────────────────────────────────────────────────────────
// Model configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MediaPipe FaceLandmarker weights, vendored into `public/` so the exam does
 * not depend on storage.googleapis.com at start time. ~3.6 MB.
 * `BASE_URL` keeps this correct if the app is ever served from a sub-path.
 */
export const FACE_LANDMARKER_MODEL_URL = `${import.meta.env.BASE_URL}models/mediapipe/face_landmarker.task`

export const FACE_LANDMARKER_MAX_FACES = 4
export const FACE_LANDMARKER_MIN_DETECTION_CONFIDENCE = 0.5
export const FACE_LANDMARKER_MIN_PRESENCE_CONFIDENCE = 0.5
export const FACE_LANDMARKER_MIN_TRACKING_CONFIDENCE = 0.5
/** GPU delegate; MediaPipe falls back to CPU internally if WebGL is absent. */
export const FACE_LANDMARKER_DELEGATE = "GPU" as const

/**
 * COCO-SSD variant. NOT vendored: `lite_mobilenet_v2` weights are ~18 MB
 * across 5 shards, which would bloat the repository. The version is pinned
 * via package.json and a load failure degrades gracefully (object detection
 * off, face detection unaffected).
 */
export const COCO_SSD_BASE = "lite_mobilenet_v2" as const

/** COCO-SSD labels treated as a phone. */
export const PHONE_CLASSES = ["cell phone", "remote"] as const
/** COCO-SSD labels treated as unauthorized material. */
export const UNAUTHORIZED_CLASSES = [
  "book",
  "laptop",
  "keyboard",
  "mouse",
  "remote",
  "tv",
  "monitor",
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Webcam capture
// ─────────────────────────────────────────────────────────────────────────────

/** The on-screen monitor feed is reused for inference when it is mounted. */
export const LIVE_WEBCAM_SELECTOR = 'video[data-proctoring-webcam="true"]'
/** Resolution requested only when no on-screen feed exists. */
export const CAPTURE_WIDTH = 320
export const CAPTURE_HEIGHT = 240
/** Snapshot JPEG quality — snapshots are stored per violation, so keep small. */
export const SNAPSHOT_JPEG_QUALITY = 0.7

// ─────────────────────────────────────────────────────────────────────────────
// Audio analyser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AnalyserNode FFT size; the time-domain read returns this many samples, i.e.
 * `fftSize / sampleRate` seconds of audio per frame.
 *
 * 8192 at 48 kHz = 170.7 ms, which is longer than AUDIO_FRAME_MS (125 ms), so
 * consecutive frames overlap and no audio is missed. The previous 2048 gave
 * 42.7 ms per read at a 250 ms cadence — only ~17% of the exam's audio was ever
 * measured, and a syllable landing in the other 83% was invisible.
 */
export const AUDIO_FFT_SIZE = 8192
/**
 * Analyser smoothing. Inert for the time-domain reads this detector uses (it
 * only affects frequency-domain data); set to 0 so it stays inert if a future
 * change reads a spectrum.
 */
export const AUDIO_SMOOTHING_TIME_CONSTANT = 0
