import { WORLD, createGame, resetGame, snapshot, startGame, stepGame, togglePause } from "./engine.mjs";

const canvas = document.querySelector("#game");
const context = canvas.getContext("2d");
const scoreNode = document.querySelector("#score");
const energyNode = document.querySelector("#energy-value");
const energyBar = document.querySelector("#energy-bar");
const comboNode = document.querySelector("#combo");
const levelNode = document.querySelector("#level-chip");
const intro = document.querySelector("#intro");
const paused = document.querySelector("#paused");
const gameOver = document.querySelector("#game-over");
const pauseButton = document.querySelector("#pause-button");
const liveStatus = document.querySelector("#live-status");
const finalScore = document.querySelector("#final-score");
const finalCombo = document.querySelector("#final-combo");

let state = createGame();
let previousTime = performance.now();
let pointerX = null;
const pressed = new Set();
const stars = Array.from({ length: 74 }, (_, index) => ({
  x: (index * 137.2) % WORLD.width,
  y: (index * index * 31.7) % WORLD.height,
  size: index % 9 === 0 ? 1.6 : 0.7,
  speed: 16 + (index % 5) * 9
}));

function hexPath(x, y, radius, angle = 0) {
  context.beginPath();
  for (let point = 0; point < 6; point += 1) {
    const theta = angle + point * Math.PI / 3;
    const method = point === 0 ? "moveTo" : "lineTo";
    context[method](x + Math.cos(theta) * radius, y + Math.sin(theta) * radius);
  }
  context.closePath();
}

