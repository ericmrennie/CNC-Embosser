
// question : do we need more constraints? 
let gui;
var symmetry = 4;
//let symmetry =4; // symmetry variable, defaults to 4, slider can be changed by user
//let angle = 360/symmetry;

// NEW websocket connection (instead of serial):
let socket = null;
const WS_URL = 'ws://localhost:8001/';  // ← Python server address
let gui;
var symmetry = 4; // default symmetry setting
const strokes = []; // freehand lines - each is grouped as an array of segments per mousePressed/mouseReleased
const actions = []; // records events in order

// SERIAL CONNECTION VARIABLES:
let serial;
let serialPort = "/dev/tty.usbmodem161560201";
const MACHINE_X = 300;
const MACHINE_Y = 218;
const MM_TO_PX_RATIO = 2;

// also setting speed here ! 
const speed = 15.0;

// ── ADDED: stamp system variables ────────────────────────────────────────────
let placedStamps    = [];   // [{ type, x, y }]  x/y are canvas-centre-relative
let activeStampType = null; // name of selected shape, or null (= freehand mode)
let dragIndex       = -1;   // index into placedStamps while dragging, else -1
let dragOffsetX     = 0;
let dragOffsetY     = 0;
let freehandBuffer;         // p5.Graphics — freehand strokes are drawn here so
                            // stamps can sit on top without flickering
 
// ── ADDED: shape definitions ─────────────────────────────────────────────────
// Each shape has a name and a draw(g, cx, cy, sz) function.
// g can be a p5.Graphics or `window` (global p5 scope). 
const SHAPES = [
  {
    name: "circle",
    draw(g, cx, cy, sz) {
      g.noFill(); g.stroke(0); g.strokeWeight(2);
      g.ellipse(cx, cy, sz, sz);
    }
  },
  {
    name: "square",
    draw(g, cx, cy, sz) {
      g.noFill(); g.stroke(0); g.strokeWeight(2);
      g.push(); g.rectMode(CENTER);
      g.rect(cx, cy, sz, sz);
      g.pop();
    }
  },
  {
    name: "triangle",
    draw(g, cx, cy, sz) {
      g.noFill(); g.stroke(0); g.strokeWeight(2);
      let h = sz * 0.866;
      g.triangle(cx, cy - h*0.5, cx - sz*0.5, cy + h*0.5, cx + sz*0.5, cy + h*0.5);
    }
  },
  {
    name: "star",
    draw(g, cx, cy, sz) {
      g.noFill(); g.stroke(0); g.strokeWeight(2);
      _drawStar(g, cx, cy, sz * 0.45, sz * 0.18, 5);
    }
  },
  {
    name: "diamond",
    draw(g, cx, cy, sz) {
      g.noFill(); g.stroke(0); g.strokeWeight(2);
      let h = sz * 0.55, hw = sz * 0.38;
      g.quad(cx, cy - h, cx + hw, cy, cx, cy + h, cx - hw, cy);
    }
  },
  {
    name: "cross",
    draw(g, cx, cy, sz) {
      g.noFill(); g.stroke(0); g.strokeWeight(2);
      let arm = sz * 0.45, t = sz * 0.14;
      g.beginShape();
      g.vertex(cx - t, cy - arm); g.vertex(cx + t, cy - arm);
      g.vertex(cx + t, cy - t);   g.vertex(cx + arm, cy - t);
      g.vertex(cx + arm, cy + t); g.vertex(cx + t, cy + t);
      g.vertex(cx + t, cy + arm); g.vertex(cx - t, cy + arm);
      g.vertex(cx - t, cy + t);   g.vertex(cx - arm, cy + t);
      g.vertex(cx - arm, cy - t); g.vertex(cx - t, cy - t);
      g.endShape(CLOSE);
    }
  }
];
 
function _drawStar(g, x, y, r1, r2, pts) {
  g.beginShape();
  for (let i = 0; i < pts * 2; i++) {
    let r = (i % 2 === 0) ? r1 : r2;
    let a = (i * 180 / pts) - 90;
    g.vertex(x + r * cos(a), y + r * sin(a));
  }
  g.endShape(CLOSE);
}
 
