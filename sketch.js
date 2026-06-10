// Code written by Eric Rennie & Fiona Irving-Beck with AI assistance for select portions.
// All AI generated code has been reviewed and approved by the authors. 

// GUI code adapted from piecesofuk "p5,gui example"
// https://editor.p5js.org/piecesofuk/sketches/SyO2CqPcG

// Kaleidoscope code used for symmetry adapted from p5.js Kaleidoscope example.
// https://p5js.org/examples/repetition-kaleidoscope/

let socket = null;                         // Active WebSocket connection to the stepdance board
const WS_URL = 'ws://localhost:8001/';     // WebSocket server URL
let gui;                                   // Gui instance for the control panel
var symmetry = 4;                          // Number of symmetry copies (default 4); exposed to the gui slider
const strokes = [];                        // All completed strokes drawn this session
const actions = [];                        // Undo history stack; each entry references a stroke

// ─── Extension Error Suppression ─────────────────────────────────────────────

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

// ─── Serial ──────────────────────────────────────────────

//serial connections
let serial;
let serialPort = "/dev/tty.usbmodem161560201";   // Serial port path for direct USB fallback

// ─── Machine Constants ────────────────────────────────────────────────────────

const MACHINE_X = 200;                           // Machine workspace width in mm
const MACHINE_Y = 200;                           // Machine workspace height in mm
const MM_TO_PX_RATIO = 3;                        // Screen pixels per logical mm
const DISPLAY_WIDTH  = MACHINE_X * MM_TO_PX_RATIO;  // Canvas pixel width
const DISPLAY_HEIGHT = MACHINE_Y * MM_TO_PX_RATIO;  // Canvas pixel height

// Swap pen position constants if the machine's up/down axes are reversed.
const PEN_UP_Z   = 0;    // Z value sent when the pen should be raised
const PEN_DOWN_Z = 20;   // Z value sent when the pen should be pressed down

// ─── Drawing State ────────────────────────────────────────────────────────────

const speed = 20.0;   // Travel speed sent with every go_to_xyz command (mm/s)

let freehandBuffer;               // Off-screen p5.Graphics that holds the drawn strokes
let activeStroke = null;          // The stroke currently being drawn (null when idle)
let drawingActive = false;        // True while the mouse is held down on the canvas

// ─── WebSocket Helpers ────────────────────────────────────────────────────────

// Moves the machine head to (x, y) at the global speed.
function callGoTo(x, y) {
  console.log("calling: go to at: " + x + ", " + y);
  sendCommand('go_to_xy', [x, y, speed]);
}

// Prints an error and updates the status banner.
function gotError(theerror) {
  print(theerror);
  updateConnectionStatus("Error: " + theerror);
}

// Writes a human-readable status string into the #connection-status element.
function updateConnectionStatus(status) {
  document.getElementById("connection-status").innerHTML =
    `Connection to ${WS_URL} : ${status}`;
}

// Opens (or re-opens) the WebSocket and registers all lifecycle handlers.
// Auto-reconnects every 2 seconds on close.
function connectWebSocket() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("WebSocket connected to stepdance board");
    updateConnectionStatus("Connected");
  };

  socket.onmessage = (event) => {
    // Log any message received from the board (status, acks, errors, etc.)
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

// Serialises a command name + argument list to JSON and sends it over the socket.
// Returns true on success, false if the socket is not ready or the send throws.
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

// ─── UI Hit-Test ──────────────────────────────────────────────────────────────

// Returns true if the given screen coordinate (px, py) falls inside any
// recognised UI overlay element — used to suppress drawing when clicking controls.
function isOverUI(px, py) {
  const uiSelectors = ['.qs_main', '#go-to-row'];
  return uiSelectors.some(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  });
}

// ─── Coordinate Conversion ────────────────────────────────────────────────────

