const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusElement = document.getElementById('status');
const shapeIndicator = document.getElementById('shape-indicator');

let systemActive = false;
let thumbsUpFrames = 0;
const REQUIRED_CONFIRMATION_FRAMES = 15;

let latestPose = null;
let latestHands = null;

// Three.js Setup
const scene = new THREE.Scene();
const camera3D = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera3D.position.z = 5;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('three-container').appendChild(renderer.domElement);

// Add lighting for 3D shapes
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const pointLight = new THREE.PointLight(0xffffff, 1.5);
pointLight.position.set(5, 5, 5);
scene.add(pointLight);

// Array to store spawned 3D shapes
const spawnedObjects = [];
const shapesArray = ['CUBE', 'SPHERE', 'TORUS', 'CONE'];
let currentShapeIndex = 0;
let lastSpawnTime = 0;

// Cursor 3D Mesh to follow hand position
const cursorGeometry = new THREE.SphereGeometry(0.1, 16, 16);
const cursorMaterial = new THREE.MeshStandardMaterial({ color: 0xff007f, emissive: 0xff007f });
const handCursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
scene.add(handCursor);

function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
    camera3D.aspect = window.innerWidth / window.innerHeight;
    camera3D.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Strict 21-point Hand Thumbs-Up Algorithm
function isStrictThumbsUp(landmarks) {
    const thumbTip = landmarks[4];
    const indexMcp = landmarks[5];
    const thumbExtended = thumbTip.y < indexMcp.y;

    const indexFolded = landmarks[8].y > landmarks[6].y;
    const middleFolded = landmarks[12].y > landmarks[10].y;
    const ringFolded = landmarks[16].y > landmarks[14].y;
    const pinkyFolded = landmarks[20].y > landmarks[18].y;

    return thumbExtended && indexFolded && middleFolded && ringFolded && pinkyFolded;
}

// Detect pinch gesture (Distance between Index tip [8] and Thumb tip [4])
function isPinched(landmarks) {
    const tipIndex = landmarks[8];
    const tipThumb = landmarks[4];
    const dx = tipIndex.x - tipThumb.x;
    const dy = tipIndex.y - tipThumb.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < 0.05; // Threshold for pinch contact
}

function spawnShape(x, y) {
    let geometry;
    const shapeType = shapesArray[currentShapeIndex];

    if (shapeType === 'CUBE') geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    else if (shapeType === 'SPHERE') geometry = new THREE.SphereGeometry(0.5, 32, 32);
    else if (shapeType === 'TORUS') geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 100);
    else if (shapeType === 'CONE') geometry = new THREE.ConeGeometry(0.5, 1, 32);

    // Neon vibrant materials
    const material = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff,
        roughness: 0.3,
        metalness: 0.8
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    scene.add(mesh);
    spawnedObjects.push(mesh);

    // Cycle through shapes for next spawn
    currentShapeIndex = (currentShapeIndex + 1) % shapesArray.length;
    shapeIndicator.innerText = `Active Shape: ${shapesArray[currentShapeIndex]}`;
}

function processFrame() {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (latestPose && latestPose.image) {
        canvasCtx.drawImage(latestPose.image, 0, 0, canvasElement.width, canvasElement.height);
    }

    // 1. Activation Gate via Thumbs Up
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
                statusElement.innerText = "Workspace Unlocked • Pinch fingers to spawn 3D shapes";
            }
        } else {
            thumbsUpFrames = Math.max(0, thumbsUpFrames - 1);
            statusElement.innerText = "LOCKED: Hold a strict Thumbs Up to camera to start";
        }
    }

    // 2. Interactive 3D Maker Logic (Active Mode)
    if (systemActive && latestHands && latestHands.multiHandLandmarks && latestHands.multiHandLandmarks.length > 0) {
        const hand = latestHands.multiHandLandmarks[0];
        const indexTip = hand[8]; // Index finger tracking point

        // Map camera coordinates (0 to 1) to Three.js 3D viewport space
        const targetX = -(indexTip.x - 0.5) * 8;
        const targetY = -(indexTip.y - 0.5) * 6;

        handCursor.position.set(targetX, targetY, 0);

        // Check for pinch gesture to spawn object with cooldown
        if (isPinched(hand)) {
            const now = Date.now();
            if (now - lastSpawnTime > 400) { // 400ms cooldown between spawns
                spawnShape(targetX, targetY);
                lastSpawnTime = now;
            }
        }
    }

    canvasCtx.restore();

    // Rotate all spawned 3D objects for dynamic motion
    spawnedObjects.forEach(obj => {
        obj.rotation.x += 0.01;
        obj.rotation.y += 0.015;
    });

    renderer.render(scene, camera3D);
}

// MediaPipe Setup
const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
pose.onResults(results => { latestPose = results; processFrame(); });

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.75, minTrackingConfidence: 0.75 });
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
