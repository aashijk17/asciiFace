const video = document.querySelector("#video");
const processingCanvas = document.querySelector("#sourceCanvas");
const outlineCanvas = document.querySelector("#outlineCanvas");
const startPanel = document.querySelector("#startPanel");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const statusText = document.querySelector("#status");
const processingContext = processingCanvas.getContext("2d", {
  willReadFrequently: true,
});
const outlineContext = outlineCanvas.getContext("2d");

const frameInterval = 1000 / 24;
const faceDetectionInterval = 450;
const edgeThreshold = 72;
const maxSampleWidth = 260;

let cameraStream = null;
let animationFrameId = null;
let lastFrameTime = 0;
let lastFaceDetectionTime = 0;
let faceDetector = null;
let faceBox = null;
let faceDetectionInProgress = false;
let currentSourceCrop = null;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("camera access is not supported in this browser", true);
    return;
  }

  try {
    startButton.disabled = true;
    setStatus("requesting camera");

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    });

    video.srcObject = cameraStream;
    await video.play();

    initializeFaceDetector();
    startPanel.classList.add("is-hidden");
    stopButton.disabled = false;
    setStatus("drawing white body outline");
    renderOutline();
  } catch (error) {
    cleanupStream();
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus("camera blocked or unavailable", true);
  }
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  cleanupStream();
  video.srcObject = null;
  clearOutline();
  faceBox = null;
  currentSourceCrop = null;
  startPanel.classList.remove("is-hidden");
  startButton.disabled = false;
  stopButton.disabled = true;
  setStatus("camera terminal offline");
}

function cleanupStream() {
  if (!cameraStream) {
    return;
  }

  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

function renderOutline(timestamp = 0) {
  animationFrameId = requestAnimationFrame(renderOutline);

  if (
    timestamp - lastFrameTime < frameInterval ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }

  lastFrameTime = timestamp;
  updateFaceBox(timestamp);

  const displaySize = getDisplaySize();
  const sampleSize = getSampleSize(displaySize);
  const sourceCrop = getCoverCrop(
    video.videoWidth,
    video.videoHeight,
    sampleSize.width,
    sampleSize.height,
  );

  currentSourceCrop = sourceCrop;
  processingCanvas.width = sampleSize.width;
  processingCanvas.height = sampleSize.height;
  processingContext.drawImage(
    video,
    sourceCrop.x,
    sourceCrop.y,
    sourceCrop.width,
    sourceCrop.height,
    0,
    0,
    sampleSize.width,
    sampleSize.height,
  );

  const pixels = processingContext.getImageData(
    0,
    0,
    sampleSize.width,
    sampleSize.height,
  ).data;
  const gray = toGrayscale(pixels, sampleSize.width, sampleSize.height);

  resizeOutlineCanvas(displaySize);
  drawEdges(gray, sampleSize, displaySize);
}

function getDisplaySize() {
  const bounds = outlineCanvas.getBoundingClientRect();

  return {
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function getSampleSize(displaySize) {
  const width = Math.min(maxSampleWidth, displaySize.width);
  const height = Math.max(1, Math.round(width * (displaySize.height / displaySize.width)));

  return { width, height };
}

function getCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return {
      x: (sourceWidth - width) / 2,
      y: 0,
      width,
      height: sourceHeight,
    };
  }

  const height = sourceWidth / targetRatio;
  return {
    x: 0,
    y: (sourceHeight - height) / 2,
    width: sourceWidth,
    height,
  };
}

function resizeOutlineCanvas(displaySize) {
  const scale = window.devicePixelRatio || 1;
  const width = Math.round(displaySize.width * scale);
  const height = Math.round(displaySize.height * scale);

  if (outlineCanvas.width !== width || outlineCanvas.height !== height) {
    outlineCanvas.width = width;
    outlineCanvas.height = height;
  }

  outlineContext.setTransform(scale, 0, 0, scale, 0, 0);
}

function clearOutline() {
  outlineContext.setTransform(1, 0, 0, 1, 0, 0);
  outlineContext.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height);
}