// function to convert p5 logical coordinates to Arduino coordinates
// p5 logical coordinates are 0..MACHINE_X and 0..MACHINE_Y
// map those ranges into Arduino workspace.
// Maps 0..MACHINE_X → 30..230 and 0..MACHINE_Y → 20..220 to fit the
// machine's physical travel limits.
function p5ToArduino(p5_x, p5_y) {
  // p5 logical coordinates are 0..MACHINE_X and 0..MACHINE_Y
  // map those ranges into Arduino workspace.
  const arduino_x = 30 + (p5_x / MACHINE_X) * (230 - 30);
  const arduino_y = 20 + (p5_y / MACHINE_Y) * (220 - 20);
  return { x: arduino_x, y: arduino_y };
}

// ─── p5 Setup ─────────────────────────────────────────────────────────────────

// Creates the canvas, off-screen buffer, and GUI; then opens the WebSocket.
function setup() {
  let c = createCanvas(DISPLAY_WIDTH, DISPLAY_HEIGHT);
  // Centre the canvas in the browser window
  c.position((windowWidth - DISPLAY_WIDTH) / 2, (windowHeight - DISPLAY_HEIGHT) / 2);

  angleMode(DEGREES);
  background(230);

  // Off-screen buffer drawn in logical mm coordinates (before scale is applied)
  freehandBuffer = createGraphics(MACHINE_X, MACHINE_Y);
  freehandBuffer.background(230);
  freehandBuffer.angleMode(DEGREES);

  // Build the quicksettings GUI panel
  gui = createGui('CNC Embosser');
  sliderRange(0, 8, 1);
  gui.addGlobals('symmetry');
  gui.addButton('Undo', undo);
  gui.addButton('Erase', eraseCanvas);
  gui.addButton('Send', send);

  connectWebSocket();
}

// ─── Drawing State (per-frame tracking) ──────────────────────────────────────

let lastRecordedX;          // Logical X position of the last recorded segment endpoint
let lastRecordedY;          // Logical Y position of the last recorded segment endpoint
let distanceThreshold = 2;  // Minimum distance (mm) between consecutive recorded points

// ─── p5 Draw Loop ─────────────────────────────────────────────────────────────

// Runs every frame. Composites the off-screen buffer, records new stroke segments
// while the mouse is pressed, and draws the debug preview overlay when active.
function draw() {
  let mirror = symmetry;
  let angle  = 360 / mirror;  // Angular step between each symmetry copy
  background(230);
  push();
  scale(MM_TO_PX_RATIO); // Scale the logical drawing up to the visible canvas size

  // Composite the persistent stroke buffer onto the main canvas
  image(freehandBuffer, 0, 0);
  // Shift origin to the canvas centre so symmetry rotations are centred
  translate(MACHINE_X / 2, MACHINE_Y / 2);

  // Convert screen pixel coordinates to logical mm coordinates
  const mouseLogicalX   = mouseX   / MM_TO_PX_RATIO;
  const mouseLogicalY   = mouseY   / MM_TO_PX_RATIO;
  const pmouseLogicalX  = pmouseX  / MM_TO_PX_RATIO;
  const pmouseLogicalY  = pmouseY  / MM_TO_PX_RATIO;

  // Only record and draw if the mouse is held inside the canvas bounds
  if (drawingActive && mouseIsPressed &&
      mouseLogicalX > 0 && mouseLogicalX < MACHINE_X &&
      mouseLogicalY > 0 && mouseLogicalY < MACHINE_Y ) {

    // Segment endpoints in centre-relative logical coordinates
    let lineStartX = mouseLogicalX  - MACHINE_X / 2;
    let lineStartY = mouseLogicalY  - MACHINE_Y / 2;
    let lineEndX   = pmouseLogicalX - MACHINE_X / 2;
    let lineEndY   = pmouseLogicalY - MACHINE_Y / 2;

    // Distance moved since the last recorded point
    let dx       = mouseLogicalX - lastRecordedX;
    let dy       = mouseLogicalY - lastRecordedY;
    let distance = Math.hypot(dx, dy);

    // Always record the first segment, then enforce distance threshold
    if (activeStroke.segments.length === 0 || distance >= distanceThreshold) {
      activeStroke.segments.push({ lineStartX, lineStartY, lineEndX, lineEndY });
      lastRecordedX = mouseLogicalX;
      lastRecordedY = mouseLogicalY;
    }

    if (mirror === 0) {
      // No symmetry — draw a single segment centred on the canvas
      freehandBuffer.push();
      freehandBuffer.translate(MACHINE_X / 2, MACHINE_Y / 2);
      freehandBuffer.stroke(0);
      freehandBuffer.strokeWeight(2);
      freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
      freehandBuffer.pop();
    } else {
      // Symmetry > 0 — draw the segment rotated into each copy, plus its Y reflection
      freehandBuffer.push();
      freehandBuffer.translate(MACHINE_X / 2, MACHINE_Y / 2);
      freehandBuffer.angleMode(DEGREES);
      for (let i = 0; i < mirror; i++) {
        freehandBuffer.rotate(angle);          // Advance to the next rotational copy
        freehandBuffer.stroke(0);
        freehandBuffer.strokeWeight(2);
        freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
        // Mirror across X-axis to add the reflected copy
        freehandBuffer.push();
        freehandBuffer.scale(1, -1);
        freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
        freehandBuffer.pop();
      }
      freehandBuffer.pop();
    }
  }
  pop();
}

