function Queue(maxlen = null) {
  this.front = [];
  this.back = [];
  this.maxlen = maxlen;

  this.size = function() {
    return this.front.length + this.back.length;
  }

  this.get = function(i) {
    if (i >= this.front.length) {
      return this.back[i - this.front.length];
    }
    return this.front[this.front.length - i - 1];
  }

  this.pop = function() {
    if (this.front.length == 0) {
      while (this.back.length > 0) {
        this.front.push(this.back.pop());
      }
    }
    return this.front.pop();
  }

  this.push = function(x) {
    if (this.maxlen !== null && this.size() >= this.maxlen) {
      this.pop();
    }
    this.back.push(x);
  }
}

function random(a, b, integral = false) {
  if (integral) {
    b = b + 1;
    return Math.floor(b - (b - a) * Math.random())
  } else {
    return b - (b - a) * Math.random();
  }
}

function randomColor() {
  let red = random(100, 255, true);
  let green = random(100, 255, true);
  let blue = random(100, 255, true);
  return 256*256*red + 256*green + blue;
}

function timeit(desc, f) {
  let start = window.performance.now();
  let res = f();
  let end = window.performance.now();
  console.log(desc + ':', (end - start).toFixed(3), 'ms');
  return res;
}


Module.onRuntimeInitialized = function() {
  // load the physics engine that was compiled to webassembly
  const physicsEngine = {
    add_particle: Module.cwrap('add_particle'),
    step_simulation: Module.cwrap('step_simulation'),
    get_num_particles: Module.cwrap('get_num_particles'),
    get_position_x: Module.cwrap('get_position_x'),
    get_position_y: Module.cwrap('get_position_y'),
    get_mass: Module.cwrap('get_mass'),
    get_radius: Module.cwrap('get_radius'),
    get_color: Module.cwrap('get_color'),


    set_G: Module.cwrap('set_G'),
    set_elasticity: Module.cwrap('set_elasticity'),
    set_absorb_mode: Module.cwrap('set_absorb_mode'),
  };

  // track the trails in javascript
  let particleTrails = [];

  // setup the javascript canvas
  let canvas = document.getElementById('canvas');
  let ctx = canvas.getContext('2d');

  // global state
  const steps = 100;
  const dt = 0.1 / steps;

  let initMousePos = null;
  let finalMousePos = null;
  let lastDragMousePos = null;
  let centeredParticle = null;

  let cameraX = 0;
  let cameraY = 0;
  let scale = 1;

  let nextMass = 100;
  let simSpeed = 1;
  let trailLength = 100;

  let lastFrameTime = 0;


  // Because we want to be able to move and zoom in the camera, we have different
  // physical coordinates which are used in the simulation and visual coordinates
  // which are used in the canvas
  function physicalCoordinates(visualCoords) {
    // middle of the screen
    let midx = canvas.width / 2;
    let midy = canvas.height / 2;

    let px = (visualCoords[0] - cameraX - midx) / scale + midx;
    let py = (visualCoords[1] - cameraY - midy) / scale + midy;
    return [px, py];
  }

  function visualCoordinates(physicalCoords) {
    // middle of the screen
    let midx = canvas.width / 2;
    let midy = canvas.height / 2;

    let px = midx + (physicalCoords[0] - midx) * scale + cameraX;
    let py = midy + (physicalCoords[1] - midy) * scale + cameraY;
    return [px, py];
  }


  function zoom(newScale, cx, cy) {
    if (cx === undefined && cy === undefined) {
      cx = canvas.width / 2;
      cy = canvas.height / 2;
    }

    // to zoom at a particular location, we want to make sure the physical
    // location that corresponds to where the mouse was corresponds to the
    // same visual location after the zoom
    let [physicalX, physicalY] = physicalCoordinates([cx, cy]);


    // update the global scale
    scale = newScale;

    // compute what visual location the physical location now corresponds to
    // with the new scale
    let [visualX, visualY] = visualCoordinates([physicalX, physicalY]);

    // correct the camera for the difference
    cameraX += cx - visualX;
    cameraY += cy - visualY;
  }

  // Render the state of the simulation on the canvas
  function draw() {
    let fps = Math.round(1000 / (window.performance.now() - lastFrameTime));
    lastFrameTime = window.performance.now();

    // clear the screen
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // draw the velocity vector for a new particle if it exists
    if (initMousePos && finalMousePos) {
      ctx.beginPath();
      ctx.strokeStyle = 'white';
      ctx.moveTo(initMousePos[0], initMousePos[1]);
      ctx.lineTo(finalMousePos[0], finalMousePos[1]);
      ctx.stroke();
    }

    // update the physics engine state
    physicsEngine.step_simulation(dt, simSpeed * steps);

    // draw FPS
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.fillText(fps + " FPS", canvas.width - 60, 30);

    // update the camera position if we're centering on a particle
    if (centeredParticle !== null) {
      let centerX = physicsEngine.get_position_x(centeredParticle);
      let centerY = physicsEngine.get_position_y(centeredParticle);
      let [visualX, visualY] = visualCoordinates([centerX, centerY]);

      cameraX += canvas.width / 2 - visualX;
      cameraY += canvas.height / 2 - visualY;
    }


    // draw particles
    let n = physicsEngine.get_num_particles();

    // draw the trails first so that particles are drawn on top
    for (let i = 0; i < n; i++) {
      let trail = particleTrails[i];

      // draw the trail. TODO: optimize this so that the entire thing
      // doesn't have to be redrawn???
      ctx.beginPath();
      ctx.strokeStyle = 'white';

      for (let j = 0; j < trail.size(); ++j) {
        let [tx, ty] = visualCoordinates(trail.get(j));
        if (j === 0) {
          ctx.moveTo(tx, ty);
        } else {
          ctx.lineTo(tx, ty);
        }
      }
      ctx.stroke();
    }

    for (let i = 0; i < n; i++) {
      // extract state from the physics engine
      let px_phys = physicsEngine.get_position_x(i);
      let py_phys = physicsEngine.get_position_y(i);
      let [px, py] = visualCoordinates([px_phys, py_phys]);
      let radius = physicsEngine.get_radius(i) * scale;
      let color = physicsEngine.get_color(i);

      // compute the RGB values of the color
      let red = color >>> 16;
      let green = (color >>> 8) % 256
      let blue = color % 256;

      // add the physical coordinates onto the trail.
      // remove from the trail if the particle doesn't appear on screen
      if (radius === 0) {
        particleTrails[i].pop();
      } else {
        particleTrails[i].push([px_phys, py_phys]);
      }

      // draw the circle
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = `rgb(${red}, ${blue}, ${green})`;
      ctx.fill();

    }
  }

  // set up event listeners for the canvas
  canvas.onmousedown = function(event) {
    let mx = event.pageX - this.offsetLeft;
    let my = event.pageY - this.offsetTop;

    // left click. create a velocity vector
    if (event.which === 1) {
      initMousePos = [mx, my];
      finalMousePos = null;
    }

    // right click. start dragging
    else if (event.which === 3) {
      lastDragMousePos = [mx, my];
    }

    // middle click. center on the particle at the mouse position
    else if (event.which === 2) {
      let [px, py] = physicalCoordinates([mx, my]);
      let n = physicsEngine.get_num_particles();
      for (let i = 0; i < n; i++) {
        let x = physicsEngine.get_position_x(i);
        let y = physicsEngine.get_position_x(i);

        let dist = Math.sqrt((x - px)**2 + (y - py)**2);
        if (dist < physicsEngine.get_radius(i)) {
          centeredParticle = i;
          break;
        }
      }
    }
  };

  canvas.onmousemove = function(event) {
    let mx = event.pageX - this.offsetLeft;
    let my = event.pageY - this.offsetTop;

    // left click. moving around velocity vector
    if (event.which === 1 && initMousePos !== null) {
      finalMousePos = [mx, my];
    }

    // right click. moving around the camera
    else if (event.which === 3 && lastDragMousePos !== null) {
      cameraX += mx - lastDragMousePos[0];
      cameraY += my - lastDragMousePos[1];
      lastDragMousePos = [mx, my];
    }
  };

  canvas.onmouseleave = function() {
    finalMousePos = finalMousePos || initMousePos;

    if (initMousePos !== null) {
      // computing details about the particle for the simulation
      let [px, py] = physicalCoordinates(initMousePos);
      let [px_end, py_end] = physicalCoordinates(finalMousePos);

      let vx = (px_end - px) / 5;
      let vy = (py_end - py) / 5;
      let radius = Math.sqrt(nextMass);
      let color = randomColor();

      physicsEngine.add_particle(px, py, vx, vy, nextMass, radius, color);
      particleTrails.push(new Queue(trailLength));
    }

    initMousePos = finalMousePos = null;
    lastDragMousePos = null;
  }

  canvas.onmouseup = function() {
    canvas.onmouseleave();
  }

  canvas.onwheel = function(event) {
    let mx = event.pageX - this.offsetLeft;
    let my = event.pageY - this.offsetTop;

    if (event.deltaY > 0) {
      zoom(scale / 1.07, mx, my);
    } else if (event.deltaY < 0) {
      zoom(scale * 1.07, mx, my);
    }
  }

  // set up event listeners for keyboard inputs
  window.onkeydown = function(event) {
    switch (event.which) {
        case 38: cameraY += 10; break;
        case 40: cameraY -= 10; break;
        case 37: cameraX += 10; break;
        case 39: cameraX -= 10; break;
        case 90: zoom(scale * 1.1); break;
        case 88: zoom(scale / 1.1); break;
        case 67:
          // disable centering
          if (centeredParticle !== null) {
            centeredParticle = null;
          }

          // center on the most massive particle
          else {
            let n = physicsEngine.get_num_particles();
            let biggestMass = 0;
            for (let i = 0; i < n; i++) {
              let mass = physicsEngine.get_mass(i);
              if (mass > biggestMass) {
                centeredParticle = i;
                biggestMass = mass;
              }
            }
          }
          break;
    }
  };

  // set up event listeners for settings
  document.getElementsByName('simspeed')[0].onchange = function() {
    simSpeed = parseFloat(this.value);
  };

  document.getElementsByName('mass')[0].onchange = function() {
    nextMass = parseFloat(this.value) * parseFloat(this.value);
  };

  document.getElementsByName('traillength')[0].onchange = function() {
    trailLength = parseInt(this.value);
    for (let queue of particleTrails) {
      while (queue.size() > trailLength) {
        queue.pop();
      }
      queue.maxlen = trailLength;
    }
  };

  document.getElementsByName('elasticity')[0].onchange = function() {
    physicsEngine.set_elasticity(parseFloat(this.value));
  };

  document.getElementsByName('gravity')[0].onchange = function() {
    physicsEngine.set_G(200 * parseFloat(this.value));
  };

  document.getElementsByName('absorbmode')[0].onchange = function() {
    physicsEngine.set_absorb_mode(this.checked);
  };

  // set up the drawing loop
  setInterval(draw, 1000 / 60);
};
