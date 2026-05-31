let socket = null;
const WS_URL = 'ws://localhost:8001/';
let gui;
var symmetry = 4;
const strokes = [];
const actions = [];

// Suppress Chrome extension messaging errors that don't affect functionality
window.addEventListener('error', (event) => {
  if (event.message && event.message.includes('listener indicated an asynchronous response')) {
    console.warn('(Suppressed extension messaging error - not affecting program)');
    event.preventDefault();
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.message && event.reason.message.includes('listener indicated an asynchronous response')) {
    console.warn('(Suppressed extension messaging promise rejection)');
    event.preventDefault();
  }
});

//serial connections
let serial;
let serialPort = "/dev/tty.usbmodem161560201";

// machine constants
const MACHINE_X = 200;
const MACHINE_Y = 200;
const MM_TO_PX_RATIO = 3;
const DISPLAY_WIDTH = MACHINE_X * MM_TO_PX_RATIO;
const DISPLAY_HEIGHT = MACHINE_Y * MM_TO_PX_RATIO;

// Swap pen position constants if the machine's up/down axes are reversed.
const PEN_UP_Z = 0;
const PEN_DOWN_Z = 4;

// speed constant
const speed = 15.0;

let freehandBuffer;
let activeStroke = null;
let drawingActive = false;
let debugPreviewCommands = null;
let debugPreviewExpiresAt = 0;

function callGoTo(x, y) {
  console.log("calling: go to at: " + x + ", " + y);
  sendCommand('go_to_xy', [x, y, speed]);
}

function gotError(theerror) {
  print(theerror);
  updateConnectionStatus("Error: " + theerror);
}

function updateConnectionStatus(status) {
  document.getElementById("connection-status").innerHTML =
    `Connection to ${WS_URL} : ${status}`;
}

function connectWebSocket() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("WebSocket connected to stepdance board");
    updateConnectionStatus("Connected");
  };

  socket.onmessage = (event) => {
    console.log('Message from board:', event.data);
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    updateConnectionStatus("Error: " + error);
  };

  socket.onclose = () => {
    console.log("WebSocket disconnected");
    updateConnectionStatus("Closed");
    // Auto-reconnect after 2 seconds
    setTimeout(connectWebSocket, 2000);
  };
}

function sendCommand(commandName, args = []) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("WebSocket NOT OPEN (state:", socket?.readyState, "), command NOT sent:", commandName, args);
    return false;
  }
  const message = JSON.stringify({ name: commandName, args: args });
  try {
    socket.send(message);
    return true;
  } catch (err) {
    console.error('FAILED to send websocket message:', err.message, message);
    return false;
  }
}

function isOverUI(px, py) {
  const uiSelectors = ['.qs_main', '#go-to-row'];
  return uiSelectors.some(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  });
}

// function to convert p5 logical coordinates to Arduino coordinates
function p5ToArduino(p5_x, p5_y) {
  // p5 logical coordinates are 0..MACHINE_X and 0..MACHINE_Y
  // map those ranges into Arduino workspace.
  const arduino_x = 30 + (p5_x / MACHINE_X) * (230 - 30);
  const arduino_y = 20 + (p5_y / MACHINE_Y) * (220 - 20);
  return { x: arduino_x, y: arduino_y };
}

function setup() {
  let c = createCanvas(DISPLAY_WIDTH, DISPLAY_HEIGHT);
  c.position((windowWidth - DISPLAY_WIDTH) / 2, (windowHeight - DISPLAY_HEIGHT) / 2);

  angleMode(DEGREES);
  background(230);

  freehandBuffer = createGraphics(MACHINE_X, MACHINE_Y);
  freehandBuffer.background(230);
  freehandBuffer.angleMode(DEGREES);

  gui = createGui('CNC Embosser');
  sliderRange(1, 8, 1);
  gui.addGlobals('symmetry');
  gui.addButton('Undo', undo);
  gui.addButton('Erase', eraseCanvas);
  gui.addButton('Send', send);

  connectWebSocket();
}

