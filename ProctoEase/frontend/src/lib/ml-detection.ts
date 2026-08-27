/**
 * ProctoEase ML Detection Module
 * MediaPipe FaceLandmarker: face count + gaze + head pose
 * TensorFlow.js COCO-SSD: phone + object detection
 *
 * Asset strategy (Phase 2 hardening):
 *  - The MediaPipe WASM runtime is resolved from the pinned node_modules copy
 *    via Vite `?url` imports, so it is bundled and served by our own origin.
 *    This replaces `FilesetResolver.forVisionTasks(".../tasks-vision@latest/wasm")`,
 *    which fetched from a CDN at exam start and — because of `@latest` — could
 *    silently change version between runs.
 *  - The FaceLandmarker weights are vendored in `public/models/mediapipe/`.
 *  - COCO-SSD weights are still fetched by @tensorflow-models/coco-ssd from
 *    Google storage (~18 MB across 5 shards, too large to vendor). The package
 *    version is pinned, and a failure here is isolated: object detection turns
 *    itself off and face detection keeps working.
 *
 * Every tunable lives in `lib/proctoring.config.ts`.
 */

import { FaceLandmarker, type FaceLandmarkerResult } from "@mediapipe/tasks-vision"
import * as cocoSsd from "@tensorflow-models/coco-ssd"
import "@tensorflow/tfjs"

// Emitted as same-origin asset URLs by Vite. The SIMD build is used: WASM SIMD
// is enabled by default in every browser that can run this exam UI.
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url"
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url"

import {
  COCO_SSD_BASE,
  ENABLE_FACE_ML,
  ENABLE_OBJECT_DETECTION,
  FACE_LANDMARKER_DELEGATE,
  FACE_LANDMARKER_MAX_FACES,
  FACE_LANDMARKER_MIN_DETECTION_CONFIDENCE,
  FACE_LANDMARKER_MIN_PRESENCE_CONFIDENCE,
  FACE_LANDMARKER_MIN_TRACKING_CONFIDENCE,
  FACE_LANDMARKER_MODEL_URL,
  GAZE_PITCH_THRESHOLD,
  GAZE_YAW_THRESHOLD,
  OBJECT_CONFIDENCE_THRESHOLD,
  PHONE_CLASSES,
  UNAUTHORIZED_CLASSES,
} from "@/lib/proctoring.config"

export interface FaceDetectionResult {
  faceCount: number       // -1 = model not ready
  gazeAway: boolean       // looking up or down
  headTurned: boolean     // looking left or right
  confidence: number
}

export interface ObjectDetectionResult {
  phoneDetected: boolean
  unauthorizedObjectDetected: boolean
  detectedObjects: string[]
}

/** Which detectors actually came up. Reported so the UI can degrade honestly. */
export interface ModelLoadReport {
  face: boolean
  object: boolean
}

// Singleton model instances — loaded once, reused.
let faceLandmarker: FaceLandmarker | null = null
let objectDetector: cocoSsd.ObjectDetection | null = null
let faceModelReady = false
let objectModelReady = false
let modelLoadPromise: Promise<ModelLoadReport> | null = null

async function loadFaceModel(): Promise<boolean> {
  if (!ENABLE_FACE_ML) return false
  try {
    faceLandmarker = await FaceLandmarker.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: FACE_LANDMARKER_DELEGATE,
        },
        runningMode: "VIDEO",
        numFaces: FACE_LANDMARKER_MAX_FACES,
        minFaceDetectionConfidence: FACE_LANDMARKER_MIN_DETECTION_CONFIDENCE,
        minFacePresenceConfidence: FACE_LANDMARKER_MIN_PRESENCE_CONFIDENCE,
        minTrackingConfidence: FACE_LANDMARKER_MIN_TRACKING_CONFIDENCE,
      }
    )
    faceModelReady = true
    return true
  } catch (error) {
    faceLandmarker = null
    faceModelReady = false
    console.error("[ProctoEase ML] Face model failed to load:", error)
    return false
  }
}

async function loadObjectModel(): Promise<boolean> {
  if (!ENABLE_OBJECT_DETECTION) return false
  try {
    objectDetector = await cocoSsd.load({ base: COCO_SSD_BASE })
    objectModelReady = true
    return true
  } catch (error) {
    objectDetector = null
    objectModelReady = false
    console.error("[ProctoEase ML] Object model failed to load:", error)
    return false
  }
}

