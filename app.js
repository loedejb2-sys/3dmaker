const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusElement = document.getElementById('status');
const shapeIndicator = document.getElementById('shape-indicator');

let systemActive = false;
let thumbsUpFrames = 0;
const REQUIRED_CONFIRMATION_FRAMES = 25; // Increased buffer so it's less sensitive to accidental gestures

let latestPose = null;
let latestHands = null;

// Three.js Setup
const scene = new THREE.Scene();
const camera3D = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera3D.position.z = 5;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('three-container').appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const pointLight = new THREE.PointLight(0xffffff, 1.5);
pointLight.position.set(5, 5, 5);
scene.add(pointLight);

const spawnedObjects = [];
const shapesArray = ['CUBE', 'SPHERE', 'TORUS', 'CONE'];
let currentShapeIndex = 0;
let lastSpawnTime = 0;

// Cursor 3D Mesh with position smoothing (LERP)
const cursorGeometry = new THREE.SphereGeometry(0.1, 16, 16);
const cursorMaterial = new THREE.MeshStandardMaterial({ color: 0xff007f, emissive: 0xff007f });
const handCursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
scene.add(handCursor);

let smoothedCursorPos = new THREE.Vector3(0, 0, 0);

function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
    camera3D.aspect = window.innerWidth / window.innerHeight;
    camera3D.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Strict 21-point Hand Thumbs-Up Algorithm with stricter angular bounds
function isStrictThumbsUp(landmarks) {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexMcp = landmarks[5];

    // Thumb must be pointed up and significantly separated from the palm
    const thumbExtended = thumbTip.y < indexMcp.y - 0.05;

    // All fingers must be fully curled (tips must be lower/further down than joint centers)
    const indexFolded = landmarks[8].y > landmarks[6].y;
    const middleFolded = landmarks[12].y > landmarks[10].y;
    const ringFolded = landmarks[16].y > landmarks[14].y;
    const pinkyFolded = landmarks[20].y > landmarks[18].y;

    return thumbExtended && indexFolded && middleFolded && ringFolded && pinkyFolded;
}

// Stricter, desensitized pinch check with a distinct release threshold
let isPinching = false;
function checkPinchState(landmarks) {
    const tipIndex = landmarks[8];
    const tipThumb = landmarks[4];
    const dx = tipIndex.x - tipThumb.x;
    const dy = tipIndex.y - tipThumb.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Hysteresis: Require a tight pinch to trigger (0.04), but a wider gap to un-pinch (0.07) 
    // to prevent rapid-fire accidental double-spawns from slight finger trembling.
    if (!isPinching && distance < 0.04) {
        isPinching = true;
        return true;
    } else if (isPinching && distance > 0.07) {
        isPinching = false;
    }
    return false;
}

function spawnShape(x, y) {
    let geometry;
    const shapeType = shapesArray[currentShapeIndex];

    if (shapeType === 'CUBE') geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    else if (shapeType === 'SPHERE') geometry = new THREE.SphereGeometry(0.5, 32, 32);
    else if (shapeType === 'TORUS') geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 100);
    else if (shapeType === 'CONE') geometry = new THREE.ConeGeometry(0.5, 1, 32);

    const material = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff,
        roughness: 0.3,
        metalness: 0.8
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    scene.add(mesh);
    spawnedObjects.push(mesh);

    currentShapeIndex = (currentShapeIndex + 1) % shapesArray.length;
    shapeIndicator.innerText = `Active Shape: ${shapesArray[currentShapeIndex]}`;
}

function processFrame() {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (latestPose && latestPose.image) {
        canvasCtx.drawImage(latestPose.image, 0, 0, canvasElement.width, canvasElement.height);
    }

    // 1. Activation Gate via Thumbs Up (Desensitized with frame buffer)
    if (!systemActive) {
        let detectedThumbsUp = false;
        if (latestHands && latestHands.multiHandLandmarks) {
            for (const handLandmarks of latestHands.multiHandLandmarks) {
                if (isStrictThumbsUp(handLandmarks)) detectedThumbsUp = true;
            }
        }

        if (detectedThumbsUp) {
            thumbsUpFrames++;
            statusElement.innerText = `Unlocking Workspace... (${Math.round((thumbsUpFrames / REQUIRED_CONFIRMATION_FRAMES) * 100)}%)`;
            if (thumbsUpFrames >= REQUIRED_CONFIRMATION_FRAMES) {
                systemActive = true;
                statusElement.innerText = "Workspace Unlocked • Pinch index & thumb to spawn shapes";
            }
        } else {
            thumbsUpFrames = Math.max(0, thumbsUpFrames - 2); // Decays faster if gesture drops
            statusElement.innerText = "LOCKED: Hold a strict Thumbs Up steadily to unlock";
        }
    }

    // 2. Interactive 3D Maker Logic with Position Smoothing (LERP)
    if (systemActive && latestHands && latestHands.multiHandLandmarks && latestHands.multiHandLandmarks.length > 0) {
        const hand = latestHands.multiHandLandmarks[0];
        const indexTip = hand[8];

        const rawTargetX = -(indexTip.x - 0.5) * 8;
        const rawTargetY = -(indexTip.y - 0.5) * 6;

        // Linear interpolation (LERP factor 0.2) removes micro-jitters from hand shaking
        smoothedCursorPos.x += (rawTargetX - smoothedCursorPos.x) * 0.2;
        smoothedCursorPos.y += (rawTargetY - smoothedCursorPos.y) * 0.2;

        handCursor.position.copy(smoothedCursorPos);

        // Check for desensitized pinch gesture
        if (checkPinchState(hand)) {
            const now = Date.now();
            if (now - lastSpawnTime > 600) { // Enforce a clean 600ms cooldown
                spawnShape(smoothedCursorPos.x, smoothedCursorPos.y);
                lastSpawnTime = now;
            }
        }
    }

    canvasCtx.restore();

    spawnedObjects.forEach(obj => {
        obj.rotation.x += 0.01;
        obj.rotation.y += 0.015;
    });

    renderer.render(scene, camera3D);
}

// MediaPipe Setup with Higher Confidence Gates to Filter Noise
const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
pose.setOptions({ 
    modelComplexity: 1, 
    smoothLandmarks: true, 
    minDetectionConfidence: 0.8, // Raised to ignore blurry frames
    minTrackingConfidence: 0.8 
});
pose.onResults(results => { latestPose = results; processFrame(); });

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ 
    maxNumHands: 1, 
    modelComplexity: 1, 
    minDetectionConfidence: 0.85, // Highly strict hand threshold to avoid false toggles
    minTrackingConfidence: 0.85 
});
hands.onResults(results => { latestHands = results; });

// Camera Loop
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({ image: videoElement });
        await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720
});

camera.start().catch(err => {
    statusElement.innerText = "Error: Camera access denied.";
    console.error(err);
});