function draw() {
  let mirror = symmetry;
  let angle = 360 / mirror;
  background(230);
  push();
  scale(MM_TO_PX_RATIO); // Scale the logical drawing up to the visible canvas size

  image(freehandBuffer, 0, 0);
  translate(MACHINE_X / 2, MACHINE_Y / 2);

  const mouseLogicalX = mouseX / MM_TO_PX_RATIO;
  const mouseLogicalY = mouseY / MM_TO_PX_RATIO;
  const pmouseLogicalX = pmouseX / MM_TO_PX_RATIO;
  const pmouseLogicalY = pmouseY / MM_TO_PX_RATIO;

  if (drawingActive && mouseIsPressed &&
      mouseLogicalX > 0 && mouseLogicalX < MACHINE_X &&
      mouseLogicalY > 0 && mouseLogicalY < MACHINE_Y) {

    let lineStartX = mouseLogicalX - MACHINE_X / 2;
    let lineStartY = mouseLogicalY - MACHINE_Y / 2;
    let lineEndX   = pmouseLogicalX - MACHINE_X / 2;
    let lineEndY   = pmouseLogicalY - MACHINE_Y / 2;

    activeStroke.segments.push({ lineStartX, lineStartY, lineEndX, lineEndY });

    freehandBuffer.push();
    freehandBuffer.translate(MACHINE_X / 2, MACHINE_Y / 2);
    freehandBuffer.angleMode(DEGREES);
    for (let i = 0; i < mirror; i++) {
      freehandBuffer.rotate(angle);
      freehandBuffer.stroke(0);
      freehandBuffer.strokeWeight(2);
      freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
      freehandBuffer.push();
      freehandBuffer.scale(1, -1);
      freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
      freehandBuffer.pop();
    }
    freehandBuffer.pop();
  }
  // Draw debug preview overlay if present (set by send())
  if (debugPreviewCommands && millis() < debugPreviewExpiresAt) {
    drawPreviewOverlay(debugPreviewCommands);
  } else {
    debugPreviewCommands = null;
  }

  pop();
}

// Draw preview overlay from main draw loop so it isn't immediately erased.
function drawPreviewOverlay(commands) {
  // We're already inside a scaled/translated frame in `draw()`,
  // so draw in logical p5 coordinates (centered) without re-scaling.
  push();
  noFill();
  stroke(255, 0, 0);
  strokeWeight(2 / MM_TO_PX_RATIO);

  const max = Math.min(commands.length, 1000);
  for (let i = 0; i < max; i++) {
    const c = commands[i];
    const px = ((c.x - 30) / (230 - 30)) * MACHINE_X - MACHINE_X / 2;
    const py = ((c.y - 20) / (220 - 20)) * MACHINE_Y - MACHINE_Y / 2;
    ellipse(px, py, 4 / MM_TO_PX_RATIO, 4 / MM_TO_PX_RATIO);
  }

  pop();
}

function mousePressed() {
  if (isOverUI(mouseX, mouseY)) return;
  drawingActive = true;
  activeStroke = { segments: [], symmetry: symmetry };
}

function mouseReleased() {
  if (!drawingActive) return;
  drawingActive = false;

  if (activeStroke !== null && activeStroke.segments.length > 0) {
    strokes.push(activeStroke);
    actions.push({ type: 'stroke', strokeRef: activeStroke });
  }
  activeStroke = null;
}

function windowResized() {
  const canvasElt = document.querySelector('canvas');
  if (canvasElt) {
    canvasElt.style.position = 'absolute';
    canvasElt.style.left = `${(windowWidth - DISPLAY_WIDTH) / 2}px`;
    canvasElt.style.top = `${(windowHeight - DISPLAY_HEIGHT) / 2}px`;
  }
}

function undo() {
  if (actions.length === 0) return;
  let popped = actions.pop();

  if (popped.type === 'stroke') {
    let idx = strokes.indexOf(popped.strokeRef);
    if (idx !== -1) strokes.splice(idx, 1);

    freehandBuffer.background(230);
    freehandBuffer.push();
    freehandBuffer.translate(MACHINE_X / 2, MACHINE_Y / 2);
    freehandBuffer.angleMode(DEGREES);

    for (let s = 0; s < strokes.length; s++) {
      let stroke = strokes[s];
      let mirror = stroke.symmetry;
      let angle  = 360 / mirror;

      for (let j = 0; j < stroke.segments.length; j++) {
        let seg = stroke.segments[j];

        for (let i = 0; i < mirror; i++) {
          freehandBuffer.rotate(angle);
          freehandBuffer.stroke(0);
          freehandBuffer.strokeWeight(2);
          freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY);
          freehandBuffer.push();
          freehandBuffer.scale(1, -1);
          freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY);
          freehandBuffer.pop();
        }
      }
    }
    freehandBuffer.pop();
  }
}

function eraseCanvas() {
  freehandBuffer.background(230);
  strokes.splice(0, strokes.length);
  actions.splice(0, actions.length);
  activeStroke = null;
  drawingActive = false;
}

