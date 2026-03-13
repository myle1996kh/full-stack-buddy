/**
 * MediaPipe Vision service — loads PoseLandmarker + FaceLandmarker once,
 * exposes per-frame detection methods for the MSE pipeline.
 */
import {
  PoseLandmarker,
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils,
  type PoseLandmarkerResult,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

export type { PoseLandmarkerResult, FaceLandmarkerResult, NormalizedLandmark };

let poseInstance: PoseLandmarker | null = null;
let faceInstance: FaceLandmarker | null = null;
let initPromise: Promise<void> | null = null;
let lastPoseTimestamp = 0;
let lastFaceTimestamp = 0;
let lastPoseWarnAt = 0;
let lastFaceWarnAt = 0;

export type MediaPipeInitStage =
  | 'idle'
  | 'loading-fileset'
  | 'loading-pose-model'
  | 'loading-face-model'
  | 'ready'
  | 'error';

export interface MediaPipeInitStatus {
  stage: MediaPipeInitStage;
  loading: boolean;
  poseReady: boolean;
  faceReady: boolean;
  delegate: 'GPU' | 'CPU' | null;
  error?: string;
}

let initStatus: MediaPipeInitStatus = {
  stage: 'idle',
  loading: false,
  poseReady: false,
  faceReady: false,
  delegate: null,
};

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function loadModels(): Promise<void> {
  initStatus = {
    stage: 'loading-fileset',
    loading: true,
    poseReady: false,
    faceReady: false,
    delegate: null,
  };

  const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

  const createWithDelegate = async (delegate: 'GPU' | 'CPU') => {
    initStatus = {
      ...initStatus,
      loading: true,
      stage: 'loading-pose-model',
      delegate,
      poseReady: false,
      faceReady: false,
      error: undefined,
    };

    const pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    initStatus = {
      ...initStatus,
      stage: 'loading-face-model',
      poseReady: true,
      faceReady: false,
    };

    const face = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    return { pose, face };
  };

  try {
    const { pose, face } = await createWithDelegate('GPU');
    poseInstance = pose;
    faceInstance = face;
    initStatus = {
      ...initStatus,
      stage: 'ready',
      loading: false,
      poseReady: true,
      faceReady: true,
      delegate: 'GPU',
      error: undefined,
    };
  } catch (gpuErr) {
    console.warn('MediaPipe GPU init failed, falling back to CPU:', gpuErr);
    const { pose, face } = await createWithDelegate('CPU');
    poseInstance = pose;
    faceInstance = face;
    initStatus = {
      ...initStatus,
      stage: 'ready',
      loading: false,
      poseReady: true,
      faceReady: true,
      delegate: 'CPU',
      error: undefined,
    };
  }
}

export async function ensureMediaPipe(): Promise<void> {
  if (poseInstance && faceInstance) {
    initStatus = {
      ...initStatus,
      stage: 'ready',
      loading: false,
      poseReady: true,
      faceReady: true,
      error: undefined,
    };
    return;
  }

  if (!initPromise) {
    initPromise = loadModels().catch((err) => {
      initStatus = {
        ...initStatus,
        stage: 'error',
        loading: false,
        poseReady: Boolean(poseInstance),
        faceReady: Boolean(faceInstance),
        error: err instanceof Error ? err.message : String(err),
      };
      // Allow future retries if first init fails
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export function detectPose(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
  if (!poseInstance) return null;
  const ts = timestampMs > lastPoseTimestamp ? timestampMs : lastPoseTimestamp + 1;
  lastPoseTimestamp = ts;
  try {
    return poseInstance.detectForVideo(video, ts);
  } catch (err) {
    const now = performance.now();
    if (now - lastPoseWarnAt > 2000) {
      console.warn('MediaPipe pose detection error:', err);
      lastPoseWarnAt = now;
    }
    return null;
  }
}

export function detectFace(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult | null {
  if (!faceInstance) return null;
  const ts = timestampMs > lastFaceTimestamp ? timestampMs : lastFaceTimestamp + 1;
  lastFaceTimestamp = ts;
  try {
    return faceInstance.detectForVideo(video, ts);
  } catch (err) {
    const now = performance.now();
    if (now - lastFaceWarnAt > 2000) {
      console.warn('MediaPipe face detection error:', err);
      lastFaceWarnAt = now;
    }
    return null;
  }
}

/** Draw pose skeleton + face mesh landmarks on a canvas overlay */
export function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  poseResult: PoseLandmarkerResult | null,
  faceResult: FaceLandmarkerResult | null,
) {
  ctx.clearRect(0, 0, width, height);
  const drawer = new DrawingUtils(ctx);

  // Draw pose skeleton
  if (poseResult?.landmarks?.length) {
    for (const landmarks of poseResult.landmarks) {
      // Connectors
      drawer.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: 'hsla(160, 59%, 42%, 0.7)',
        lineWidth: 2,
      });
      // Landmark dots
      drawer.drawLandmarks(landmarks, {
        color: 'hsla(160, 59%, 42%, 0.9)',
        lineWidth: 1,
        radius: 3,
      });
    }
  }

  // Draw face mesh
  if (faceResult?.faceLandmarks?.length) {
    for (const landmarks of faceResult.faceLandmarks) {
      // Face oval
      drawer.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
        color: 'hsla(217, 91%, 60%, 0.5)',
        lineWidth: 1,
      });
      // Left eye
      drawer.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
        color: 'hsla(217, 91%, 60%, 0.8)',
        lineWidth: 1.5,
      });
      // Right eye
      drawer.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
        color: 'hsla(217, 91%, 60%, 0.8)',
        lineWidth: 1.5,
      });
      // Left iris
      drawer.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, {
        color: 'hsla(217, 91%, 70%, 1)',
        lineWidth: 2,
      });
      // Right iris
      drawer.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, {
        color: 'hsla(217, 91%, 70%, 1)',
        lineWidth: 2,
      });
      // Lips
      drawer.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, {
        color: 'hsla(0, 84%, 60%, 0.6)',
        lineWidth: 1,
      });
    }
  }
}

export function isMediaPipeReady(): boolean {
  return !!(poseInstance && faceInstance);
}

export function getMediaPipeInitStatus(): MediaPipeInitStatus {
  return { ...initStatus };
}
