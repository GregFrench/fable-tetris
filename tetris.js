"use strict";

/* ============================================================
 * Tetris — guideline-style implementation
 * SRS rotation + wall kicks, 7-bag randomizer, hold, ghost,
 * T-spin detection, lock delay, DAS/ARR, combo & back-to-back.
 * ============================================================ */

// ---------- Constants ----------

const COLS = 10;
const ROWS = 20;
const HIDDEN_ROWS = 2; // spawn area above the visible field
const TOTAL_ROWS = ROWS + HIDDEN_ROWS;
const CELL = 32;

const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
const DAS_MS = 150; // delayed auto shift
const ARR_MS = 40; // auto repeat rate
const SOFT_DROP_MS = 35;
const CLEAR_ANIM_MS = 260;

// Gravity: ms per row for levels 1..20 (then constant)
const GRAVITY_TABLE = [
  800, 717, 633, 550, 467, 383, 300, 217, 133, 100,
  83, 83, 67, 67, 50, 50, 33, 33, 17, 17,
];

const COLORS = {
  I: { main: "#00d4ff", light: "#7deeff", dark: "#0093b3" },
  O: { main: "#ffd500", light: "#ffe97d", dark: "#b39500" },
  T: { main: "#9d4edd", light: "#c99aee", dark: "#6b2e9e" },
  S: { main: "#2ecc71", light: "#82e3ab", dark: "#1e8c4d" },
  Z: { main: "#ff5964", light: "#ff9ba2", dark: "#c23540" },
  J: { main: "#3a86ff", light: "#8ab8ff", dark: "#2557b3" },
  L: { main: "#ff9f1c", light: "#ffc878", dark: "#b36c0f" },
};

// Shapes as rotation-state-0 matrices (SRS layout)
const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

// SRS wall-kick data. Key: "from>to" rotation states (0,R=1,2,L=3)
const KICKS_JLSTZ = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const KICKS_I = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

// ---------- Utilities ----------

function rotateMatrix(m, dir) {
  const n = m.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (dir > 0) out[x][n - 1 - y] = m[y][x];
      else out[n - 1 - x][y] = m[y][x];
    }
  }
  return out;
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------- Audio ----------

class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = false;
    this.musicTimer = null;
    this.noteIndex = 0;

    // Korobeiniki (Tetris theme), [midi note or null, sixteenths]
    this.melody = [
      [76, 4], [71, 2], [72, 2], [74, 4], [72, 2], [71, 2],
      [69, 4], [69, 2], [72, 2], [76, 4], [74, 2], [72, 2],
      [71, 4], [71, 2], [72, 2], [74, 4], [76, 4],
      [72, 4], [69, 4], [69, 4], [null, 4],
      [null, 2], [74, 4], [77, 2], [81, 4], [79, 2], [77, 2],
      [76, 6], [72, 2], [76, 4], [74, 2], [72, 2],
      [71, 4], [71, 2], [72, 2], [74, 4], [76, 4],
      [72, 4], [69, 4], [69, 4], [null, 4],
    ];
  }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  blip(freq, dur = 0.07, type = "square", vol = 0.5, slide = 0) {
    if (!this.enabled) return;
    this.ensureCtx();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur = 0.15, vol = 0.3) {
    if (!this.enabled) return;
    this.ensureCtx();
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  move() { this.blip(220, 0.04, "square", 0.18); }
  rotate() { this.blip(330, 0.05, "square", 0.22); }
  softDrop() { this.blip(180, 0.03, "square", 0.12); }
  hardDrop() { this.noise(0.12, 0.35); this.blip(120, 0.08, "triangle", 0.4, -60); }
  lock() { this.blip(150, 0.06, "triangle", 0.3); }
  hold() { this.blip(440, 0.06, "sine", 0.3); }
  clear(n) {
    const base = [0, 400, 480, 560, 660][n] || 660;
    for (let i = 0; i < n + 1; i++) {
      setTimeout(() => this.blip(base + i * 120, 0.09, "square", 0.3), i * 55);
    }
    if (n === 4) this.noise(0.25, 0.25);
  }
  tspin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.1, "sine", 0.35), i * 70));
  }
  levelUp() {
    [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.blip(f, 0.12, "square", 0.3), i * 80));
  }
  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, "sawtooth", 0.25), i * 160));
    this.stopMusic();
  }

  startMusic() {
    if (!this.enabled || this.musicOn) return;
    this.ensureCtx();
    this.musicOn = true;
    this.noteIndex = 0;
    this.scheduleNote();
  }

  scheduleNote() {
    if (!this.musicOn) return;
    const [midi, sixteenths] = this.melody[this.noteIndex];
    const dur = sixteenths * 90; // ms per sixteenth
    if (midi !== null && this.enabled) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      this.blip(freq, (dur / 1000) * 0.85, "square", 0.09);
      this.blip(freq / 2, (dur / 1000) * 0.85, "triangle", 0.07);
    }
    this.noteIndex = (this.noteIndex + 1) % this.melody.length;
    this.musicTimer = setTimeout(() => this.scheduleNote(), dur);
  }

  stopMusic() {
    this.musicOn = false;
    clearTimeout(this.musicTimer);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopMusic();
    return this.enabled;
  }
}