// ─── Mouse Handlers ───────────────────────────────────────────────────────────

// Start a new stroke when the mouse is pressed (ignoring clicks on UI overlays).
function mousePressed() {
  if (isOverUI(mouseX, mouseY)) return;
  drawingActive = true;
  activeStroke  = { segments: [], symmetry: symmetry };   // Capture current symmetry setting
  lastRecordedX = mouseX / MM_TO_PX_RATIO;
  lastRecordedY = mouseY / MM_TO_PX_RATIO;
}

// Finalise the active stroke and push it to both the strokes list and actions stack.
function mouseReleased() {
  if (!drawingActive) return;
  drawingActive = false;

  // Only save if at least one segment was recorded (guards against accidental clicks)
  if (activeStroke !== null && activeStroke.segments.length > 0) {
    strokes.push(activeStroke);
    actions.push({ type: 'stroke', strokeRef: activeStroke });
  }
  activeStroke = null;
}

// ─── Window Resize ────────────────────────────────────────────────────────────

function windowResized() {
  const canvasElt = document.querySelector('canvas');
  if (canvasElt) {
    canvasElt.style.position = 'absolute';
    canvasElt.style.left = `${(windowWidth  - DISPLAY_WIDTH)  / 2}px`;
    canvasElt.style.top  = `${(windowHeight - DISPLAY_HEIGHT) / 2}px`;
  }
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

// Pops the most recent action off the stack and redraws the buffer from scratch.
function undo() {
  if (actions.length === 0) return;
  let popped = actions.pop();

  if (popped.type === 'stroke') {
    // Remove the stroke from the strokes array
    let idx = strokes.indexOf(popped.strokeRef);
    if (idx !== -1) strokes.splice(idx, 1);

    // Clear the buffer and repaint all remaining strokes
    freehandBuffer.background(230);
    // Redraw all remaining strokes. Handle symmetry==0 as a special-case
    for (let s = 0; s < strokes.length; s++) {
      let stroke = strokes[s];
      let mirror = stroke.symmetry;

      if (mirror === 0) {
        // Draw each segment once, centered, no reflection
        freehandBuffer.push();
        freehandBuffer.translate(MACHINE_X / 2, MACHINE_Y / 2);
        freehandBuffer.stroke(0);
        freehandBuffer.strokeWeight(2);
        for (let j = 0; j < stroke.segments.length; j++) {
          let seg = stroke.segments[j];
          freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY);
        }
        freehandBuffer.pop();
      } else {
        let angle  = 360 / mirror;   // Angular step for this stroke's symmetry
        freehandBuffer.push();
        freehandBuffer.translate(MACHINE_X / 2, MACHINE_Y / 2);
        freehandBuffer.angleMode(DEGREES);

        for (let j = 0; j < stroke.segments.length; j++) {
          let seg = stroke.segments[j];
          for (let i = 0; i < mirror; i++) {
            freehandBuffer.rotate(angle);
            freehandBuffer.stroke(0);
            freehandBuffer.strokeWeight(2);
            freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY);
            // Reflected copy for this rotation
            freehandBuffer.push();
            freehandBuffer.scale(1, -1);
            freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY);
            freehandBuffer.pop();
          }
        }
        freehandBuffer.pop();
      }
    }
  }
}