// Applies the same cumulative rotation p5 uses (rotate() is additive per frame)
// then optionally reflects in Y, matching the scale(1,-1) in draw().
// Returns the transformed { x, y }.
function applySymmetryTransform(x, y, rotationIndex, angleDeg, reflect) {
  const rad = ((rotationIndex + 1) * angleDeg) * (Math.PI / 180);
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  let rx = x * cosA - y * sinA;
  let ry = x * sinA + y * cosA;
  if (reflect) ry = -ry;
  return { x: rx, y: ry };
}

// Builds the full flat point list for one stroke across all symmetry copies.
// Each copy is a separate pen-down → travel → pen-up sequence.
// Returns an array of { x, y, z } where z = -1 (pen down) or 1 (pen up).
function buildStrokePoints(stroke) {
  const mirror   = stroke.symmetry;
  const angleDeg = 360 / mirror;
  const segments = stroke.segments;
  const points   = [];

  // Outer loop: mirror rotations × 2 (normal + reflected)
  for (let i = 0; i < mirror; i++) {
    for (let reflected of [false, true]) {

      // Collect the unique points along this symmetry copy of the stroke.
      // Segments share endpoints, so we take the start of every segment
      // then append the final endpoint once at the end.
      const linePoints = [];
      for (let j = 0; j < segments.length; j++) {
        const seg = segments[j];
        const start = applySymmetryTransform(seg.lineStartX, seg.lineStartY, i, angleDeg, reflected);
        linePoints.push(start);
        // On the last segment, also add the end point
        if (j === segments.length - 1) {
          const end = applySymmetryTransform(seg.lineEndX, seg.lineEndY, i, angleDeg, reflected);
          linePoints.push(end);
        }
      }

      // First point: pen down (z = -1). Last point: pen up (z = 1). All others stay down.
      for (let k = 0; k < linePoints.length; k++) {
        const isLast = k === linePoints.length - 1;
        points.push({ x: linePoints[k].x, y: linePoints[k].y, z: isLast ? 1 : -1 });
      }
    }
  }

  return points;
}

function convertCenteredToArduino(point) {
  const p5x = point.x + MACHINE_X / 2;
  const p5y = point.y + MACHINE_Y / 2;
  return p5ToArduino(p5x, p5y);
}

function simplifyLinePoints(points, maxAngleDeg = 8) {
  if (points.length <= 2) return points.slice();
  const threshold = Math.cos(maxAngleDeg * Math.PI / 180);
  const simplified = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const a = simplified[simplified.length - 1];
    const b = points[i];
    const c = points[i + 1];

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const lenAB = Math.hypot(abx, aby);
    const lenBC = Math.hypot(bcx, bcy);

    if (lenAB < 0.01 || lenBC < 0.01) {
      continue;
    }

    const dot = (abx * bcx + aby * bcy) / (lenAB * lenBC);
    if (dot <= threshold) {
      simplified.push(b);
    }
  }

  simplified.push(points[points.length - 1]);
  return simplified;
}

// Draw a quick preview of the commands that will be sent.
// This helps verify ordering, density, and whether points match the drawn path.
function previewCommands(commands, limit = 200) {
  push();
  scale(MM_TO_PX_RATIO);
  translate(MACHINE_X / 2, MACHINE_Y / 2);
  noFill();
  stroke(255, 0, 0);
  strokeWeight(2 / MM_TO_PX_RATIO);

  const max = Math.min(limit, commands.length);
  for (let i = 0; i < max; i++) {
    const c = commands[i];
    // Map Arduino coords back to p5 logical coordinates
    const px = ((c.x - 30) / (230 - 30)) * MACHINE_X - MACHINE_X / 2;
    const py = ((c.y - 20) / (220 - 20)) * MACHINE_Y - MACHINE_Y / 2;
    ellipse(px, py, 3 / MM_TO_PX_RATIO, 3 / MM_TO_PX_RATIO);
  }
  pop();
}