// ── ADDED: draw one stamp at (sx, sy) through all symmetry reflections ────────
// sx/sy are canvas-centre-relative. alpha (0–1) is optional, used for ghosts.
function drawStampSymmetry(sx, sy, shapeType, alpha) {
  let shape = SHAPES.find(s => s.name === shapeType);
  if (!shape) return;
  let mirror = symmetry;
  let ang    = 360 / mirror;
  let sz     = 36;
 
  push();
  translate(width / 2, height / 2);
  if (alpha !== undefined) drawingContext.globalAlpha = alpha;
  for (let i = 0; i < mirror; i++) {
    rotate(ang);
    shape.draw(window, sx, sy, sz);
    push();
    scale(1, -1);
    shape.draw(window, sx, sy, sz);
    pop();
  }
  if (alpha !== undefined) drawingContext.globalAlpha = 1.0;
  pop();
}
 
// ── ADDED: build the stamp panel in the DOM ───────────────────────────────────
let stampPanel;
 
function buildStampPanel() {
  stampPanel = createDiv('');
  stampPanel.id('stamp-panel');
  stampPanel.parent(document.body);
 
  let title = createDiv('Stamps');
  title.class('stamp-panel-title');
  title.parent(stampPanel);
 
  SHAPES.forEach(shape => {
    // Tiny preview rendered into a p5.Graphics
    let pg = createGraphics(52, 52);
    pg.background(255);
    pg.angleMode(DEGREES);
    shape.draw(pg, 26, 26, 38);

    // Force the canvas element to its exact pixel size so it isn't collapsed or scaled
    pg.canvas.style.width  = '52px';
    pg.canvas.style.height = '52px';
    pg.canvas.style.display = 'block';
 
    let btn = createDiv('');
    btn.class('stamp-btn');
    btn.id('stamp-btn-' + shape.name);
    btn.parent(stampPanel);
    btn.elt.appendChild(pg.canvas);
    btn.mousePressed(() => selectStamp(shape.name));
  });
}
 
function selectStamp(name) {
  activeStampType = (activeStampType === name) ? null : name;
  SHAPES.forEach(s => {
    let btn = select('#stamp-btn-' + s.name);
    if (!btn) return;
    if (s.name === activeStampType) btn.addClass('stamp-btn-active');
    else btn.removeClass('stamp-btn-active');
  });
}
// ─────────────────────────────────────────────────────────────────────────────
// now editing call go to for websocket, not serial
function callGoTo(x, y) {
  console.log("calling: go to at: " + x + ", " + y);
  sendCommand('go_to_xy', [x, y, speed]);
}


// now editing this for websocket 
function gotError(theerror) {
  print(theerror);
  updateConnectionStatus("Error: " + theerror);
}

// editing this for websocket
function updateConnectionStatus(status) {
document.getElementById("connection-status").innerHTML =
  `Connection to ${WS_URL} : ${status}`;
}

//  WebSocket Connection Functions
function connectWebSocket() {
  socket = new WebSocket(WS_URL);
  
  // Connection opens
  socket.onopen = () => {
    console.log("WebSocket connected to stepdance board");
    updateConnectionStatus("Connected");
  };
  
  // When message arrives FROM the board
  socket.onmessage = (event) => {
    console.log('Message from board:', event.data);
    // You could parse and display feedback here if needed
  };
  
  // If something goes wrong
  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    updateConnectionStatus("Error: " + error);
  };
  
  // When connection closes
  socket.onclose = () => {
    console.log("WebSocket disconnected");
    updateConnectionStatus("Closed");
  };
}

