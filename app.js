const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusElement = document.getElementById('status');
const shapeIndicator = document.getElementById('shape-indicator');

let systemActive = false;
let thumbsUpFrames = 0;
const REQUIRED_CONFIRMATION_FRAMES = 25;

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

const cursorGeometry = new THREE.SphereGeometry(0.1, 16, 16);
const cursorMaterial = new THREE.MeshStandardMaterial({ color: 0xff007f, emissive: 0xff007f });
const handCursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
scene.add(handCursor);

let smoothedCursorPos = new THREE.Vector3(0, 0, 0);
let smoothedPoseLandmarks = null;

function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
    camera3D.aspect = window.innerWidth / window.innerHeight;
    camera3D.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Complete Full-Body Anatomical Skeleton Connections (Mapping MediaPipe 33-point topology)
const FULL_BODY_CONNECTIONS = [
    // Torso / Core
    [11, 12], [11, 23], [12, 24], [23, 24],
    // Right Arm
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    // Left Arm
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    // Right Leg
    [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
    // Left Leg
    [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
    // Face outline / Head structure
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10]
];

const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
];

// Smart smoothing algorithm to completely eliminate joint jitter
function smoothLandmarks(newLandmarks) {
    if (!smoothedPoseLandmarks) {
        smoothedPoseLandmarks = JSON.parse(JSON.stringify(newLandmarks));
        return smoothedPoseLandmarks;
    }
    const LERP_FACTOR = 0.3;
    for (let i = 0; i < newLandmarks.length; i++) {
        if (newLandmarks[i]) {
            if (!smoothedPoseLandmarks[i]) smoothedPoseLandmarks[i] = { ...newLandmarks[i] };
            smoothedPoseLandmarks[i].x = LERP_FACTOR * newLandmarks[i].x + (1 - LERP_FACTOR) * smoothedPoseLandmarks[i].x;
            smoothedPoseLandmarks[i].y = LERP_FACTOR * newLandmarks[i].y + (1 - LERP_FACTOR) * smoothedPoseLandmarks[i].y;
            smoothedPoseLandmarks[i].z = LERP_FACTOR * newLandmarks[i].z + (1 - LERP_FACTOR) * smoothedPoseLandmarks[i].z;
            smoothedPoseLandmarks[i].visibility = newLandmarks[i].visibility;
        }
    }
    return smoothedPoseLandmarks;
}

function isStrictThumbsUp(landmarks) {
    const thumbTip = landmarks[4];
    const indexMcp = landmarks[5];
    const thumbExtended = thumbTip.y < indexMcp.y - 0.05;

    const indexFolded = landmarks[8].y > landmarks[6].y;
    const middleFolded = landmarks[12].y > landmarks[10].y;
    const ringFolded = landmarks[16].y > landmarks[14].y;
    const pinkyFolded = landmarks[20].y > landmarks[18].y;

    return thumbExtended && indexFolded && middleFolded && ringFolded && pinkyFolded;
}

let isPinching = false;
function checkPinchState(landmarks) {
    const dx = landmarks[8].x - landmarks[4].x;
    const dy = landmarks[8].y - landmarks[4].y;
    const distance = Math.sqrt(dx * dx + dy * dy);

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

    // 1. Activation Check via Thumbs Up
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
            thumbsUpFrames = Math.max(0, thumbsUpFrames - 2);
            statusElement.innerText = "LOCKED: Hold a strict Thumbs Up steadily to unlock";
        }
    }

    // 2. Render Full Anatomical Body Skeleton Map
    if (latestPose && latestPose.poseLandmarks) {
        const landmarks = smoothLandmarks(latestPose.poseLandmarks);

        // Draw structural bone connections
        canvasCtx.strokeStyle = systemActive ? 'rgba(0, 242, 254, 0.8)' : 'rgba(255, 255, 255, 0.25)';
        canvasCtx.lineWidth = 3;
        canvasCtx.lineCap = 'round';

        for (let [u, v] of FULL_BODY_CONNECTIONS) {
            const p1 = landmarks[u];
            const p2 = landmarks[v];
            if (p1 && p2 && p1.visibility > 0.6 && p2.visibility > 0.6) {
                canvasCtx.beginPath();
                canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
                canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
                canvasCtx.stroke();
            }
        }

        // Draw anatomical joint nodes
        for (let lm of landmarks) {
            if (lm && lm.visibility > 0.6) {
                canvasCtx.fillStyle = systemActive ? '#ff007f' : 'rgba(255, 255, 255, 0.5)';
                canvasCtx.beginPath();
                canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 4, 0, 2 * Math.PI);
                canvasCtx.fill();
            }
        }
    }

    // 3. 3D Object Maker & Hand Cursor Logic
    if (systemActive && latestHands && latestHands.multiHandLandmarks && latestHands.multiHandLandmarks.length > 0) {
        const hand = latestHands.multiHandLandmarks[0];
        const indexTip = hand[8];

        const rawTargetX = -(indexTip.x - 0.5) * 8;
        const rawTargetY = -(indexTip.y - 0.5) * 6;

        smoothedCursorPos.x += (rawTargetX - smoothedCursorPos.x) * 0.25;
        smoothedCursorPos.y += (rawTargetY - smoothedCursorPos.y) * 0.25;

        handCursor.position.copy(smoothedCursorPos);

        if (checkPinchState(hand)) {
            const now = Date.now();
            if (now - lastSpawnTime > 600) {
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

const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.8, minTrackingConfidence: 0.8 });
pose.onResults(results => { latestPose = results; processFrame(); });

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.85, minTrackingConfidence: 0.85 });
hands.onResults(results => { latestHands = results; });

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