// ---------- Game ----------

class Game {
  constructor() {
    this.boardCanvas = document.getElementById("board-canvas");
    this.boardCtx = this.boardCanvas.getContext("2d");
    this.holdCanvas = document.getElementById("hold-canvas");
    this.holdCtx = this.holdCanvas.getContext("2d");
    this.nextCanvas = document.getElementById("next-canvas");
    this.nextCtx = this.nextCanvas.getContext("2d");

    this.el = {
      score: document.getElementById("score"),
      highscore: document.getElementById("highscore"),
      level: document.getElementById("level"),
      lines: document.getElementById("lines"),
      time: document.getElementById("time"),
      overlay: document.getElementById("overlay"),
      overlayTitle: document.getElementById("overlay-title"),
      overlaySub: document.getElementById("overlay-sub"),
      actionText: document.getElementById("action-text"),
    };

    this.sound = new Sound();
    this.highScore = Number(localStorage.getItem("tetris-highscore") || 0);
    this.el.highscore.textContent = this.highScore.toLocaleString();

    this.state = "menu"; // menu | playing | paused | gameover
    this.keys = {};
    this.particles = [];
    this.shake = 0;

    this.setupHiDPI();
    this.bindInput();
    this.resetGame();
    this.showOverlay("TETRIS", "Press <kbd>Enter</kbd> to play");

    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  setupHiDPI() {
    const dpr = window.devicePixelRatio || 1;
    for (const [canvas, ctx] of [
      [this.boardCanvas, this.boardCtx],
      [this.holdCanvas, this.holdCtx],
      [this.nextCanvas, this.nextCtx],
    ]) {
      const w = canvas.width;
      const h = canvas.height;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }
  }

  resetGame() {
    this.grid = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(null));
    this.bag = [];
    this.queue = [];
    while (this.queue.length < 5) this.queue.push(this.drawFromBag());
    this.holdType = null;
    this.holdUsed = false;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.backToBack = false;
    this.dropTimer = 0;
    this.softDropTimer = 0;
    this.lockTimer = null;
    this.lockResets = 0;
    this.clearing = null; // { rows: [], t: 0 }
    this.playTime = 0;
    this.particles = [];
    this.shake = 0;
    this.spawnPiece();
    this.updateStats();
  }