function toGrayscale(pixels, width, height) {
  const gray = new Uint8ClampedArray(width * height);

  for (let index = 0; index < gray.length; index += 1) {
    const pixelIndex = index * 4;
    const red = pixels[pixelIndex];
    const green = pixels[pixelIndex + 1];
    const blue = pixels[pixelIndex + 2];
    gray[index] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  return gray;
}

function drawEdges(gray, sampleSize, displaySize) {
  const scaleX = displaySize.width / sampleSize.width;
  const scaleY = displaySize.height / sampleSize.height;
  const focusRegion = getFocusRegion(sampleSize);

  outlineContext.clearRect(0, 0, displaySize.width, displaySize.height);
  outlineContext.fillStyle = "#ffffff";
  outlineContext.shadowColor = "rgba(255, 255, 255, 0.6)";
  outlineContext.shadowBlur = 4;

  for (let y = 1; y < sampleSize.height - 1; y += 1) {
    for (let x = 1; x < sampleSize.width - 1; x += 1) {
      if (!isInsideFocusRegion(x, y, focusRegion)) {
        continue;
      }

      const magnitude = getEdgeMagnitude(gray, sampleSize.width, x, y);

      if (magnitude < edgeThreshold) {
        continue;
      }

      outlineContext.fillRect(
        x * scaleX,
        y * scaleY,
        Math.max(1.1, scaleX * 0.82),
        Math.max(1.1, scaleY * 0.82),
      );
    }
  }
}

function getEdgeMagnitude(gray, width, x, y) {
  const topLeft = gray[(y - 1) * width + x - 1];
  const top = gray[(y - 1) * width + x];
  const topRight = gray[(y - 1) * width + x + 1];
  const left = gray[y * width + x - 1];
  const right = gray[y * width + x + 1];
  const bottomLeft = gray[(y + 1) * width + x - 1];
  const bottom = gray[(y + 1) * width + x];
  const bottomRight = gray[(y + 1) * width + x + 1];

  const gradientX =
    -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
  const gradientY =
    -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;

  return Math.hypot(gradientX, gradientY);
}

function getFocusRegion(sampleSize) {
  if (!faceBox || !currentSourceCrop) {
    return {
      x: sampleSize.width * 0.18,
      y: sampleSize.height * 0.02,
      width: sampleSize.width * 0.64,
      height: sampleSize.height * 0.9,
    };
  }

  const face = sourceBoxToSampleBox(faceBox, sampleSize);
  const width = face.width * 4.4;
  const height = face.height * 4.8;
  const centerX = face.x + face.width / 2;
  const y = face.y - face.height * 0.75;

  return {
    x: Math.max(0, centerX - width / 2),
    y: Math.max(0, y),
    width: Math.min(sampleSize.width, width),
    height: Math.min(sampleSize.height, height),
  };
}

function sourceBoxToSampleBox(box, sampleSize) {
  const scaleX = sampleSize.width / currentSourceCrop.width;
  const scaleY = sampleSize.height / currentSourceCrop.height;

  return {
    x: (box.x - currentSourceCrop.x) * scaleX,
    y: (box.y - currentSourceCrop.y) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

function isInsideFocusRegion(x, y, region) {
  return (
    x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height
  );
}

function initializeFaceDetector() {
  if (!("FaceDetector" in window)) {
    faceDetector = null;
    return;
  }

  try {
    faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
  } catch (error) {
    faceDetector = null;
  }
}

function updateFaceBox(timestamp) {
  if (
    !faceDetector ||
    faceDetectionInProgress ||
    timestamp - lastFaceDetectionTime < faceDetectionInterval
  ) {
    return;
  }

  lastFaceDetectionTime = timestamp;
  faceDetectionInProgress = true;

  faceDetector
    .detect(video)
    .then((faces) => {
      faceBox = faces[0]?.boundingBox ?? faceBox;
    })
    .catch(() => {
      faceDetector = null;
    })
    .finally(() => {
      faceDetectionInProgress = false;
    });
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
window.addEventListener("beforeunload", stopCamera);
