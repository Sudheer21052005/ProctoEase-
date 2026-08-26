/**
 * ProctoEase ML Detection Module
 * MediaPipe FaceMesh: face count + gaze + head pose
 * TensorFlow.js COCO-SSD: phone + object detection
 * All inference runs locally — no network calls after model load
 */

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision"
import * as cocoSsd from "@tensorflow-models/coco-ssd"
import "@tensorflow/tfjs"

export interface FaceDetectionResult {
  faceCount: number       // -1 = models not ready
  gazeAway: boolean       // looking up or down
  headTurned: boolean     // looking left or right
  confidence: number
}

export interface ObjectDetectionResult {
  phoneDetected: boolean
  unauthorizedObjectDetected: boolean
  detectedObjects: string[]
}

// Objects COCO-SSD class names that indicate phone
const PHONE_CLASSES = ["cell phone", "remote"]

// Objects that indicate unauthorized materials
const UNAUTHORIZED_CLASSES = [
  "book", "laptop", "keyboard", "mouse",
  "remote", "tv", "monitor",
]

// Gaze threshold — higher = more lenient
// 0.25 means nose must be 25% of face width off-center
const GAZE_YAW_THRESHOLD = 0.25
const GAZE_PITCH_THRESHOLD = 0.22

// Singleton model instances — loaded once, reused
let faceLandmarker: FaceLandmarker | null = null
let objectDetector: cocoSsd.ObjectDetection | null = null
let modelsLoaded = false
let modelLoadPromise: Promise<boolean> | null = null

export async function loadMLModels(): Promise<boolean> {
  if (modelsLoaded) return true
  if (modelLoadPromise) return modelLoadPromise

  modelLoadPromise = (async () => {
    try {
      // Load MediaPipe FaceLandmarker
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      )

      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/" +
            "face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 4,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      // Load COCO-SSD (lite model = fastest)
      objectDetector = await cocoSsd.load({
        base: "lite_mobilenet_v2",
      })

      modelsLoaded = true
      console.log("[ProctoEase ML] Models loaded successfully")
      return true
    } catch (error) {
      console.error("[ProctoEase ML] Failed to load models:", error)
      return false
    }
  })()

  const loaded = await modelLoadPromise
  if (!loaded) {
    modelLoadPromise = null
  }
  return loaded
}

export function areModelsLoaded(): boolean {
  return modelsLoaded
}

export function detectFacesAndGaze(
  video: HTMLVideoElement
): FaceDetectionResult {
  if (!faceLandmarker || !modelsLoaded) {
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
  if (!objectDetector || !modelsLoaded) {
    return { phoneDetected: false, unauthorizedObjectDetected: false, detectedObjects: [] }
  }

  try {
    const predictions = await objectDetector.detect(video)

    const detectedObjects = predictions
      .filter((p) => p.score > 0.6)
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