  drawFromBag() {
    if (this.bag.length === 0) {
      this.bag = ["I", "O", "T", "S", "Z", "J", "L"];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  spawnPiece(type) {
    type = type || this.queue.shift();
    while (this.queue.length < 5) this.queue.push(this.drawFromBag());

    const matrix = SHAPES[type].map((r) => [...r]);
    this.piece = {
      type,
      matrix,
      rot: 0,
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: 0, // top of the hidden spawn zone
      lastMoveWasRotation: false,
      lastKickIndex: 0,
    };

    this.holdUsed = false;
    this.lockTimer = null;
    this.lockResets = 0;
    this.dropTimer = 0;

    if (this.collides(this.piece.matrix, this.piece.x, this.piece.y)) {
      this.gameOver();
    }
  }

  collides(matrix, px, py) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const gx = px + x;
        const gy = py + y;
        if (gx < 0 || gx >= COLS || gy >= TOTAL_ROWS) return true;
        if (gy >= 0 && this.grid[gy][gx]) return true;
      }
    }
    return false;
  }

  tryMove(dx, dy) {
    const p = this.piece;
    if (!this.collides(p.matrix, p.x + dx, p.y + dy)) {
      p.x += dx;
      p.y += dy;
      p.lastMoveWasRotation = false;
      if (dx !== 0) this.onSuccessfulShift();
      return true;
    }
    return false;
  }

  onSuccessfulShift() {
    // Lock delay reset on movement while grounded
    if (this.isGrounded() && this.lockTimer !== null && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  tryRotate(dir) {
    const p = this.piece;
    if (p.type === "O") return false;
    const from = p.rot;
    const to = (p.rot + dir + 4) % 4;
    const rotated = rotateMatrix(p.matrix, dir);
    const kicks = (p.type === "I" ? KICKS_I : KICKS_JLSTZ)[`${from}>${to}`];

    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      // SRS kick y is "up positive"; our y grows downward
      if (!this.collides(rotated, p.x + kx, p.y - ky)) {
        p.matrix = rotated;
        p.x += kx;
        p.y -= ky;
        p.rot = to;
        p.lastMoveWasRotation = true;
        p.lastKickIndex = i;
        this.onSuccessfulShift();
        this.sound.rotate();
        return true;
      }
    }
    return false;
  }

  isGrounded() {
    return this.collides(this.piece.matrix, this.piece.x, this.piece.y + 1);
  }

  ghostY() {
    const p = this.piece;
    let y = p.y;
    while (!this.collides(p.matrix, p.x, y + 1)) y++;
    return y;
  }

  hold() {
    if (this.holdUsed) return;
    this.sound.hold();
    const current = this.piece.type;
    if (this.holdType) {
      const swap = this.holdType;
      this.holdType = current;
      this.spawnPiece(swap);
    } else {
      this.holdType = current;
      this.spawnPiece();
    }
    this.holdUsed = true;
  }

  hardDrop() {
    const p = this.piece;
    const gy = this.ghostY();
    const dist = gy - p.y;
    p.y = gy;
    this.score += dist * 2;
    this.sound.hardDrop();
    this.shake = 6;
    this.spawnDropParticles();
    this.lockPiece();
  }

  spawnDropParticles() {
    const p = this.piece;
    const color = COLORS[p.type].light;
    for (let y = 0; y < p.matrix.length; y++) {
      for (let x = 0; x < p.matrix[y].length; x++) {
        if (!p.matrix[y][x]) continue;
        const px = (p.x + x + 0.5) * CELL;
        const py = (p.y + y - HIDDEN_ROWS + 1) * CELL;
        for (let i = 0; i < 2; i++) {
          this.particles.push({
            x: px + (Math.random() - 0.5) * CELL,
            y: py,
            vx: (Math.random() - 0.5) * 2,
            vy: -(Math.random() * 2.5 + 0.5),
            life: 1,
            decay: 0.03 + Math.random() * 0.03,
            size: 2 + Math.random() * 3,
            color,
          });
        }
      }
    }
  }

  // 3-corner T-spin detection
  detectTSpin() {
    const p = this.piece;
    if (p.type !== "T" || !p.lastMoveWasRotation) return null;
    const cx = p.x + 1;
    const cy = p.y + 1;
    const occupied = ([x, y]) =>
      x < 0 || x >= COLS || y >= TOTAL_ROWS || (y >= 0 && this.grid[y][x]);

    // Front corners depend on rotation state (the two the T points toward)
    const cornersByRot = {
      0: { front: [[cx - 1, cy - 1], [cx + 1, cy - 1]], back: [[cx - 1, cy + 1], [cx + 1, cy + 1]] },
      1: { front: [[cx + 1, cy - 1], [cx + 1, cy + 1]], back: [[cx - 1, cy - 1], [cx - 1, cy + 1]] },
      2: { front: [[cx - 1, cy + 1], [cx + 1, cy + 1]], back: [[cx - 1, cy - 1], [cx + 1, cy - 1]] },
      3: { front: [[cx - 1, cy - 1], [cx - 1, cy + 1]], back: [[cx + 1, cy - 1], [cx + 1, cy + 1]] },
    };
    const { front, back } = cornersByRot[p.rot];
    const frontCount = front.filter(occupied).length;
    const backCount = back.filter(occupied).length;

    if (frontCount + backCount < 3) return null;
    // Full T-spin: both front corners filled, or the last kick was the far kick (index 4)
    if (frontCount === 2 || p.lastKickIndex === 4) return "full";
    return "mini";
  }

  lockPiece() {
    const p = this.piece;
    const tspin = this.detectTSpin();

    let topOut = true;
    for (let y = 0; y < p.matrix.length; y++) {
      for (let x = 0; x < p.matrix[y].length; x++) {
        if (!p.matrix[y][x]) continue;
        const gy = p.y + y;
        const gx = p.x + x;
        if (gy >= 0) this.grid[gy][gx] = p.type;
        if (gy >= HIDDEN_ROWS) topOut = false;
      }
    }
    if (topOut) {
      this.gameOver();
      return;
    }

    const fullRows = [];
    for (let y = 0; y < TOTAL_ROWS; y++) {
      if (this.grid[y].every((c) => c)) fullRows.push(y);
    }

    if (fullRows.length > 0) {
      this.clearing = { rows: fullRows, t: 0, tspin };
      this.sound.clear(fullRows.length);
      this.spawnClearParticles(fullRows);
    } else {
      this.sound.lock();
      this.applyLockScoring(0, tspin);
      this.spawnPiece();
    }
  }

  spawnClearParticles(rows) {
    for (const row of rows) {
      for (let x = 0; x < COLS; x++) {
        const type = this.grid[row][x];
        const color = type ? COLORS[type].light : "#fff";
        for (let i = 0; i < 3; i++) {
          this.particles.push({
            x: (x + 0.5) * CELL,
            y: (row - HIDDEN_ROWS + 0.5) * CELL,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.7) * 5,
            life: 1,
            decay: 0.02 + Math.random() * 0.02,
            size: 2 + Math.random() * 4,
            color,
          });
        }
      }
    }
  }

  applyLockScoring(cleared, tspin) {
    let points = 0;
    let action = "";
    let difficult = false;

    if (tspin === "full") {
      points = [400, 800, 1200, 1600][cleared];
      action = cleared > 0 ? `T-SPIN ${["", "SINGLE", "DOUBLE", "TRIPLE"][cleared]}!` : "T-SPIN!";
      difficult = cleared > 0;
      this.sound.tspin();
    } else if (tspin === "mini") {
      points = [100, 200, 400][cleared] || 400;
      action = cleared > 0 ? "T-SPIN MINI!" : "";
      difficult = cleared > 0;
      if (cleared > 0) this.sound.tspin();
    } else if (cleared > 0) {
      points = [0, 100, 300, 500, 800][cleared];
      action = ["", "", "DOUBLE!", "TRIPLE!", "TETRIS!"][cleared];
      difficult = cleared === 4;
    }

    if (cleared > 0) {
      this.combo++;
      if (this.combo >= 1) {
        points += 50 * this.combo;
        if (this.combo >= 2) action += (action ? " " : "") + `COMBO ×${this.combo}`;
      }
      if (difficult && this.backToBack) {
        points = Math.floor(points * 1.5);
        action = "B2B " + action;
      }
      if (difficult) this.backToBack = true;
      else if (cleared > 0 && !tspin) this.backToBack = false;
    } else {
      this.combo = -1;
    }

    this.score += points * this.level;

    if (cleared > 0) {
      this.lines += cleared;
      const newLevel = Math.floor(this.lines / 10) + 1;
      if (newLevel > this.level) {
        this.level = newLevel;
        this.sound.levelUp();
        this.flashAction(`LEVEL ${this.level}`);
      }
    }

    if (action) this.flashAction(action);
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem("tetris-highscore", String(this.highScore));
    }
    this.updateStats();
  }

  finishClearing() {
    const { rows, tspin } = this.clearing;
    for (const row of rows) {
      this.grid.splice(row, 1);
      this.grid.unshift(Array(COLS).fill(null));
    }
    this.shake = Math.max(this.shake, rows.length * 2);
    this.applyLockScoring(rows.length, tspin);
    this.clearing = null;
    this.spawnPiece();
  }

  flashAction(text) {
    const el = this.el.actionText;
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth; // restart animation
    el.classList.add("show");
  }

  gravityInterval() {
    return GRAVITY_TABLE[Math.min(this.level - 1, GRAVITY_TABLE.length - 1)];
  }

  // ---------- State transitions ----------

  start() {
    this.resetGame();
    this.state = "playing";
    this.hideOverlay();
    this.sound.startMusic();
  }

  togglePause() {
    if (this.state === "playing") {
      this.state = "paused";
      this.sound.stopMusic();
      this.showOverlay("PAUSED", "Press <kbd>P</kbd> to resume");
    } else if (this.state === "paused") {
      this.state = "playing";
      this.hideOverlay();
      this.sound.startMusic();
    }
  }

  gameOver() {
    this.state = "gameover";
    this.sound.gameOver();
    const best = this.score >= this.highScore && this.score > 0;
    this.showOverlay(
      "GAME OVER",
      `${best ? "<strong>New high score!</strong><br>" : ""}` +
        `Score <strong>${this.score.toLocaleString()}</strong> · ` +
        `Lines <strong>${this.lines}</strong> · ` +
        `Level <strong>${this.level}</strong><br>` +
        `Press <kbd>Enter</kbd> to play again`
    );
  }

  showOverlay(title, subHtml) {
    this.el.overlayTitle.textContent = title;
    this.el.overlaySub.innerHTML = subHtml;
    this.el.overlay.classList.remove("hidden");
  }

  hideOverlay() {
    this.el.overlay.classList.add("hidden");
  }

  updateStats() {
    this.el.score.textContent = this.score.toLocaleString();
    this.el.highscore.textContent = this.highScore.toLocaleString();
    this.el.level.textContent = this.level;
    this.el.lines.textContent = this.lines;
  }

  // ---------- Input ----------

  bindInput() {
    document.addEventListener("keydown", (e) => {
      const code = e.code;
      if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"].includes(code)) {
        e.preventDefault();
      }
      if (e.repeat) return;

      if (code === "Enter" && (this.state === "menu" || this.state === "gameover")) {
        this.start();
        return;
      }
      if (code === "KeyP" || code === "Escape") {
        this.togglePause();
        return;
      }
      if (code === "KeyR") {
        if (this.state !== "menu") this.start();
        return;
      }
      if (code === "KeyM") {
        const on = this.sound.toggle();
        if (on && this.state === "playing") this.sound.startMusic();
        this.flashAction(on ? "SOUND ON" : "SOUND OFF");
        return;
      }

      if (this.state !== "playing" || this.clearing) {
        this.keys[code] = { held: true, das: 0 };
        return;
      }

      switch (code) {
        case "ArrowLeft":
          if (this.tryMove(-1, 0)) this.sound.move();
          break;
        case "ArrowRight":
          if (this.tryMove(1, 0)) this.sound.move();
          break;
        case "ArrowDown":
          if (this.tryMove(0, 1)) {
            this.score += 1;
            this.sound.softDrop();
            this.updateStats();
          }
          break;
        case "ArrowUp":
        case "KeyX":
          this.tryRotate(1);
          break;
        case "KeyZ":
          this.tryRotate(-1);
          break;
        case "Space":
          this.hardDrop();
          break;
        case "KeyC":
        case "ShiftLeft":
        case "ShiftRight":
          this.hold();
          break;
      }
      this.keys[code] = { held: true, das: 0 };
    });

    document.addEventListener("keyup", (e) => {
      delete this.keys[e.code];
    });

    window.addEventListener("blur", () => {
      this.keys = {};
      if (this.state === "playing") this.togglePause();
    });
  }

  handleHeldKeys(dt) {
    if (this.state !== "playing" || this.clearing) return;

    for (const code of ["ArrowLeft", "ArrowRight"]) {
      const k = this.keys[code];
      if (!k) continue;
      k.das += dt;
      if (k.das >= DAS_MS) {
        k.arr = (k.arr || 0) + dt;
        while (k.arr >= ARR_MS) {
          k.arr -= ARR_MS;
          if (this.tryMove(code === "ArrowLeft" ? -1 : 1, 0)) this.sound.move();
        }
      }
    }

    if (this.keys["ArrowDown"]) {
      this.softDropTimer += dt;
      while (this.softDropTimer >= SOFT_DROP_MS) {
        this.softDropTimer -= SOFT_DROP_MS;
        if (this.tryMove(0, 1)) {
          this.score += 1;
          this.dropTimer = 0;
        }
      }
      this.updateStats();
    } else {
      this.softDropTimer = 0;
    }
  }

  // ---------- Main loop ----------

  frame(now) {
    const dt = Math.min(now - this.lastFrame, 100);
    this.lastFrame = now;

    if (this.state === "playing") {
      this.playTime += dt;
      this.el.time.textContent = formatTime(this.playTime);

      if (this.clearing) {
        this.clearing.t += dt;
        if (this.clearing.t >= CLEAR_ANIM_MS) this.finishClearing();
      } else {
        this.handleHeldKeys(dt);
        this.updateGravity(dt);
      }
    }

    this.updateParticles(dt);
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  updateGravity(dt) {
    if (this.isGrounded()) {
      if (this.lockTimer === null) this.lockTimer = 0;
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY_MS) {
        this.lockPiece();
      }
      return;
    }

    this.lockTimer = null;
    this.dropTimer += dt;
    const interval = this.gravityInterval();
    while (this.dropTimer >= interval) {
      this.dropTimer -= interval;
      if (!this.tryMove(0, 1)) break;
    }
  }

  updateParticles(dt) {
    const f = dt / 16.67;
    for (const p of this.particles) {
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.vy += 0.15 * f;
      p.life -= p.decay * f;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.5 * f);
  }

  // ---------- Rendering ----------

  drawCell(ctx, x, y, type, size = CELL, alpha = 1) {
    const c = COLORS[type];
    const pad = Math.max(1, size * 0.04);
    const s = size - pad * 2;
    const px = x * size + pad;
    const py = y * size + pad;
    const r = Math.max(2, size * 0.12);

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.roundRect(px, py, s, s, r);
    const grad = ctx.createLinearGradient(px, py, px, py + s);
    grad.addColorStop(0, c.light);
    grad.addColorStop(0.35, c.main);
    grad.addColorStop(1, c.dark);
    ctx.fillStyle = grad;
    ctx.fill();

    // top-left inner highlight
    ctx.beginPath();
    ctx.roundRect(px + s * 0.12, py + s * 0.1, s * 0.55, s * 0.28, r * 0.7);
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fill();

    ctx.restore();
  }

  drawGhostCell(ctx, x, y, type) {
    const c = COLORS[type];
    const pad = 2;
    const s = CELL - pad * 2;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x * CELL + pad, y * CELL + pad, s, s, 4);
    ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = c.main;
    ctx.fill();
    ctx.restore();
  }

  render() {
    const ctx = this.boardCtx;
    const W = COLS * CELL;
    const H = ROWS * CELL;

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#14142a");
    bg.addColorStop(1, "#0e0e1c");
    ctx.fillStyle = bg;
    ctx.fillRect(-8, -8, W + 16, H + 16);

    // grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, H);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(W, y * CELL + 0.5);
    }
    ctx.stroke();

    // settled blocks
    const clearingRows = this.clearing ? new Set(this.clearing.rows) : null;
    for (let y = HIDDEN_ROWS; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const type = this.grid[y][x];
        if (!type) continue;
        const vy = y - HIDDEN_ROWS;
        if (clearingRows && clearingRows.has(y)) {
          // flash + shrink animation
          const t = this.clearing.t / CLEAR_ANIM_MS;
          ctx.save();
          const cx = (x + 0.5) * CELL;
          const cy = (vy + 0.5) * CELL;
          ctx.translate(cx, cy);
          ctx.scale(1 - t, 1 - t);
          ctx.translate(-cx, -cy);
          this.drawCell(ctx, x, vy, type, CELL, 1 - t * 0.5);
          ctx.restore();
          if (t < 0.4) {
            ctx.save();
            ctx.globalAlpha = (0.4 - t) * 2;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x * CELL, vy * CELL, CELL, CELL);
            ctx.restore();
          }
        } else {
          this.drawCell(ctx, x, vy, type);
        }
      }
    }

    if (this.state === "playing" && !this.clearing && this.piece) {
      const p = this.piece;

      // ghost
      const gy = this.ghostY();
      if (gy !== p.y) {
        for (let y = 0; y < p.matrix.length; y++) {
          for (let x = 0; x < p.matrix[y].length; x++) {
            if (!p.matrix[y][x]) continue;
            const vy = gy + y - HIDDEN_ROWS;
            if (vy >= 0) this.drawGhostCell(ctx, p.x + x, vy, p.type);
          }
        }
      }

      // active piece (pulse while lock delay is running)
      const lockPulse =
        this.lockTimer !== null
          ? 0.75 + 0.25 * Math.sin((this.lockTimer / LOCK_DELAY_MS) * Math.PI * 6)
          : 1;
      for (let y = 0; y < p.matrix.length; y++) {
        for (let x = 0; x < p.matrix[y].length; x++) {
          if (!p.matrix[y][x]) continue;
          const vy = p.y + y - HIDDEN_ROWS;
          if (vy >= -1) this.drawCell(ctx, p.x + x, vy, p.type, CELL, lockPulse);
        }
      }
    }

    // particles
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // danger zone tint when stack is high
    let highest = TOTAL_ROWS;
    outer: for (let y = 0; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.grid[y][x]) {
          highest = y;
          break outer;
        }
      }
    }
    if (highest - HIDDEN_ROWS < 4 && this.state === "playing") {
      ctx.save();
      ctx.globalAlpha = 0.06 + 0.04 * Math.sin(performance.now() / 200);
      ctx.fillStyle = "#ff2244";
      ctx.fillRect(0, 0, W, 4 * CELL);
      ctx.restore();
    }

    ctx.restore();

    this.renderPreviewBox(this.holdCtx, this.holdCanvas, this.holdType ? [this.holdType] : [], this.holdUsed);
    this.renderPreviewBox(this.nextCtx, this.nextCanvas, this.queue.slice(0, 5), false);
  }

  renderPreviewBox(ctx, canvas, types, dimmed) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    const slot = types.length > 1 ? h / 5 : h;
    types.forEach((type, i) => {
      const shape = SHAPES[type];
      const size = 18;
      // trim empty rows for vertical centering
      const rows = shape.filter((r) => r.some(Boolean)).length;
      const cols = Math.max(...shape.map((r) => r.lastIndexOf(1) + 1)) -
        Math.min(...shape.map((r) => (r.includes(1) ? r.indexOf(1) : Infinity)));
      const minX = Math.min(...shape.map((r) => (r.includes(1) ? r.indexOf(1) : Infinity)));
      const minY = shape.findIndex((r) => r.some(Boolean));

      const pw = cols * size;
      const ph = rows * size;
      const ox = (w - pw) / 2;
      const oy = i * slot + (slot - ph) / 2;

      ctx.save();
      ctx.translate(ox, oy);
      if (dimmed) ctx.globalAlpha = 0.35;
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (!shape[y][x]) continue;
          this.drawCell(ctx, x - minX, y - minY, type, size, dimmed ? 0.5 : i === 0 && types.length > 1 ? 1 : 0.85);
        }
      }
      ctx.restore();
    });
  }
}

window.game = new Game();
