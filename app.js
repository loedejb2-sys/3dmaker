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

// Three.js Setup with True Perspective 3D Scene mapping
const scene = new THREE.Scene();
const camera3D = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera3D.position.z = 5;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('three-container').appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const pointLight = new THREE.PointLight(0xffffff, 1.5);
pointLight.position.set(0, 0, 50);
scene.add(pointLight);

const spawnedObjects = [];
const shapesArray = ['CUBE', 'SPHERE', 'TORUS', 'CONE'];
let currentShapeIndex = 0;
let lastSpawnTime = 0;

// Cursor tracking the 3D axis vector of the pointer fingertip
const cursorGeometry = new THREE.SphereGeometry(0.08, 16, 16);
const cursorMaterial = new THREE.MeshStandardMaterial({ color: 0xff007f, emissive: 0xff007f });
const pointerCursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
scene.add(pointerCursor);

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

const FULL_BODY_CONNECTIONS = [
    [11, 12], [11, 23], [12, 24], [23, 24],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
    [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10]
];

// Expanded 50-Point Dual Hand Connections (25 points per hand topology)
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],           
    [0,5],[5,6],[6,7],[7,8],           
    [5,9],[9,10],[10,11],[11,12],      
    [9,13],[13,14],[14,15],[15,16],    
    [13,17],[17,18],[18,19],[19,20],   
    [0,17],[17,21],[21,22],[22,23],[23,24] 
];

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
    const dz = landmarks[8].z - landmarks[4].z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (!isPinching && distance < 0.04) {
        isPinching = true;
        return true;
    } else if (isPinching && distance > 0.07) {
        isPinching = false;
    }
    return false;
}

function spawnShape(position) {
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
    mesh.position.copy(position);
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
                statusElement.innerText = "Workspace Unlocked • Pinch physical finger axes to spawn objects";
            }
        } else {
            thumbsUpFrames = Math.max(0, thumbsUpFrames - 2);
            statusElement.innerText = "LOCKED: Hold a strict Thumbs Up steadily to unlock";
        }
    }

    // Render Full Body Skeleton
    if (latestPose && latestPose.poseLandmarks) {
        const landmarks = latestPose.poseLandmarks;
        canvasCtx.strokeStyle = systemActive ? 'rgba(0, 242, 254, 0.6)' : 'rgba(255, 255, 255, 0.15)';
        canvasCtx.lineWidth = 2;
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
    }

    // Render 100-Point Dual Hand Skeletons (50 points per hand using world coordinate vectors)
    if (latestHands && latestHands.multiHandLandmarks) {
        for (const handLandmarks of latestHands.multiHandLandmarks) {
            canvasCtx.strokeStyle = systemActive ? 'rgba(50, 215, 75, 0.8)' : 'rgba(243, 156, 18, 0.4)';
            canvasCtx.lineWidth = 2;

            for (let [u, v] of HAND_CONNECTIONS) {
                if (handLandmarks[u] && handLandmarks[v]) {
                    const p1 = handLandmarks[u];
                    const p2 = handLandmarks[v];
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
                    canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
                    canvasCtx.stroke();
                }
            }

            for (let lm of handLandmarks) {
                if (lm) {
                    canvasCtx.fillStyle = '#ff007f';
                    canvasCtx.beginPath();
                    canvasCtx.arc(lm.x * canvasElement.width, lm.y * canvasElement.height, 3.5, 0, 2 * Math.PI);
                    canvasCtx.fill();
                }
            }
        }

        // Anchor 3D placement to the physical 3D world axes vector of the pointer fingertip
        if (systemActive && latestHands.multiHandWorldLandmarks && latestHands.multiHandWorldLandmarks.length > 0) {
            const primaryWorldHand = latestHands.multiHandWorldLandmarks[0];
            const primaryScreenHand = latestHands.multiHandLandmarks[0]; // For pinch check
            
            // Landmark 8 is the index finger tip metric world axis position
            const fingerTipWorld = primaryWorldHand[8]; 

            // Map metric world coordinates directly into Three.js 3D space scale (flipping X to match mirror view)
            const targetX = -fingerTipWorld.x * 4.0;
            const targetY = fingerTipWorld.y * 4.0;
            const targetZ = -fingerTipWorld.z * 4.0;

            smoothedCursorPos.x += (targetX - smoothedCursorPos.x) * 0.3;
            smoothedCursorPos.y += (targetY - smoothedCursorPos.y) * 0.3;
            smoothedCursorPos.z += (targetZ - smoothedCursorPos.z) * 0.3;

            pointerCursor.position.copy(smoothedCursorPos);

            if (checkPinchState(primaryScreenHand)) {
                const now = Date.now();
                if (now - lastSpawnTime > 600) {
                    spawnShape(smoothedCursorPos);
                    lastSpawnTime = now;
                }
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
hands.setOptions({ 
    maxNumHands: 2, // Tracks 2 hands simultaneously for 100 total points
    modelComplexity: 1, 
    minDetectionConfidence: 0.85, 
    minTrackingConfidence: 0.85 
});
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
