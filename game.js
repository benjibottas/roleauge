// ==========================================
// GAME INITIALIZATION & SETUP
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Input tracking
const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};

// Listeners for keyboard input
window.addEventListener('keydown', (e) => { if(keys.hasOwnProperty(e.key)) keys[e.key] = true; });
window.addEventListener('keyup', (e) => { if(keys.hasOwnProperty(e.key)) keys[e.key] = false; });

// Score tracking
let scoreBlue = 0;
let scoreOrange = 0;

// ==========================================
// GAME ENTITIES
// ==========================================

// The Player's Car (Blue Team)
const car = {
    x: 100,
    y: 250,
    radius: 15, // Used for simplified circle-collision calculations
    angle: 0,
    speed: 0,
    maxSpeed: 7,
    acceleration: 0.2,
    friction: 0.96, // Simulates drag
    turnSpeed: 0.08
};

// The Ball
const ball = {
    x: 400,
    y: 250,
    radius: 20,
    vx: 0, // Velocity X
    vy: 0, // Velocity Y
    friction: 0.98, // Rolls to a stop
    restitution: 0.8 // Bounciness against walls
};

// Goal Dimensions
const goalHeight = 140;
const goalY1 = canvas.height / 2 - goalHeight / 2;
const goalY2 = canvas.height / 2 + goalHeight / 2;

// ==========================================
// PHYSICS & LOGIC
// ==========================================

function updatePhysics() {
    // --- CAR MOVEMENT ---
    if (keys.ArrowUp) {
        car.speed += car.acceleration;
    } else if (keys.ArrowDown) {
        car.speed -= car.acceleration;
    }

    // Apply friction and cap speed
    car.speed *= car.friction;
    if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
    if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2; // Reverse is slower

    // Steering (only turn if moving)
    if (Math.abs(car.speed) > 0.5) {
        let direction = car.speed > 0 ? 1 : -1;
        if (keys.ArrowLeft) car.angle -= car.turnSpeed * direction;
        if (keys.ArrowRight) car.angle += car.turnSpeed * direction;
    }

    // Update car position based on angle and speed
    car.x += Math.cos(car.angle) * car.speed;
    car.y += Math.sin(car.angle) * car.speed;

    // Keep car inside screen bounds
    car.x = Math.max(car.radius, Math.min(canvas.width - car.radius, car.x));
    car.y = Math.max(car.radius, Math.min(canvas.height - car.radius, car.y));

    // --- BALL MOVEMENT ---
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Apply rolling friction
    ball.vx *= ball.friction;
    ball.vy *= ball.friction;

    // Ball Wall Collisions (Top & Bottom)
    if (ball.y - ball.radius < 0) {
        ball.y = ball.radius;
        ball.vy *= -ball.restitution;
    } else if (ball.y + ball.radius > canvas.height) {
        ball.y = canvas.height - ball.radius;
        ball.vy *= -ball.restitution;
    }

    // Ball Wall Collisions (Left & Right) / Goal Detection
    if (ball.x - ball.radius < 0) {
        if (ball.y > goalY1 && ball.y < goalY2) {
            scoreOrange++;
            resetField();
        } else {
            ball.x = ball.radius;
            ball.vx *= -ball.restitution;
        }
    } else if (ball.x + ball.radius > canvas.width) {
        if (ball.y > goalY1 && ball.y < goalY2) {
            scoreBlue++;
            resetField();
        } else {
            ball.x = canvas.width - ball.radius;
            ball.vx *= -ball.restitution;
        }
    }

    // --- CAR & BALL COLLISION ---
    // Using simple circle-to-circle collision detection
    let dx = ball.x - car.x;
    let dy = ball.y - car.y;
    let distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < car.radius + ball.radius) {
        // Resolve overlap
        let overlap = (car.radius + ball.radius) - distance;
        let nx = dx / distance; // Normal X
        let ny = dy / distance; // Normal Y

        ball.x += nx * overlap;
        ball.y += ny * overlap;

        // Transfer momentum from car to ball
        let pushForce = Math.max(Math.abs(car.speed) * 1.5, 3); // Minimum push force even if slow
        ball.vx += nx * pushForce;
        ball.vy += ny * pushForce;
        
        // Car loses some speed on impact
        car.speed *= 0.5;
    }
}

function resetField() {
    // Update Score UI
    document.getElementById('score-blue').innerText = scoreBlue;
    document.getElementById('score-orange').innerText = scoreOrange;

    // Reset Positions
    car.x = 100;
    car.y = 250;
    car.angle = 0;
    car.speed = 0;

    ball.x = 400;
    ball.y = 250;
    ball.vx = 0;
    ball.vy = 0;
}

// ==========================================
// RENDERING
// ==========================================

function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}

function drawCircle(x, y, radius, color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.closePath();
}

function drawGame() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Pitch Markings (Center line & circle)
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 60, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Goals (Left: Blue, Right: Orange)
    drawRect(0, goalY1, 10, goalHeight, "#3498db");
    drawRect(canvas.width - 10, goalY1, 10, goalHeight, "#e67e22");

    // Draw Ball
    drawCircle(ball.x, ball.y, ball.radius, "#bdc3c7");
    // Draw an inner pattern to see it rolling
    ctx.fillStyle = "#7f8c8d";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius / 2, 0, Math.PI * 2);
    ctx.fill();

    // Draw Car
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Draw car body (centered on its coordinate)
    drawRect(-15, -10, 30, 20, "#3498db");
    // Draw headlights to show direction
    drawRect(10, -8, 5, 4, "yellow");
    drawRect(10, 4, 5, 4, "yellow");
    ctx.restore();
}

// ==========================================
// MAIN GAME LOOP
// ==========================================

function gameLoop() {
    updatePhysics();
    drawGame();
    requestAnimationFrame(gameLoop); // Keep looping
}

// Start the game
gameLoop();