// Helper to send RPC commands TO the board
function sendCommand(commandName, args = []) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    return;
  }
  
  // Format matches what Python server expects: { "name": "...", "args": [...] }
  const message = JSON.stringify({ name: commandName, args: args });
  console.log("Sending command:", message);
  socket.send(message);
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  angleMode(DEGREES);
  background(230);

  // ADDED: init freehand buffer so stamps can layer on top without clearing it
  freehandBuffer = createGraphics(windowWidth, windowHeight);
  freehandBuffer.background(230);
  freehandBuffer.angleMode(DEGREES);

  // create the GUI
  gui = createGui('CNC Embosser');

  sliderRange(1, 8, 1);
  gui.addGlobals('symmetry');
  // slider = createSlider(2, 6, 2);
  // slider.position(10, 10);
  // slider.size(80);
  gui.addButton('Undo', undo);
  gui.addButton('Erase', eraseCanvas);
  
  // slider2 = createSlider(1,4,1);
  // slider2.position(10, 50);
  // slider2.size(80);
  
  // ADDED: build the stamp panel alongside the GUI
  buildStampPanel();
  
    // INIT SERIAL CONNECTION:
    // INIT SERIAL CONNECTION: - commented out because it made the UI break
  // serial = new p5.SerialPort();
  // serial.open(serialPort, { baudrate: 115200 });
  // serial.on("connected", serverConnected);
  // serial.on("data", gotData);
  // serial.on("error", gotError);
  // serial.on("open", gotOpen);
  // serial.on("close", gotClose);

  let command = `{"name": "go_to_xyz", "args": [${0}, ${0}, ${4}, ${speed}]}\n`;
  
  
  // INIT WEBSOCKET CONNECTION:
  connectWebSocket();

  // GO TO inputs:
  let inputX = createInput("0");
  inputX.parent("go-to-row");

  let inputY = createInput("0");
  inputY.parent("go-to-row");

  let buttonGoTo = createButton("Go");
  buttonGoTo.parent("go-to-row");
  buttonGoTo.mousePressed(() =>
    callGoTo(parseFloat(inputX.value()), parseFloat(inputY.value()))
  );
}

function draw() {
  let g = symmetry;
  let mirror = g;
  let angle = 360 / mirror;

  // ADDED: draw the freehand buffer first so stamps layer on top
  image(freehandBuffer, 0, 0);
 
  // ADDED: draw all placed stamps (each renders its own symmetry)
  for (let stamp of placedStamps) {
    drawStampSymmetry(stamp.x, stamp.y, stamp.type);
  }
 
  // ADDED: ghost preview — stamp following cursor before placement, or while dragging
  if (activeStampType !== null && dragIndex === -1 &&
      mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
    drawStampSymmetry(mouseX - width/2, mouseY - height/2, activeStampType, 0.35);
  }

  translate(width / 2, height / 2);
    // If the cursor is within the limits of the canvas...
  if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
    // Translate the current position and the previous position of the
    // cursor to the new coordinates set with the translate() function above.
    let lineStartX = mouseX - width / 2;
    let lineStartY = mouseY - height / 2;
    let lineEndX = pmouseX - width / 2;
    let lineEndY = pmouseY - height / 2;

    // And, if the mouse is pressed while in the canvas...
    // CHANGED: added `&& activeStampType === null` — skip freehand when a stamp is selected
    if (mouseIsPressed === true && activeStampType === null) {
      // For every reflective section the canvas is split into, draw the cursor's
      // coordinates while pressed...
      if(strokes.length > 0) strokes[strokes.length - 1].segments.push({ lineStartX, lineStartY, lineEndX, lineEndY });

      // CHANGED: draw into freehandBuffer instead of directly onto the canvas,
      // so stamps can sit on top without erasing the lines each frame.
      freehandBuffer.push();
      freehandBuffer.translate(width / 2, height / 2);
      freehandBuffer.angleMode(DEGREES);
      
      for (let i = 0; i < mirror; i++) {
        freehandBuffer.rotate(angle);  // CHANGED: freehandBuffer.rotate (was rotate)
        freehandBuffer.stroke(0);      // CHANGED: freehandBuffer.stroke (was stroke)
        freehandBuffer.strokeWeight(7);// CHANGED: freehandBuffer.strokeWeight (was strokeWeight)
        freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY); // CHANGED: freehandBuffer.line
       //goTo
 
        // ... and reflect the line within the symmetry sections as well.
        freehandBuffer.push();         // CHANGED: freehandBuffer.push (was push)
        freehandBuffer.scale(1, -1);   // CHANGED: freehandBuffer.scale (was scale)
        freehandBuffer.line(lineStartX, lineStartY, lineEndX, lineEndY); // CHANGED: freehandBuffer.line
        freehandBuffer.pop();          // CHANGED: freehandBuffer.pop (was pop)
      }
      freehandBuffer.pop();            // ADDED: close the freehandBuffer push
    }
  }
}