function buildStrokeCommands(stroke) {
  const commands = [];
  const mirror = stroke.symmetry;
  const angleDeg = 360 / mirror;
  const MAX_STEP_MM = 3.5; // coarser stepping to reduce command count

  for (let i = 0; i < mirror; i++) {
    for (let reflected of [false, true]) {
      const linePoints = [];
      for (let j = 0; j < stroke.segments.length; j++) {
        const seg = stroke.segments[j];
        const start = applySymmetryTransform(seg.lineStartX, seg.lineStartY, i, angleDeg, reflected);
        linePoints.push(start);
        if (j === stroke.segments.length - 1) {
          const end = applySymmetryTransform(seg.lineEndX, seg.lineEndY, i, angleDeg, reflected);
          linePoints.push(end);
        }
      }

      if (linePoints.length === 0) continue;

      const simplifiedPoints = simplifyLinePoints(linePoints, 8);

      // Interpolate between consecutive simplified points so the machine receives
      // smaller linear moves without overloading the queue.
      const interpPoints = [];
      for (let k = 0; k < simplifiedPoints.length - 1; k++) {
        const a = simplifiedPoints[k];
        const b = simplifiedPoints[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        interpPoints.push(a);
        if (dist > MAX_STEP_MM) {
          const steps = Math.ceil(dist / MAX_STEP_MM);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            interpPoints.push({ x: a.x + dx * t, y: a.y + dy * t });
          }
        }
      }
      interpPoints.push(simplifiedPoints[simplifiedPoints.length - 1]);

      const firstArduino = convertCenteredToArduino(interpPoints[0]);
      commands.push({ x: firstArduino.x, y: firstArduino.y, z: PEN_UP_Z });
      commands.push({ x: firstArduino.x, y: firstArduino.y, z: PEN_DOWN_Z });

      for (let k = 1; k < interpPoints.length; k++) {
        const arduinoPoint = convertCenteredToArduino(interpPoints[k]);
        commands.push({ x: arduinoPoint.x, y: arduinoPoint.y, z: PEN_DOWN_Z });
      }

      const lastArduino = convertCenteredToArduino(interpPoints[interpPoints.length - 1]);
      commands.push({ x: lastArduino.x, y: lastArduino.y, z: PEN_UP_Z });
    }
  }

  return commands;
}

function send() {
  // Check that WebSocket is ready before starting
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('ERROR: WebSocket not connected. Cannot send. State:', socket?.readyState);
    updateConnectionStatus('Not connected - cannot send.');
    return;
  }

  let batchSend = [];
  const allCommands = [];

  for (let i = 0; i < actions.length; i++) {
    if (actions[i].type === 'stroke') {
      allCommands.push(...buildStrokeCommands(actions[i].strokeRef));
    }
  }

  console.log('command list for Arduino:', allCommands);
  debugPreviewCommands = allCommands.slice(0, 1000);
  debugPreviewExpiresAt = millis() + 5000;
  console.log(`total commands to send: ${allCommands.length}`);

  if (allCommands.length === 0) return;

  // Split into batches of up to 100 commands
  while (allCommands.length) {
    batchSend.push(allCommands.splice(0, 100));
  }

  // Always append a final pen-up command to ensure the pen finishes raised
  const finalPenUp = { x: 100, y: 100, z: PEN_UP_Z };
  batchSend[batchSend.length - 1].push(finalPenUp);
  console.log(`>>> APPENDED FINAL PEN-UP to last batch. Z value: ${PEN_UP_Z}`);

  console.log(`total batches: ${batchSend.length}`);
  let batchIndex = 0;
  const totalBatches = batchSend.length;
  let failedCommands = 0;

  // Send batches sequentially with proper closure capture
  function sendNextBatch() {
    if (batchIndex >= totalBatches) {
      console.log(`\n===== SEND COMPLETE =====${failedCommands > 0 ? ' (' + failedCommands + ' commands failed)' : ''}`);
      // One more check: log the last sent batch to confirm pen-up was in it
      if (batchSend.length > 0) {
        const lastBatch = batchSend[batchSend.length - 1];
        const lastCmd = lastBatch[lastBatch.length - 1];
        console.log(`Last command sent was: x=${lastCmd.x}, y=${lastCmd.y}, z=${lastCmd.z}`);
      }
      return;
    }

    // Re-check WebSocket before each batch
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error(`STOPPING: WebSocket disconnected before batch ${batchIndex + 1}. Sent ${batchIndex}/${totalBatches} batches.`);
      return;
    }

    const batch = batchSend[batchIndex];
    console.log(`\n>>> Sending batch ${batchIndex + 1}/${totalBatches} (${batch.length} commands)`);

    let sentInBatch = 0;
    for (const cmd of batch) {
      if (sendCommand('go_to_xyz', [cmd.x, cmd.y, cmd.z, speed])) {
        sentInBatch++;
      } else {
        failedCommands++;
      }
    }
    console.log(`    ✓ ${sentInBatch}/${batch.length} commands sent`);

    batchIndex++;
    // Wait 500ms between batches to allow the Arduino queue to drain
    setTimeout(sendNextBatch, 500);
  }

  sendNextBatch();
}

// Function that
// function send()
// set timeout {
// - pops the next batch off array
// - send it
// }
// - if not done: call itself 
// send()

// serial.write(`{"name": "go_to_xyz", "args": [${machineX}, ${machineY}, ${machineZ1}, ${speed}]}\n`);
