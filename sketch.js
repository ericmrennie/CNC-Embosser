let socket = null;
const WS_URL = 'ws://localhost:8001/';
let gui;
var symmetry = 4;
const strokes = [];
const actions = [];

//serial connections
let serial;
let serialPort = "/dev/tty.usbmodem161560201";

// machine constants
const MACHINE_X = 200;
const MACHINE_Y = 200;
const MM_TO_PX_RATIO = 3;
const DISPLAY_WIDTH = MACHINE_X * MM_TO_PX_RATIO;
const DISPLAY_HEIGHT = MACHINE_Y * MM_TO_PX_RATIO;

// speed constant
const speed = 15.0;

let freehandBuffer;
let activeStroke = null;
let drawingActive = false;

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
  };
}

function sendCommand(commandName, args = []) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    return;
  }
  const message = JSON.stringify({ name: commandName, args: args });
  console.log("Sending command:", message);
  socket.send(message);
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

// function to convert p5 coords to machine coords 
function p5ToArduino(p5_x, p5_y) {
  // p5 (0, 0) → Arduino (30, 20)
  // p5 (200, 200) → Arduino (230, 220)
  const arduino_x = 30 + (p5_x / 200) * (230 - 30);
  const arduino_y = 20 + (p5_y / 200) * (220 - 20);
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
      freehandBuffer.strokeWeight(7);
      freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
      freehandBuffer.push();
      freehandBuffer.scale(1, -1);
      freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY);
      freehandBuffer.pop();
    }
    freehandBuffer.pop();
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
          freehandBuffer.strokeWeight(7);
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

function send() {
  // Build the complete flat list of all points across all strokes and symmetry copies
  const allPoints = [];

  for (let i = 0; i < actions.length; i++) {
    if (actions[i].type === 'stroke') {
      const strokePoints = buildStrokePoints(actions[i].strokeRef);
      for (let p of strokePoints) allPoints.push(p);
    }
  }

   const arduinoPoints = allPoints.map(p => {
    const p5x = p.x + MACHINE_X / 2;
    const p5y = p.y + MACHINE_Y / 2;
    const converted = p5ToArduino(p5x, p5y);
    return { x: converted.x, y: converted.y, z: p.z };
  });
  console.log('converted points for Arduino:', arduinoPoints);

  console.log(`total strokes (before symmetry): ${actions.filter(a => a.type === 'stroke').length}`);
  console.log(`total points to send (including all symmetry copies): ${allPoints.length}`);
  console.log('flat point list:', allPoints);
}