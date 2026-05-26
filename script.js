const video = document.querySelector("#video");
const cameraFrame = document.querySelector(".camera-frame");
const canvas = document.querySelector("#sourceCanvas");
const output = document.querySelector("#asciiOutput");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const statusText = document.querySelector("#status");
const context = canvas.getContext("2d", { willReadFrequently: true });

const density =
  " .'`^\",:;Il!i><~+_-?][}{1)(|\\/*tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const minimumColumns = 44;
const frameInterval = 1000 / 18;

let cameraStream = null;
let animationFrameId = null;
let lastFrameTime = 0;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support camera access.", true);
    return;
  }

  try {
    startButton.disabled = true;
    setStatus("Requesting camera permission...");

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

    stopButton.disabled = false;
    setStatus("Camera is live. Move around to redraw the ASCII portrait.");
    renderAscii();
  } catch (error) {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }

    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus(
      "Camera permission was blocked or no camera was found. Try allowing camera access and starting again.",
      true,
    );
  }
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  video.srcObject = null;
  output.textContent = "";
  startButton.disabled = false;
  stopButton.disabled = true;
  setStatus("Camera stopped.");
}

function renderAscii(timestamp = 0) {
  animationFrameId = requestAnimationFrame(renderAscii);

  if (
    timestamp - lastFrameTime < frameInterval ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }

  lastFrameTime = timestamp;

  const { columns, rows } = getAsciiGridSize();

  canvas.width = columns;
  canvas.height = rows;
  context.drawImage(video, 0, 0, columns, rows);

  const pixels = context.getImageData(0, 0, columns, rows).data;
  let ascii = "";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const offset = (y * columns + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];

      if (alpha < 128) {
        ascii += " ";
        continue;
      }

      const brightness = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const characterIndex = Math.floor(
        (brightness / 255) * (density.length - 1),
      );
      ascii += density[characterIndex];
    }

    ascii += "\n";
  }

  output.textContent = ascii;
}

function getAsciiGridSize() {
  const styles = getComputedStyle(output);
  const fontSize = Number.parseFloat(styles.fontSize) || 16;
  const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize;
  const letterSpacing = Number.parseFloat(styles.letterSpacing) || 0;
  const availableWidth = output.clientWidth || cameraFrame.clientWidth;
  const availableHeight = output.clientHeight || cameraFrame.clientHeight;

  context.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
  const characterWidth = Math.max(
    context.measureText("M").width + letterSpacing,
    fontSize * 0.48,
  );

  return {
    columns: Math.max(minimumColumns, Math.floor(availableWidth / characterWidth)),
    rows: Math.max(24, Math.floor(availableHeight / lineHeight)),
  };
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);

window.addEventListener("beforeunload", stopCamera);
