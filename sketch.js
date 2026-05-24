// to do : symmetry type slider - reflection, versus rotation, versus translation...

// to do : integrate stamp presets that user can drag around

// question : do we need more constraints? 

let symmetry =4; // symmetry variable, defaults to 4, slider can be changed by user
let angle = 360/symmetry;


// SERIAL CONNECTION VARIABLES:
let serial;
let serialPort = "/dev/tty.usbmodem161560201";
const MACHINE_X = 300;
const MACHINE_Y = 218;
const MM_TO_PX_RATIO = 2;

// also setting speed here ! 
const speed = 15.0;


function callGoTo(x, y) {
  console.log("calling: go to at: " + x + ", " + y);
  serial.write(`{"name": "go_to_xy", "args": [${x}, ${y}, ${speed}]}\n`);
}

function serverConnected() {
  updateConnectionStatus("Connected");
  print("Connected to Server");
}

function gotError(theerror) {
  print(theerror);
  updateConnectionStatus("Error: " + theerror);
}

function updateConnectionStatus(status) {
  document.getElementById(
    "connection-status"
  ).innerHTML = `Connection to ${serialPort} : ${status}`;
}

function gotOpen() {
  print("Serial Port is Open");
  updateConnectionStatus("Open");
}

function gotClose() {
  print("Serial Port is Closed");
  updateConnectionStatus("Closed");
}

function gotData() {
  let currentString = serial.readStringUntil("\n");
  if (currentString == "") return;
  console.log(currentString);
}



function setup() {
  createCanvas(700, 500);
  angleMode(DEGREES);
  background(255);
  
  slider = createSlider(2, 6, 2);
  slider.position(10, 10);
  slider.size(80);
  
  slider2 = createSlider(1,4,1);
  slider2.position(10, 50);
  slider2.size(80);
  
  
    // INIT SERIAL CONNECTION:
  serial = new p5.SerialPort();
  serial.open(serialPort, { baudrate: 115200 });
  serial.on("connected", serverConnected);
  serial.on("data", gotData);
  serial.on("error", gotError);
  serial.on("open", gotOpen);
  serial.on("close", gotClose);

  let command = `{"name": "go_to_xyz", "args": [${0}, ${0}, ${4}, ${speed}]}\n`;
  
  
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
  let g = slider.value();
  let symmetry = g;
  let angle = 360 / symmetry;
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
    if (mouseIsPressed === true) {
      // For every reflective section the canvas is split into, draw the cursor's
      // coordinates while pressed...
      
      for (let i = 0; i < symmetry; i++) {
        rotate(angle);
        stroke(0);
        strokeWeight(7);
        line(lineStartX, lineStartY, lineEndX, lineEndY);
       //goTo

        // ... and reflect the line within the symmetry sections as well.
        push();
        scale(1, -1);
        line(lineStartX, lineStartY, lineEndX, lineEndY);
        pop();
      }
    }
  }
}