function drawBackground(time) {
  const gradient = context.createLinearGradient(0, 0, 0, WORLD.height);
  gradient.addColorStop(0, "#0b1020");
  gradient.addColorStop(0.58, "#080b14");
  gradient.addColorStop(1, "#05070c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, WORLD.width, WORLD.height);

  context.fillStyle = "rgba(145, 174, 255, .65)";
  for (const star of stars) {
    const y = (star.y + time * star.speed) % WORLD.height;
    context.globalAlpha = 0.25 + (star.size / 2) * 0.45;
    context.fillRect(star.x, y, star.size, star.size * 2.2);
  }
  context.globalAlpha = 1;

  const horizon = 218;
  context.strokeStyle = "rgba(85, 106, 157, .16)";
  context.lineWidth = 1;
  for (let line = 0; line < 12; line += 1) {
    const progress = line / 11;
    const y = horizon + Math.pow(progress, 1.8) * (WORLD.height - horizon);
    context.beginPath(); context.moveTo(0, y); context.lineTo(WORLD.width, y); context.stroke();
  }
  for (let line = -12; line <= 12; line += 1) {
    context.beginPath();
    context.moveTo(WORLD.width / 2 + line * 18, horizon);
    context.lineTo(WORLD.width / 2 + line * 92, WORLD.height);
    context.stroke();
  }
  const glow = context.createRadialGradient(WORLD.width / 2, horizon, 0, WORLD.width / 2, horizon, 360);
  glow.addColorStop(0, "rgba(76, 113, 255, .09)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow; context.fillRect(0, 0, WORLD.width, WORLD.height);
}

function drawPulse(pulse) {
  context.save();
  context.shadowBlur = 24; context.shadowColor = "#6df7e7";
  context.strokeStyle = "#6df7e7"; context.lineWidth = 2;
  context.beginPath(); context.arc(pulse.x, pulse.y, pulse.radius + Math.sin(pulse.phase) * 2, 0, Math.PI * 2); context.stroke();
  context.fillStyle = "rgba(109,247,231,.25)";
  context.beginPath(); context.arc(pulse.x, pulse.y, 5, 0, Math.PI * 2); context.fill();
  context.restore();
}

function drawHazard(hazard) {
  context.save();
  context.shadowBlur = 20; context.shadowColor = "rgba(255, 73, 104, .75)";
  context.fillStyle = "rgba(255, 75, 105, .16)"; context.strokeStyle = "#ff5d73"; context.lineWidth = 2;
  hexPath(hazard.x, hazard.y, hazard.radius, hazard.angle); context.fill(); context.stroke();
  context.strokeStyle = "rgba(255,255,255,.32)"; context.lineWidth = 1;
  hexPath(hazard.x, hazard.y, hazard.radius * .48, -hazard.angle); context.stroke();
  context.restore();
}

function drawPlayer(player) {
  context.save();
  context.translate(player.x, player.y);
  context.shadowBlur = 28; context.shadowColor = "#6df7e7";
  context.fillStyle = "rgba(109,247,231,.12)";
  context.beginPath(); context.ellipse(0, 20, 24, 7, 0, 0, Math.PI * 2); context.fill();
  const trail = context.createLinearGradient(0, 9, 0, 50);
  trail.addColorStop(0, "rgba(109,247,231,.8)"); trail.addColorStop(1, "rgba(109,247,231,0)");
  context.fillStyle = trail; context.beginPath(); context.moveTo(-6, 8); context.lineTo(0, 50 + Math.random() * 5); context.lineTo(6, 8); context.fill();
  context.fillStyle = "#dffffb"; context.strokeStyle = "#6df7e7"; context.lineWidth = 2;
  context.beginPath(); context.moveTo(0, -22); context.lineTo(19, 18); context.lineTo(0, 10); context.lineTo(-19, 18); context.closePath(); context.fill(); context.stroke();
  context.fillStyle = "#101827"; context.beginPath(); context.moveTo(0, -11); context.lineTo(7, 9); context.lineTo(-7, 9); context.closePath(); context.fill();
  context.restore();
}

function draw() {
  const shakeX = state.shake ? (Math.random() - 0.5) * state.shake * 11 : 0;
  const shakeY = state.shake ? (Math.random() - 0.5) * state.shake * 7 : 0;
  context.save(); context.translate(shakeX, shakeY);
  drawBackground(state.elapsed);
  for (const pulse of state.pulses) drawPulse(pulse);
  for (const hazard of state.hazards) drawHazard(hazard);
  drawPlayer(state.player);
  context.restore();
  if (state.flash) {
    context.fillStyle = `rgba(255, 63, 90, ${state.flash * .22})`;
    context.fillRect(0, 0, WORLD.width, WORLD.height);
  }
}

function renderUi() {
  const view = snapshot(state);
  scoreNode.textContent = String(view.score).padStart(6, "0");
  energyNode.textContent = `${view.energy}%`;
  energyBar.style.width = `${view.energy}%`;
  energyBar.style.background = view.energy < 35 ? "#ff5d73" : "";
  comboNode.textContent = `×${view.combo}`;
  levelNode.textContent = `SECTOR ${String(view.level).padStart(2, "0")}`;
  canvas.dataset.mode = view.mode;
  canvas.dataset.playerX = String(view.playerX);
  canvas.dataset.score = String(view.score);
  intro.classList.toggle("hidden", view.mode !== "ready");
  paused.classList.toggle("hidden", view.mode !== "paused");
  gameOver.classList.toggle("hidden", view.mode !== "gameover");
  pauseButton.disabled = !["running", "paused"].includes(view.mode);
  if (view.mode === "gameover") {
    finalScore.textContent = String(view.score).padStart(6, "0");
    finalCombo.textContent = `×${view.bestCombo}`;
  }
}

function direction() {
  const left = pressed.has("ArrowLeft") || pressed.has("KeyA") || pressed.has("touch-left");
  const right = pressed.has("ArrowRight") || pressed.has("KeyD") || pressed.has("touch-right");
  return Number(right) - Number(left);
}

function loop(now) {
  const dt = (now - previousTime) / 1000;
  previousTime = now;
  stepGame(state, { direction: direction(), pointerX }, dt);
  draw(); renderUi(); requestAnimationFrame(loop);
}

function begin() {
  if (state.mode === "gameover") state = resetGame(state);
  startGame(state); pauseButton.focus({ preventScroll: true });
  liveStatus.textContent = "Run started. Collect cyan pulses and avoid coral hazards.";
}

function restart() {
  state = resetGame(state); startGame(state);
  liveStatus.textContent = "New run started.";
}

function pause() {
  togglePause(state);
  liveStatus.textContent = state.mode === "paused" ? "Run paused." : "Run resumed.";
}

document.querySelector("#start-button").addEventListener("click", begin);
document.querySelector("#restart-button").addEventListener("click", restart);
document.querySelector("#resume-button").addEventListener("click", pause);
pauseButton.addEventListener("click", pause);

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "Space" && state.mode === "ready") begin();
  else if (event.code === "KeyP" && ["running", "paused"].includes(state.mode)) pause();
  else if (event.code === "KeyR" && state.mode === "gameover") restart();
  pressed.add(event.code);
});
window.addEventListener("keyup", (event) => pressed.delete(event.code));
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" || event.buttons) {
    const bounds = canvas.getBoundingClientRect();
    pointerX = ((event.clientX - bounds.left) / bounds.width) * WORLD.width;
  }
});
canvas.addEventListener("pointerup", () => { pointerX = null; });
canvas.addEventListener("pointercancel", () => { pointerX = null; });

for (const [selector, key] of [["#left-button", "touch-left"], ["#right-button", "touch-right"]]) {
  const button = document.querySelector(selector);
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); pressed.add(key); });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, () => pressed.delete(key));
}

window.__pulseRunner = { getState: () => snapshot(state), begin, pause, restart };
draw(); renderUi(); requestAnimationFrame(loop);