// ─── Erase ────────────────────────────────────────────────────────────────────

function eraseCanvas() {
  freehandBuffer.background(230);
  strokes.splice(0, strokes.length);      // Empty the strokes array in-place
  actions.splice(0, actions.length);      // Empty the actions stack in-place
  activeStroke  = null;
  drawingActive = false;
}

// ─── Symmetry Transform ───────────────────────────────────────────────────────

// Applies the same cumulative rotation p5 uses (rotate() is additive per frame)
// then optionally reflects in Y, matching the scale(1,-1) in draw().
// Returns the transformed { x, y }.
// rotationIndex: which copy (0-based), angleDeg: per-copy rotation, reflect: mirror in Y.
function applySymmetryTransform(x, y, rotationIndex, angleDeg, reflect) {
  const rad  = ((rotationIndex + 1) * angleDeg) * (Math.PI / 180);
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  let rx = x * cosA - y * sinA;
  let ry = x * sinA + y * cosA;
  if (reflect) ry = -ry;   // Flip Y for the mirrored copy
  return { x: rx, y: ry };
}

// ─── Stroke → Point List ──────────────────────────────────────────────────────

// Builds the full flat point list for one stroke across all symmetry copies.
// Each copy is a separate pen-down → travel → pen-up sequence.
// Returns an array of { x, y, z } where z = -1 (pen down) or 1 (pen up).
function buildStrokePoints(stroke) {
  const mirror   = stroke.symmetry;
  const angleDeg = mirror === 0 ? 0 : 360 / mirror;
  const segments = stroke.segments;
  const points   = [];

  if (mirror === 0) {
    // Single copy, no reflection
    const linePoints = [];
    for (let j = 0; j < segments.length; j++) {
      const seg = segments[j];
      const start = applySymmetryTransform(seg.lineStartX, seg.lineStartY, 0, angleDeg, false);
      linePoints.push(start);
      // Only push the end point of the final segment to avoid duplicate interior points
      if (j === segments.length - 1) {
        const end = applySymmetryTransform(seg.lineEndX, seg.lineEndY, 0, angleDeg, false);
        linePoints.push(end);
      }
    }
    // Annotate: pen down for all points except the very last
    for (let k = 0; k < linePoints.length; k++) {
      const isLast = k === linePoints.length - 1;
      points.push({ x: linePoints[k].x, y: linePoints[k].y, z: isLast ? 1 : -1 });
    }
  } else {
    // Outer loop: mirror rotations × 2 (normal + reflected)
    for (let i = 0; i < mirror; i++) {
      for (let reflected of [false, true]) {
        const linePoints = [];
        for (let j = 0; j < segments.length; j++) {
          const seg   = segments[j];
          const start = applySymmetryTransform(seg.lineStartX, seg.lineStartY, i, angleDeg, reflected);
          linePoints.push(start);
          if (j === segments.length - 1) {
            const end = applySymmetryTransform(seg.lineEndX, seg.lineEndY, i, angleDeg, reflected);
            linePoints.push(end);
          }
        }
        // Pen down across the segment, pen up at the end of each symmetry copy
        for (let k = 0; k < linePoints.length; k++) {
          const isLast = k === linePoints.length - 1;
          points.push({ x: linePoints[k].x, y: linePoints[k].y, z: isLast ? 1 : -1 });
        }
      }
    }
  }

  return points;
}

