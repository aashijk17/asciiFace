const video = document.querySelector("#video");
const canvas = document.querySelector("#sourceCanvas");
const output = document.querySelector("#outlineOutput");
const startPanel = document.querySelector("#startPanel");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const statusText = document.querySelector("#status");
const context = canvas.getContext("2d", { willReadFrequently: true });

const minimumColumns = 70;
const frameInterval = 1000 / 20;
const faceDetectionInterval = 450;
const edgeThreshold = 66;

let cameraStream = null;
let animationFrameId = null;
let lastFrameTime = 0;
let lastFaceDetectionTime = 0;
let faceDetector = null;
let faceBox = null;
let faceDetectionInProgress = false;

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
    setStatus("tracking face and shoulders");
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
  output.textContent = "";
  faceBox = null;
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

  const { columns, rows } = getAsciiGridSize();
  const crop = getUpperBodyCrop(columns, rows);

  canvas.width = columns;
  canvas.height = rows;
  context.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    columns,
    rows,
  );

  const pixels = context.getImageData(0, 0, columns, rows).data;
  const gray = toGrayscale(pixels, columns, rows);
  output.textContent = renderEdges(gray, columns, rows);
}

function getAsciiGridSize() {
  const styles = getComputedStyle(output);
  const fontSize = Number.parseFloat(styles.fontSize) || 12;
  const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize;
  const letterSpacing = Number.parseFloat(styles.letterSpacing) || 0;
  const availableWidth = output.clientWidth;
  const availableHeight = output.clientHeight;

  context.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
  const characterWidth = Math.max(
    context.measureText("M").width + letterSpacing,
    fontSize * 0.48,
  );

  return {
    columns: Math.max(minimumColumns, Math.floor(availableWidth / characterWidth)),
    rows: Math.max(36, Math.floor(availableHeight / lineHeight)),
  };
}

function toGrayscale(pixels, columns, rows) {
  const gray = new Uint8ClampedArray(columns * rows);

  for (let index = 0; index < gray.length; index += 1) {
    const pixelIndex = index * 4;
    const red = pixels[pixelIndex];
    const green = pixels[pixelIndex + 1];
    const blue = pixels[pixelIndex + 2];
    gray[index] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  return gray;
}

function renderEdges(gray, columns, rows) {
  let frame = "";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) {
        frame += " ";
        continue;
      }

      const topLeft = gray[(y - 1) * columns + x - 1];
      const top = gray[(y - 1) * columns + x];
      const topRight = gray[(y - 1) * columns + x + 1];
      const left = gray[y * columns + x - 1];
      const right = gray[y * columns + x + 1];
      const bottomLeft = gray[(y + 1) * columns + x - 1];
      const bottom = gray[(y + 1) * columns + x];
      const bottomRight = gray[(y + 1) * columns + x + 1];

      const gradientX =
        -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gradientY =
        -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const magnitude = Math.hypot(gradientX, gradientY);

      if (magnitude < edgeThreshold) {
        frame += " ";
        continue;
      }

      frame += getEdgeCharacter(gradientX, gradientY, magnitude);
    }

    frame += "\n";
  }

  return frame;
}

function getEdgeCharacter(gradientX, gradientY, magnitude) {
  if (magnitude > 185) {
    return "#";
  }

  const angle = Math.atan2(gradientY, gradientX);
  const normalizedAngle = Math.abs(angle);

  if (normalizedAngle < Math.PI / 8 || normalizedAngle > (7 * Math.PI) / 8) {
    return "|";
  }

  if (normalizedAngle > (3 * Math.PI) / 8 && normalizedAngle < (5 * Math.PI) / 8) {
    return "-";
  }

  return angle > 0 ? "/" : "\\";
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

function getUpperBodyCrop(columns, rows) {
  const videoWidth = video.videoWidth || 1;
  const videoHeight = video.videoHeight || 1;
  const targetAspect = columns / rows;

  if (faceBox) {
    const centerX = faceBox.x + faceBox.width / 2;
    const topY = faceBox.y - faceBox.height * 0.7;
    const cropWidth = Math.max(faceBox.width * 4.4, faceBox.height * 3.1);
    const cropHeight = cropWidth / targetAspect;

    return clampCrop(
      centerX - cropWidth / 2,
      topY,
      cropWidth,
      cropHeight,
      videoWidth,
      videoHeight,
    );
  }

  const fallbackWidth = Math.min(videoWidth, videoHeight * targetAspect) * 0.86;
  const fallbackHeight = fallbackWidth / targetAspect;

  return clampCrop(
    (videoWidth - fallbackWidth) / 2,
    videoHeight * 0.02,
    fallbackWidth,
    fallbackHeight,
    videoWidth,
    videoHeight,
  );
}

function clampCrop(x, y, width, height, videoWidth, videoHeight) {
  let cropWidth = Math.min(width, videoWidth);
  let cropHeight = Math.min(height, videoHeight);

  if (cropWidth > videoWidth) {
    cropWidth = videoWidth;
  }

  if (cropHeight > videoHeight) {
    cropHeight = videoHeight;
  }

  return {
    x: Math.max(0, Math.min(x, videoWidth - cropWidth)),
    y: Math.max(0, Math.min(y, videoHeight - cropHeight)),
    width: cropWidth,
    height: cropHeight,
  };
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
window.addEventListener("beforeunload", stopCamera);
