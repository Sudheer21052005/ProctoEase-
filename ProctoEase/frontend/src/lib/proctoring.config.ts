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
 * Master switch for head-orientation events (`gaze_away`, `head_turned`).
 * Face counting is unaffected — set this to `false` to keep presence
 * detection while suppressing all orientation events.
 *
 * NAMING HONESTY: `gaze_away` is a HEAD-PITCH estimate derived from facial
 * landmarks (1 nose tip, 10 forehead, 152 chin, 33/263 outer eye corners).
 * It is NOT eye tracking — MediaPipe's iris landmarks (468-477) are never
 * requested. The public violation type keeps its historical name because it
 * is mirrored in the backend catalog.
 */
export const ENABLE_GAZE = true

/**
 * `head_turned` (yaw). Ships ON: the yaw metric is validated against a real
 * Chrome session (resting |yawRatio| <= 0.131, weakest deliberate turn
 * 0.322 — a clean gap; see HEAD_YAW_RATIO_THRESHOLD).
 *
 * Gates violation EMISSION only — measurement and [ML DEBUG] logging always
 * run so the detector stays observable while disabled.
 */
export const ENABLE_GAZE_YAW = true

/**
 * `gaze_away` (head pitch). Ships OFF: the previous pitch metric could not
 * separate deliberate look-aways from normal posture drift (measured resting
 * drift max 0.113 vs genuine signal max 0.102 — overlapping classes) and
 * produced 7 false positives in an otherwise clean exam.
 *
 * Gates violation EMISSION only — measurement, calibration and [ML DEBUG]
 * logging always run, so a Chrome session under this flag still collects the
 * resting/action fhDev distributions needed to set
 * GAZE_FH_DEVIATION_THRESHOLD. If the data separates cleanly, enabling the
 * detector is a threshold value plus this flag — no rework.
 */
export const ENABLE_GAZE_PITCH = false

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
 * Per-frame detector console logging. Currently `true` to collect data for
 * the Chrome calibration test; MUST be restored to `false` before any
 * commit: the face loop runs at 2 Hz and floods DevTools, making real
 * errors invisible during a demo.
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

// ─────────────────────────────────────────────────────────────────────────────
// Head orientation — yaw (head_turned) and head pitch (gaze_away)
//
// Both metrics are ratios of landmark distances, so they are scale-invariant
// and threshold units are dimensionless fractions. The legacy
// GAZE_YAW_THRESHOLD / GAZE_PITCH_THRESHOLD / GAZE_PITCH_NEUTRAL_RATIO /
// GAZE_PITCH_RATIO_THRESHOLD constants were removed: the first two were
// imported nowhere, and the last two encoded the guessed-neutral pitch
// design that was replaced by per-session calibration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * |yawRatio| above which the head counts as turned left/right.
 * MEASURED: a real Chrome session showed resting |yawRatio| <= 0.131 and
 * the weakest deliberate turn at 0.322; 0.25 sits inside that empty gap,
 * biased toward specificity — correct for proctoring, where a false
 * accusation costs more than a missed glance. (Raised from a provisional
 * 0.22 to add margin over the resting tail.)
 */
export const HEAD_YAW_RATIO_THRESHOLD = 0.25

/**
 * Relative deviation of the vertical-foreshortening ratio (faceHeight /
 * interocular) from the per-session calibrated baseline at which gaze_away
 * fires. Dimensionless fraction: 0.12 = a 12% projected-height change vs
 * baseline (a ~30 degree head pitch). PROVISIONAL — replace with a
 * Chrome-measured value using the threshold rule
 * (max(restingMax * 1.5, (restingMax + actionMin) / 2), strictly below
 * actionMin) before flipping ENABLE_GAZE_PITCH.
 */
export const GAZE_FH_DEVIATION_THRESHOLD = 0.12

/**
 * |yawRatio| at or above which the pitch decision is suppressed. The
 * foreshortening ratio is confounded by yaw, so head pitch is only
 * evaluated while the head is roughly frontal. Ratio units; provisional.
 */
export const GAZE_PITCH_MAX_YAW = 0.15

/**
 * Calibration window for the per-session pitch baseline, in ms. At the
 * 500 ms face cadence this collects ~10 samples. Mirrors AUDIO_CALIBRATION_MS.
 */
export const GAZE_CALIBRATION_MS = 5_000

/**
 * Minimum finite samples required before the baseline is accepted. Until
 * this many are collected, pitch detection is DISARMED (gazeAway stays
 * false) — exactly like the audio calibration window.
 */
export const GAZE_CALIBRATION_MIN_SAMPLES = 8

/**
 * Median-of-N smoothing window applied to yawRatio and fhDeviation before
 * thresholding, in frames. 3 kills isolated single-frame spikes at their
 * source (mirrors FACE_COUNT_SMOOTHING_WINDOW).
 */
export const GAZE_RATIO_SMOOTHING_WINDOW = 3

/**
 * Consecutive above-threshold frames required to ARM a grace timer, in
 * frames. A single above-threshold frame cannot start the sustain window.
 */
export const GAZE_ARM_FRAMES = 2

/**
 * Sustained-above time required before gaze_away fires, in ms. Longer than
 * the yaw grace: pitch is the noisier signal and warrants more evidence.
 */
export const GAZE_PITCH_GRACE_MS = 4_000

/**
 * Consecutive below-threshold frames tolerated before the pitch grace timer
 * clears, in frames. Stricter than the yaw tolerance.
 */
export const GAZE_PITCH_TOLERANCE_FRAMES = 1

/**
 * Consecutive below-threshold frames tolerated before the yaw grace timer
 * clears, in frames.
 */
export const GAZE_JITTER_TOLERANCE_FRAMES = 2

/** Minimum COCO-SSD score for an object to be reported. Lowered from 0.6 to 0.45 to improve recall. */
export const OBJECT_CONFIDENCE_THRESHOLD = 0.45

/** Number of consecutive positive object ticks required before emitting an event. */
export const OBJECT_CONSECUTIVE_TICKS = 2

/** COCO-SSD object inference cadence (reduced from 10s to 2.5s for faster response). */
export const ML_OBJECT_SCAN_MS = 2500

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

/** COCO-SSD labels treated as a phone. "remote" is included because COCO-SSD often labels a hand-held phone as "remote". */
export const PHONE_CLASSES = ["cell phone", "remote"] as const
/** COCO-SSD labels treated as unauthorized material. Trimmed to items that are clearly unauthorized in an exam setting. */
export const UNAUTHORIZED_CLASSES = [
  "book",
  "laptop",
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