// ─── Coordinate Helpers ───────────────────────────────────────────────────────

// Converts a center-relative logical point back to 0-origin p5 space,
// then on to Arduino workspace coordinates.
function convertCenteredToArduino(point) {
  const p5x = point.x + MACHINE_X / 2;
  const p5y = point.y + MACHINE_Y / 2;
  return p5ToArduino(p5x, p5y);
}

// ─── Path Simplification ──────────────────────────────────────────────────────

// Reduces a sequence of points using an angle-deviation threshold.
// Keeps a point only when the direction change from the previous accepted point
// exceeds maxAngleDeg degrees, preventing redundant collinear points from being
// sent to the machine.
function simplifyLinePoints(points, maxAngleDeg = 8) {
  if (points.length <= 2) return points.slice();
  const threshold = Math.cos(maxAngleDeg * Math.PI / 180);  // Cosine threshold for dot product
  const simplified = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const a = simplified[simplified.length - 1];
    const b = points[i];
    const c = points[i + 1];

    // Direction vectors AB and BC
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const lenAB = Math.hypot(abx, aby);
    const lenBC = Math.hypot(bcx, bcy);

    // Skip degenerate (zero-length) segments
    if (lenAB < 0.01 || lenBC < 0.01) {
      continue;
    }

    // Keep the point if the angle change is above the threshold
    const dot = (abx * bcx + aby * bcy) / (lenAB * lenBC);
    if (dot <= threshold) {
      simplified.push(b);
    }
  }

  // Always include the final point
  simplified.push(points[points.length - 1]);
  return simplified;
}

// ─── Stroke → Arduino Command List ───────────────────────────────────────────