// ── ADDED: mouse event handlers for stamp placement and dragging ──────────────
function mousePressed() {
  if (isOverUI(mouseX, mouseY)) return;
 
  let mx = mouseX - width / 2;
  let my = mouseY - height / 2;
 
  // Check if clicking near an existing stamp — grab it for dragging
  for (let i = placedStamps.length - 1; i >= 0; i--) {
    if (dist(mx, my, placedStamps[i].x, placedStamps[i].y) < 24) {
      dragIndex   = i;
      dragOffsetX = placedStamps[i].x - mx;
      dragOffsetY = placedStamps[i].y - my;
      return;
    }
  }
 
  // Place a new stamp at the click position
  if (activeStampType !== null) {
    placedStamps.push({ type: activeStampType, x: mx, y: my });
    actions.push({ type: 'stamp', index: placedStamps.length - 1});
  } else {
    // push a new empty stroke entry onto strokes and actions, marking the beginning of a new gesture
    strokes.push({ segments: [], symmetry: symmetry });
    actions.push({ type: 'stroke', index: strokes.length - 1});
  }
}
 
function mouseDragged() {
  if (dragIndex !== -1) {
    let mx = mouseX - width / 2;
    let my = mouseY - height / 2;
    placedStamps[dragIndex].x = mx + dragOffsetX;
    placedStamps[dragIndex].y = my + dragOffsetY;
    return false; // prevent page scroll while dragging
  }
}
 
function mouseReleased() {
  dragIndex = -1;
}

// ── ADDED: resize freehand buffer when the window changes size ────────────────
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  let old = freehandBuffer;
  freehandBuffer = createGraphics(windowWidth, windowHeight);
  freehandBuffer.background(230);
  freehandBuffer.angleMode(DEGREES);
  freehandBuffer.image(old, 0, 0);
  old.remove();
}
 
// ── ADDED: helpers to prevent stamp/draw interactions inside UI panels ────────
function isOverUI(px, py) {
  let panels = [
    document.querySelector('.qs_main'),
    stampPanel ? stampPanel.elt : null,
    document.getElementById('go-to-row'),
  ];
  return panels.some(el => el && isOverElement(el, px, py));
}
 
function isOverElement(el, px, py) {
  let r = el.getBoundingClientRect();
  return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
}
// ─────────────────────────────────────────────────────────────────────────────

function undo() {
  if (actions.length === 0) return;
  let popped = actions.pop();

  if (popped.type === 'stamp') {
    placedStamps.splice(popped.index, 1);

  } else if (popped.type === 'stroke') {

    strokes.splice(popped.index, 1);

    freehandBuffer.background(230);
    freehandBuffer.push();
    freehandBuffer.translate(width / 2, height / 2);
    freehandBuffer.angleMode(DEGREES);

    for (let s = 0; s < strokes.length; s++) {
      let stroke = strokes[s];
      let mirror = stroke.symmetry;       // CHANGED: use stroke's stored symmetry, not current global
      let angle  = 360 / mirror;

      // ADDED: middle loop — iterate over every segment in this stroke
      for (let j = 0; j < stroke.segments.length; j++) {
        let seg = stroke.segments[j];     // ADDED: get the segment object

        // Inner symmetry loop — same structure as in draw()
        for (let i = 0; i < mirror; i++) {
          freehandBuffer.rotate(angle);
          freehandBuffer.stroke(0);
          freehandBuffer.strokeWeight(7);
          freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY); // CHANGED: read from seg object
          freehandBuffer.push();
          freehandBuffer.scale(1, -1);
          freehandBuffer.line(seg.lineStartX, seg.lineStartY, seg.lineEndX, seg.lineEndY); // CHANGED: read from seg object
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
  placedStamps.splice(0, placedStamps.length);
}