/**
 * Load both detectors. They are loaded independently and settled together, so
 * one failing (e.g. COCO-SSD weights unreachable) never disables the other.
 *
 * Idempotent: concurrent callers share one in-flight promise, and a partial
 * result is retried on the next call so a transient network failure can
 * recover mid-exam.
 */
export async function loadMLModels(): Promise<ModelLoadReport> {
  if (faceModelReady && objectModelReady) {
    return { face: true, object: true }
  }
  if (modelLoadPromise) return modelLoadPromise

  modelLoadPromise = (async () => {
    const [face, object] = await Promise.all([
      faceModelReady ? Promise.resolve(true) : loadFaceModel(),
      objectModelReady ? Promise.resolve(true) : loadObjectModel(),
    ])
    return { face, object }
  })()

  const report = await modelLoadPromise
  // Allow a retry unless everything that is enabled came up.
  const complete =
    (report.face || !ENABLE_FACE_ML) && (report.object || !ENABLE_OBJECT_DETECTION)
  if (!complete) {
    modelLoadPromise = null
  }
  return report
}

/** True when the MediaPipe face/gaze model is usable. */
export function isFaceModelReady(): boolean {
  return faceModelReady
}

/** True when the COCO-SSD object model is usable. */
export function isObjectModelReady(): boolean {
  return objectModelReady
}

/**
 * True when *any* ML detector is usable. Used for the "AI monitoring" badge;
 * detector loops must gate on the specific model they need.
 */
export function areModelsLoaded(): boolean {
  return faceModelReady || objectModelReady
}

export function detectFacesAndGaze(
  video: HTMLVideoElement
): FaceDetectionResult {
  if (!faceLandmarker || !faceModelReady) {
    return { faceCount: -1, gazeAway: false, headTurned: false, confidence: 0 }
  }

  try {
    const result: FaceLandmarkerResult = faceLandmarker.detectForVideo(
      video,
      performance.now()
    )

    const faceCount = result.faceLandmarks?.length ?? 0

    if (faceCount === 0) {
      return { faceCount: 0, gazeAway: false, headTurned: false, confidence: 1 }
    }

    // Analyze first face landmarks for gaze direction
    // MediaPipe provides 468 landmarks per face
    // Key points used:
    //   1  = nose tip
    //  33  = left eye outer corner
    // 263  = right eye outer corner
    // 152  = chin bottom
    //  10  = forehead center
    const lm = result.faceLandmarks[0]
    const noseTip  = lm[1]
    const leftEye  = lm[33]
    const rightEye = lm[263]
    const chin     = lm[152]
    const forehead = lm[10]

    if (!noseTip || !leftEye || !rightEye || !chin || !forehead) {
      return { faceCount, gazeAway: false, headTurned: false, confidence: 0.5 }
    }

    // Horizontal turn: compare nose x vs midpoint between eyes
    const eyeMidX    = (leftEye.x + rightEye.x) / 2
    const yawOffset  = Math.abs(noseTip.x - eyeMidX)
    const headTurned = yawOffset > GAZE_YAW_THRESHOLD

    // Vertical gaze: compare nose y vs midpoint between forehead and chin
    const faceMidY   = (forehead.y + chin.y) / 2
    const pitchOffset = Math.abs(noseTip.y - faceMidY)
    const gazeAway   = pitchOffset > GAZE_PITCH_THRESHOLD

    return { faceCount, gazeAway, headTurned, confidence: 0.9 }
  } catch {
    return { faceCount: -1, gazeAway: false, headTurned: false, confidence: 0 }
  }
}

export async function detectObjects(
  video: HTMLVideoElement
): Promise<ObjectDetectionResult> {
  if (!objectDetector || !objectModelReady) {
    return { phoneDetected: false, unauthorizedObjectDetected: false, detectedObjects: [] }
  }

  try {
    const predictions = await objectDetector.detect(video)

    const detectedObjects = predictions
      .filter((p) => p.score > OBJECT_CONFIDENCE_THRESHOLD)
      .map((p) => p.class.toLowerCase())

    const phoneDetected = detectedObjects.some((obj) =>
      PHONE_CLASSES.some((c) => obj.includes(c))
    )

    const unauthorizedObjectDetected = detectedObjects.some((obj) =>
      UNAUTHORIZED_CLASSES.some((c) => obj.includes(c))
    )

    return { phoneDetected, unauthorizedObjectDetected, detectedObjects }
  } catch {
    return { phoneDetected: false, unauthorizedObjectDetected: false, detectedObjects: [] }
  }
}