// Converts one stroke into a flat list of {x, y, z} Arduino commands.
// For each symmetry copy: simplify → interpolate → prepend pen-up travel to start →
// pen-down across the path → pen-up at the end.
function buildStrokeCommands(stroke) {
  const commands = [];
  const mirror   = stroke.symmetry;
  const angleDeg = mirror === 0 ? 0 : 360 / mirror;
  const MAX_STEP_MM = 3.5; // coarser stepping to reduce command count

  if (mirror === 0) {
    // Single copy, no reflection
    const linePoints = [];
    for (let j = 0; j < stroke.segments.length; j++) {
      const seg   = stroke.segments[j];
      const start = applySymmetryTransform(seg.lineStartX, seg.lineStartY, 0, angleDeg, false);
      linePoints.push(start);
      if (j === stroke.segments.length - 1) {
        const end = applySymmetryTransform(seg.lineEndX, seg.lineEndY, 0, angleDeg, false);
        linePoints.push(end);
      }
    }

    if (linePoints.length > 0) {
      // Remove nearly-collinear points to reduce command count
      const simplifiedPoints = simplifyLinePoints(linePoints, 8);

      // Linear interpolation: insert intermediate points wherever the gap exceeds MAX_STEP_MM
      const interpPoints = [];
      for (let k = 0; k < simplifiedPoints.length - 1; k++) {
        const a    = simplifiedPoints[k];
        const b    = simplifiedPoints[k + 1];
        const dx   = b.x - a.x;
        const dy   = b.y - a.y;
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

      // Travel to stroke start with pen raised, then lower the pen
      const firstArduino = convertCenteredToArduino(interpPoints[0]);
      commands.push({ x: firstArduino.x, y: firstArduino.y, z: PEN_UP_Z });
      commands.push({ x: firstArduino.x, y: firstArduino.y, z: PEN_DOWN_Z });

      // Trace the stroke with pen down
      for (let k = 1; k < interpPoints.length; k++) {
        const arduinoPoint = convertCenteredToArduino(interpPoints[k]);
        commands.push({ x: arduinoPoint.x, y: arduinoPoint.y, z: PEN_DOWN_Z });
      }

      // Lift the pen at the end of the stroke
      const lastArduino = convertCenteredToArduino(interpPoints[interpPoints.length - 1]);
      commands.push({ x: lastArduino.x, y: lastArduino.y, z: PEN_UP_Z });
    }
  } else {
    // Symmetry > 0: iterate over each rotation and its Y-reflection
    for (let i = 0; i < mirror; i++) {
      for (let reflected of [false, true]) {
        const linePoints = [];
        for (let j = 0; j < stroke.segments.length; j++) {
          const seg   = stroke.segments[j];
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
          const a    = simplifiedPoints[k];
          const b    = simplifiedPoints[k + 1];
          const dx   = b.x - a.x;
          const dy   = b.y - a.y;
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

        // Travel to this copy's start with pen raised
        const firstArduino = convertCenteredToArduino(interpPoints[0]);
        commands.push({ x: firstArduino.x, y: firstArduino.y, z: PEN_UP_Z });
        commands.push({ x: firstArduino.x, y: firstArduino.y, z: PEN_DOWN_Z });

        // Trace the copy with pen down
        for (let k = 1; k < interpPoints.length; k++) {
          const arduinoPoint = convertCenteredToArduino(interpPoints[k]);
          commands.push({ x: arduinoPoint.x, y: arduinoPoint.y, z: PEN_DOWN_Z });
        }

        // Pen up at the end of this copy
        const lastArduino = convertCenteredToArduino(interpPoints[interpPoints.length - 1]);
        commands.push({ x: lastArduino.x, y: lastArduino.y, z: PEN_UP_Z });
      }
    }
  }

  return commands;
}

// ─── Send to Machine ──────────────────────────────────────────────────────────

// Compiles every action into a flat Arduino command list, splits it into
// 500-command batches, then sends them sequentially with 120-second delays
// between batches so the Arduino queue has time to drain.
function send() {
  // Check that WebSocket is ready before starting
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('ERROR: WebSocket not connected. Cannot send. State:', socket?.readyState);
    updateConnectionStatus('Not connected - cannot send.');
    return;
  }

  let batchSend    = [];
  const allCommands = [];

  // Build a single ordered command list from all recorded stroke actions
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].type === 'stroke') {
      allCommands.push(...buildStrokeCommands(actions[i].strokeRef));
    }
  }

  console.log('command list for Arduino:', allCommands);
  // Store a copy of the first 1000 commands for the debug overlay, expiring after 5 s
  debugPreviewCommands  = allCommands.slice(0, 1000);
  debugPreviewExpiresAt = millis() + 5000;
  console.log(`total commands to send: ${allCommands.length}`);

  if (allCommands.length === 0) return;

  // Split into batches of up to 500 commands
  while (allCommands.length) {
    batchSend.push(allCommands.splice(0, 500));
  }

  // Always append a final pen-up command to ensure the pen finishes raised
  //const finalPenUp = { x: 500, y: 500, z: PEN_UP_Z };
  //batchSend[batchSend.length - 1].push(finalPenUp);
  //console.log(`>>> APPENDED FINAL PEN-UP to last batch. Z value: ${PEN_UP_Z}`);

  console.log(`total batches: ${batchSend.length}`);
  let batchIndex   = 0;
  const totalBatches = batchSend.length;
  let failedCommands = 0;

  // Send batches sequentially with proper closure capture
  function sendNextBatch() {
    if (batchIndex >= totalBatches) {
      // All batches sent — log a summary
      console.log(`\n===== SEND COMPLETE =====${failedCommands > 0 ? ' (' + failedCommands + ' commands failed)' : ''}`);
      // One more check: log the last sent batch to confirm pen-up was in it
      if (batchSend.length > 0) {
        const lastBatch = batchSend[batchSend.length - 1];
        const lastCmd   = lastBatch[lastBatch.length - 1];
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
    // Wait 2 minutes between batches to allow the Arduino queue to drain
    setTimeout(sendNextBatch, 120000);
  }
  sendNextBatch();
}