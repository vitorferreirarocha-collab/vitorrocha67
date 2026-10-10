/* Hoop Rush convertido para JavaScript puro: motor, áudio, recordes e interface. */
/**
 * SoundFX — sintetizador de sons via WebAudio (sem assets externos).
 * Todos os sons são gerados proceduralmente: quique, arremesso,
 * swish, cesta, combo, buzzer e cliques de UI.
 */
class SoundFX {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.noiseBuf = null;
        this.muted = false;
    }
    setMuted(m) {
        this.muted = m;
        if (this.master)
            this.master.gain.value = m ? 0 : 0.5;
    }
    /** Deve ser chamado dentro de um gesto do usuário (toque/clique/tecla). */
    ensure() {
        if (!this.ctx) {
            const AC = window.AudioContext ||
                window
                    .webkitAudioContext;
            if (!AC)
                return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.5;
            this.master.connect(this.ctx.destination);
            const len = this.ctx.sampleRate;
            this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++)
                d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === "suspended")
            void this.ctx.resume();
    }
    tone(freq, dur, type, vol, slideTo, delay = 0) {
        if (!this.ctx || !this.master || this.muted)
            return;
        const t0 = this.ctx.currentTime + delay;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(Math.max(20, freq), t0);
        if (slideTo)
            o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g);
        g.connect(this.master);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
    }
    noise(dur, vol, filterFreq, type, slideTo, delay = 0) {
        if (!this.ctx || !this.master || !this.noiseBuf || this.muted)
            return;
        const t0 = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(filterFreq, t0);
        if (slideTo)
            f.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        src.connect(f);
        f.connect(g);
        g.connect(this.master);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
    }
    /** Quique da bola — intensidade 0..1 */
    bounce(strength) {
        this.tone(150, 0.09, "sine", 0.55 * strength, 55);
    }
    shoot() {
        this.noise(0.18, 0.22, 1800, "bandpass", 350);
    }
    swish() {
        this.noise(0.28, 0.4, 2600, "highpass");
        this.tone(880, 0.14, "sine", 0.22, 1320, 0.03);
    }
    score() {
        this.tone(660, 0.1, "triangle", 0.32);
        this.tone(990, 0.18, "triangle", 0.32, undefined, 0.08);
    }
    combo(n) {
        const f = 480 + Math.min(n, 8) * 90;
        this.tone(f, 0.12, "square", 0.14, f * 1.5);
    }
    buzzer() {
        this.tone(165, 0.75, "sawtooth", 0.35, 118);
        this.tone(110, 0.75, "square", 0.2, 88);
    }
    click() {
        this.tone(720, 0.05, "square", 0.14);
    }
}

const TRAIL_LEN = 14;
const PARTICLE_COUNT = 420;
const GAME_TIME = 60;
const CONF_COLORS = ["#ff7a1a", "#ffd166", "#ffffff", "#ff5d8f", "#6ee7b7"];
const GOLD_COLORS = ["#ffd166", "#ffb347", "#fff3d6", "#ff9a5a"];
function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function rand(a, b) {
    return a + Math.random() * (b - a);
}
function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
}
class HoopEngine {
    constructor(canvas, cb, sfx, best) {
        this.W = 0;
        this.H = 0;
        this.dpr = 1;
        this.raf = 0;
        this.last = 0;
        this.animT = 0;
        this.ro = null;
        // layout (recalculado no resize)
        this.floorY = 0;
        this.ballR = 20;
        this.rimX = 0;
        this.rimYBase = 0;
        this.rimY = 0;
        this.rimHalf = 30;
        this.rimR = 4;
        this.boardX = 0;
        this.boardW = 8;
        this.boardTop = 0;
        this.boardBottom = 0;
        this.poleX = 0;
        this.gravity = 2000;
        this.maxSpeed = 1800;
        this.minSpeed = 700;
        this.dragK = 6;
        this.spawnMinX = 60;
        this.spawnMaxX = 300;
        this.skyGrad = null;
        this.courtGrad = null;
        this.vigGrad = null;
        this.buildingsFar = [];
        this.buildingsNear = [];
        this.phase = "idle";
        this.score = 0;
        this.combo = 0;
        this.timeLeft = GAME_TIME;
        this.best = 0;
        this.startBest = 0;
        this.recordBroken = false;
        this.idleT = 0;
        this.particles = [];
        this.popups = [];
        this.shake = 0;
        this.netOff = 0;
        this.netVel = 0;
        this.flash = 0;
        // entrada
        this.aimActive = false;
        this.aimId = -1;
        this.aimSX = 0;
        this.aimSY = 0;
        this.aimCX = 0;
        this.aimCY = 0;
        this.kbAngle = 60;
        this.kbPower = 0;
        this.charging = false;
        this.angleShowT = 0;
        this.hasShot = false;
        this.hudCache = { score: -1, timeLeft: -1, combo: -1, best: -1 };
        this.canvas = canvas;
        this.cb = cb;
        this.sfx = sfx;
        this.best = best;
        this.startBest = best;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("Canvas 2D indisponível");
        this.ctx = ctx;
        this.ball = {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            r: 20,
            rot: 0,
            state: "ready",
            scored: false,
            touchedRim: false,
            touchedBoard: false,
            squash: 0,
            spawnT: 1,
            settleT: 0,
            flightT: 0,
            scoredT: 0,
            trailX: new Float32Array(TRAIL_LEN),
            trailY: new Float32Array(TRAIL_LEN),
            trailI: 0,
            trailN: 0,
        };
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            this.particles.push({
                active: false,
                kind: 0,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                life: 0,
                maxLife: 1,
                size: 4,
                color: "#fff",
                rot: 0,
                vr: 0,
                grav: 0,
                drag: 0,
            });
        }
        this.resize = this.resize.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onVisChange = this.onVisChange.bind(this);
        this.frame = this.frame.bind(this);
        this.ro = new ResizeObserver(this.resize);
        if (canvas.parentElement)
            this.ro.observe(canvas.parentElement);
        canvas.addEventListener("pointerdown", this.onPointerDown);
        canvas.addEventListener("pointermove", this.onPointerMove);
        canvas.addEventListener("pointerup", this.onPointerUp);
        canvas.addEventListener("pointercancel", this.onPointerUp);
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
        document.addEventListener("visibilitychange", this.onVisChange);
        this.resize();
        this.respawn();
        this.last = performance.now() / 1000;
        this.raf = requestAnimationFrame(this.frame);
    }
    /* -------------------------------------------------------------- ciclo */
    frame(tms) {
        this.raf = requestAnimationFrame(this.frame);
        const now = tms / 1000;
        let dt = now - this.last;
        this.last = now;
        if (dt > 0.05)
            dt = 0.05;
        if (dt <= 0)
            dt = 0.0001;
        if (this.phase !== "paused") {
            this.animT += dt;
            const steps = clamp(Math.ceil(dt / (1 / 240)), 1, 8);
            const h = dt / steps;
            for (let i = 0; i < steps; i++)
                this.step(h);
            this.updateFx(dt);
        }
        this.render();
        this.emitHud();
    }
    step(dt) {
        // cronômetro
        if (this.phase === "playing") {
            this.timeLeft -= dt;
            if (this.timeLeft <= 0) {
                this.timeLeft = 0;
                this.endGame();
            }
        }
        // carregamento do tiro via teclado
        if (this.phase === "playing" && this.charging) {
            this.kbPower = Math.min(1, this.kbPower + dt / 1.15);
        }
        if (this.angleShowT > 0)
            this.angleShowT -= dt;
        // hoop se move depois de 12 pontos (dificuldade progressiva)
        const moving = this.score >= 12;
        this.rimY = this.rimYBase + (moving ? Math.sin(this.animT * 1.15) * this.H * 0.035 : 0);
        this.boardTop = this.rimY - this.H * 0.17;
        this.boardBottom = this.rimY + this.H * 0.035;
        this.stepBall(dt);
    }
    stepBall(dt) {
        const b = this.ball;
        if (b.state === "ready") {
            b.spawnT = Math.min(1, b.spawnT + dt * 4);
            // modo atração: arremesso automático atrás do menu
            if (this.phase === "idle") {
                this.idleT += dt;
                if (this.idleT > 0.8) {
                    b.vx = rand(180, 460) * (Math.random() < 0.75 ? 1 : -0.6);
                    b.vy = -rand(this.H * 0.85, this.H * 1.35);
                    b.state = "flying";
                    b.flightT = 0;
                    b.settleT = 0;
                }
            }
            return;
        }
        b.flightT += dt;
        const prevY = b.y;
        b.vy += this.gravity * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += (b.vx / b.r) * dt * 0.6;
        b.squash *= Math.exp(-9 * dt);
        // rastro
        b.trailX[b.trailI] = b.x;
        b.trailY[b.trailI] = b.y;
        b.trailI = (b.trailI + 1) % TRAIL_LEN;
        b.trailN = Math.min(TRAIL_LEN, b.trailN + 1);
        // paredes
        if (b.x - b.r < 0) {
            b.x = b.r;
            if (b.vx < 0) {
                b.vx = -b.vx * 0.6;
                this.onBounce(Math.abs(b.vx), b.x, b.y);
            }
        }
        if (b.x + b.r > this.W) {
            b.x = this.W - b.r;
            if (b.vx > 0) {
                b.vx = -b.vx * 0.6;
                this.onBounce(Math.abs(b.vx), b.x, b.y);
            }
        }
        if (b.y - b.r < 0) {
            b.y = b.r;
            if (b.vy < 0)
                b.vy = -b.vy * 0.6;
        }
        // chão
        if (b.y + b.r > this.floorY) {
            b.y = this.floorY - b.r;
            if (b.vy > 0) {
                const impact = b.vy;
                b.vy = -b.vy * 0.62;
                b.vx *= 0.92;
                b.squash = Math.min(0.42, impact / 2800);
                this.onBounce(impact, b.x, this.floorY);
                if (Math.abs(b.vy) < 90)
                    b.vy = 0;
            }
        }
        if (!b.scored) {
            // tabela
            const withinY = b.y > this.boardTop - b.r && b.y < this.boardBottom + b.r;
            if (b.vx > 0 && withinY && b.x + b.r > this.boardX && b.x < this.boardX) {
                b.x = this.boardX - b.r;
                b.vx = -b.vx * 0.55;
                b.touchedBoard = true;
                this.onBounce(Math.abs(b.vx) * 1.2, b.x + b.r, b.y);
            }
            if (b.vy > 0 &&
                b.y + b.r > this.boardTop &&
                b.y < this.boardTop &&
                b.x + b.r > this.boardX &&
                b.x - b.r < this.boardX + this.boardW) {
                b.y = this.boardTop - b.r;
                b.vy = -b.vy * 0.55;
                b.touchedBoard = true;
            }
            // aros (dois pontos circulares)
            this.collideRim(b, this.rimX - this.rimHalf, this.rimY);
            this.collideRim(b, this.rimX + this.rimHalf, this.rimY);
        }
        // cesta: centro da bola cruza o plano do aro descendo
        if (!b.scored &&
            b.vy > 0 &&
            prevY <= this.rimY &&
            b.y > this.rimY &&
            Math.abs(b.x - this.rimX) < this.rimHalf - b.r * 0.35) {
            this.onScore();
        }
        // resolução da jogada
        if (b.scored) {
            b.scoredT += dt;
            if (b.scoredT > 1.1 || b.y - b.r > this.H + 60)
                this.respawn();
        }
        else {
            const speed = Math.hypot(b.vx, b.vy);
            const onFloor = b.y + b.r >= this.floorY - 0.5;
            if (onFloor && speed < 70)
                b.settleT += dt;
            else
                b.settleT = 0;
            if (b.settleT > 0.35 || b.flightT > 7)
                this.onMiss();
        }
        // chama do combo
        if (this.combo >= 3 && this.phase === "playing") {
            for (let i = 0; i < 2; i++) {
                this.spawnParticle(2, b.x + rand(-b.r * 0.5, b.r * 0.5), b.y + rand(-b.r * 0.5, b.r * 0.5), rand(-40, 40) - b.vx * 0.08, rand(-160, -60) - b.vy * 0.08, rand(0.25, 0.45), rand(b.r * 0.35, b.r * 0.7), "#ffd166", -500, rand(-4, 4), 2);
            }
        }
    }
    collideRim(b, px, py) {
        const dx = b.x - px;
        const dy = b.y - py;
        const minD = b.r + this.rimR;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 0.0001)
            return;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        b.x = px + nx * minD;
        b.y = py + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
            b.vx -= 1.55 * vn * nx;
            b.vy -= 1.55 * vn * ny;
            b.vx *= 0.985;
            b.vy *= 0.985;
            b.touchedRim = true;
            this.onBounce(Math.abs(vn) * 0.8, px, py);
        }
    }
    onBounce(impact, x, y) {
        if (impact < 220)
            return;
        const s = clamp(impact / 1600, 0.15, 1);
        this.sfx.bounce(s);
        if (impact > 500) {
            for (let i = 0; i < 5; i++) {
                this.spawnParticle(1, x + rand(-6, 6), y - 2, rand(-90, 90), rand(-160, -30), rand(0.3, 0.6), rand(2, 5), "#b9aee0", 420, 0, 1.5);
            }
        }
        if (impact > 1000)
            this.shake = Math.max(this.shake, 2.5);
    }
    onScore() {
        const b = this.ball;
        b.scored = true;
        b.scoredT = 0;
        const swish = !b.touchedRim && !b.touchedBoard;
        this.netVel += swish ? 300 : 190;
        this.flash = 1;
        if (this.phase === "playing") {
            this.combo++;
            const base = swish ? 3 : 2;
            const bonus = Math.min(this.combo - 1, 5);
            const pts = base + bonus;
            this.score += pts;
            this.addPopup(this.rimX, this.rimY - this.H * 0.05, swish ? `SWISH +${pts}` : `+${pts}`, swish ? "#ffd166" : "#ffffff", swish ? this.H * 0.045 : this.H * 0.036);
            if (this.combo >= 2) {
                this.addPopup(this.rimX, this.rimY + this.H * 0.045, `COMBO x${this.combo}`, "#ff7a1a", this.H * 0.028);
            }
            if (this.combo === 3) {
                this.addPopup(this.W * 0.5, this.H * 0.3, "EM CHAMAS!", "#ff5722", this.H * 0.05);
            }
            if (!this.recordBroken && this.best > 0 && this.score > this.best) {
                this.recordBroken = true;
                this.addPopup(this.W * 0.5, this.H * 0.24, "NOVO RECORDE!", "#6ee7b7", this.H * 0.042);
            }
            this.shake = Math.max(this.shake, swish ? 11 : 7);
            this.burst(this.rimX, this.rimY, swish ? 44 : 24, swish);
            if (swish)
                this.sfx.swish();
            else
                this.sfx.score();
            if (this.combo >= 2)
                this.sfx.combo(this.combo);
        }
    }
    onMiss() {
        if (this.phase === "playing" && this.combo > 0) {
            this.combo = 0;
            this.addPopup(this.ball.x, this.floorY - this.ball.r * 3, "combo perdido", "#9a90c0", this.H * 0.022);
        }
        this.respawn();
    }
    respawn() {
        const b = this.ball;
        b.x = rand(this.spawnMinX, this.spawnMaxX);
        b.y = this.floorY - b.r;
        b.vx = 0;
        b.vy = 0;
        b.state = "ready";
        b.scored = false;
        b.touchedRim = false;
        b.touchedBoard = false;
        b.settleT = 0;
        b.flightT = 0;
        b.scoredT = 0;
        b.spawnT = 0;
        b.squash = 0;
        b.trailN = 0;
        this.idleT = 0;
    }
    shoot(vx, vy) {
        const b = this.ball;
        if (b.state !== "ready" || this.phase !== "playing")
            return;
        const sp = Math.hypot(vx, vy);
        if (sp < 40)
            return;
        if (sp > this.maxSpeed) {
            const k = this.maxSpeed / sp;
            vx *= k;
            vy *= k;
        }
        b.vx = vx;
        b.vy = vy;
        b.state = "flying";
        b.flightT = 0;
        b.settleT = 0;
        this.hasShot = true;
        this.sfx.shoot();
    }
    endGame() {
        this.phase = "over";
        this.charging = false;
        this.aimActive = false;
        this.sfx.buzzer();
        const isRecord = this.score > 0 && this.score > this.startBest;
        this.cb.onPhase("over");
        this.cb.onGameOver(this.score, isRecord);
        this.emitHud(true);
    }
    /* -------------------------------------------------------------- partículas */
    spawnParticle(kind, x, y, vx, vy, life, size, color, grav, vr, drag) {
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.active)
                continue;
            p.active = true;
            p.kind = kind;
            p.x = x;
            p.y = y;
            p.vx = vx;
            p.vy = vy;
            p.life = life;
            p.maxLife = life;
            p.size = size;
            p.color = color;
            p.rot = rand(0, Math.PI * 2);
            p.vr = vr;
            p.grav = grav;
            p.drag = drag;
            return;
        }
    }
    burst(x, y, n, gold) {
        const colors = gold ? GOLD_COLORS : CONF_COLORS;
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2);
            const sp = rand(120, 620);
            this.spawnParticle(0, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 220, rand(0.6, 1.3), rand(4, 9), colors[(Math.random() * colors.length) | 0], 950, rand(-12, 12), 0.6);
        }
        for (let i = 0; i < 10; i++) {
            const a = rand(0, Math.PI * 2);
            const sp = rand(300, 800);
            this.spawnParticle(3, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.25, 0.5), rand(1.5, 3), "#ffd166", 500, 0, 1);
        }
    }
    updateFx(dt) {
        // partículas
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.active)
                continue;
            p.life -= dt;
            if (p.life <= 0) {
                p.active = false;
                continue;
            }
            p.vy += p.grav * dt;
            p.vx -= p.vx * p.drag * dt;
            p.vy -= p.vy * p.drag * dt * 0.4;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
        }
        // popups
        for (let i = this.popups.length - 1; i >= 0; i--) {
            const p = this.popups[i];
            p.life -= dt;
            p.y -= this.H * 0.07 * dt;
            if (p.life <= 0)
                this.popups.splice(i, 1);
        }
        // mola da rede
        this.netVel += (-this.netOff * 220 - this.netVel * 13) * dt;
        this.netOff += this.netVel * dt;
        // trepidação e brilho
        this.shake *= Math.exp(-6 * dt);
        if (this.shake < 0.1)
            this.shake = 0;
        this.flash = Math.max(0, this.flash - dt * 3);
    }
    addPopup(x, y, text, color, size) {
        if (this.popups.length > 12)
            this.popups.shift();
        this.popups.push({
            x,
            y,
            life: 1.15,
            maxLife: 1.15,
            text,
            color,
            size,
        });
    }
    /* -------------------------------------------------------------- entrada */
    toLocal(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    onPointerDown(e) {
        this.sfx.ensure();
        if (this.phase !== "playing")
            return;
        if (this.ball.state !== "ready")
            return;
        if (this.aimActive)
            return;
        e.preventDefault();
        const p = this.toLocal(e);
        this.aimActive = true;
        this.aimId = e.pointerId;
        this.aimSX = p.x;
        this.aimSY = p.y;
        this.aimCX = p.x;
        this.aimCY = p.y;
        try {
            this.canvas.setPointerCapture(e.pointerId);
        }
        catch {
            /* ignorar */
        }
    }
    onPointerMove(e) {
        if (!this.aimActive || e.pointerId !== this.aimId)
            return;
        const p = this.toLocal(e);
        this.aimCX = p.x;
        this.aimCY = p.y;
    }
    onPointerUp(e) {
        if (!this.aimActive || e.pointerId !== this.aimId)
            return;
        this.aimActive = false;
        const dx = this.aimSX - this.aimCX;
        const dy = this.aimSY - this.aimCY;
        if (Math.hypot(dx, dy) > 14) {
            this.shoot(dx * this.dragK, dy * this.dragK);
        }
    }
    onKeyDown(e) {
        this.sfx.ensure();
        if (this.phase !== "playing")
            return;
        if (e.code === "Space") {
            e.preventDefault();
            if (this.ball.state === "ready" && !this.charging) {
                this.charging = true;
                this.kbPower = 0;
            }
        }
        else if (e.code === "ArrowLeft" || e.code === "KeyA") {
            e.preventDefault();
            this.kbAngle = clamp(this.kbAngle - 2, 25, 80);
            this.angleShowT = 2;
        }
        else if (e.code === "ArrowRight" || e.code === "KeyD") {
            e.preventDefault();
            this.kbAngle = clamp(this.kbAngle + 2, 25, 80);
            this.angleShowT = 2;
        }
    }
    onKeyUp(e) {
        if (e.code !== "Space" || !this.charging)
            return;
        this.charging = false;
        const ang = (this.kbAngle * Math.PI) / 180;
        const pow = Math.max(0.18, this.kbPower);
        const sp = this.minSpeed + (this.maxSpeed - this.minSpeed) * pow;
        this.shoot(Math.cos(ang) * sp, -Math.sin(ang) * sp);
        this.kbPower = 0;
    }
    onVisChange() {
        if (document.hidden && this.phase === "playing")
            this.pause();
    }
    /* -------------------------------------------------------------- layout */
    resize() {
        const parent = this.canvas.parentElement;
        if (!parent)
            return;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (w === 0 || h === 0)
            return;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.W = w;
        this.H = h;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        const u = Math.min(w, h);
        this.floorY = h - Math.max(54, h * 0.09);
        this.ballR = clamp(u * 0.052, 13, 34);
        this.ball.r = this.ballR;
        this.rimHalf = this.ballR * 1.75;
        this.rimR = Math.max(3, u * 0.011);
        this.rimX = w * 0.72;
        this.rimYBase = h * 0.36;
        this.rimY = this.rimYBase;
        this.boardX = this.rimX + this.rimHalf + this.rimR + this.ballR * 0.25;
        this.boardW = Math.max(7, u * 0.028);
        this.poleX = this.boardX + this.boardW + u * 0.022;
        this.gravity = h * 2.5;
        this.maxSpeed = h * 2.35;
        this.minSpeed = h * 0.9;
        this.dragK = (6 * h) / 800;
        this.spawnMinX = w * 0.12;
        this.spawnMaxX = Math.min(w * 0.55, this.rimX - u * 0.35);
        // gradientes
        const sky = this.ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, "#0f0c29");
        sky.addColorStop(0.55, "#241b4d");
        sky.addColorStop(0.85, "#4a2545");
        sky.addColorStop(1, "#57253f");
        this.skyGrad = sky;
        const court = this.ctx.createLinearGradient(0, this.floorY, 0, h);
        court.addColorStop(0, "#332a4d");
        court.addColorStop(1, "#171226");
        this.courtGrad = court;
        const vig = this.ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.85);
        vig.addColorStop(0, "rgba(5,3,15,0)");
        vig.addColorStop(1, "rgba(5,3,15,0.55)");
        this.vigGrad = vig;
        this.buildingsFar = this.genSkyline(7, w, h, 0.16, 0.34, 0);
        this.buildingsNear = this.genSkyline(21, w, h, 0.24, 0.46, 1);
        if (this.ball.state === "ready") {
            this.ball.x = clamp(this.ball.x, this.spawnMinX, this.spawnMaxX);
            this.ball.y = this.floorY - this.ballR;
        }
    }
    genSkyline(seed, w, h, minF, maxF, withWindows) {
        const rnd = mulberry32(seed);
        const list = [];
        let x = -20;
        while (x < w + 40) {
            const bw = 34 + rnd() * 66;
            const bh = h * (minF + rnd() * (maxF - minF));
            const wins = [];
            if (withWindows) {
                const cols = Math.max(2, Math.floor(bw / 16));
                const rows = Math.max(3, Math.floor(bh / 26));
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        if (rnd() < 0.28) {
                            wins.push({
                                dx: 5 + c * ((bw - 10) / cols),
                                dy: 8 + r * ((bh - 14) / rows),
                                lit: rnd(),
                            });
                        }
                    }
                }
            }
            list.push({ x, w: bw, h: bh, wins });
            x += bw + 4 + rnd() * 14;
        }
        return list;
    }
    /* -------------------------------------------------------------- desenho */
    render() {
        const ctx = this.ctx;
        const { W, H } = this;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const sx = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
        const sy = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
        ctx.save();
        ctx.translate(sx, sy);
        this.drawBackground();
        this.drawCourt();
        this.drawHoopBack();
        this.drawBallShadow();
        this.drawAim();
        this.drawBall();
        this.drawRimFront();
        this.drawParticles();
        this.drawPopups();
        ctx.restore();
        // brilho do aro + vinheta (sem trepidação)
        if (this.flash > 0) {
            const g = ctx.createRadialGradient(this.rimX, this.rimY, 4, this.rimX, this.rimY, H * 0.22);
            g.addColorStop(0, `rgba(255,170,60,${0.5 * this.flash})`);
            g.addColorStop(1, "rgba(255,170,60,0)");
            ctx.fillStyle = g;
            ctx.fillRect(this.rimX - H * 0.22, this.rimY - H * 0.22, H * 0.44, H * 0.44);
        }
        if (this.vigGrad) {
            ctx.fillStyle = this.vigGrad;
            ctx.fillRect(0, 0, W, H);
        }
    }
    drawBackground() {
        const ctx = this.ctx;
        const { W, H } = this;
        if (this.skyGrad) {
            ctx.fillStyle = this.skyGrad;
            ctx.fillRect(0, 0, W, H);
        }
        // sol poente
        const sunY = this.floorY - H * 0.3;
        const sunR = H * 0.1;
        const glow = ctx.createRadialGradient(W * 0.5, sunY, 0, W * 0.5, sunY, H * 0.34);
        glow.addColorStop(0, "rgba(255,150,80,0.4)");
        glow.addColorStop(1, "rgba(255,150,80,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
        const sun = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
        sun.addColorStop(0, "#ffb347");
        sun.addColorStop(1, "#ff5d8f");
        ctx.fillStyle = sun;
        ctx.beginPath();
        ctx.arc(W * 0.5, sunY, sunR, 0, Math.PI * 2);
        ctx.fill();
        // skyline
        this.drawBuildings(this.buildingsFar, "#1a1333", false);
        this.drawBuildings(this.buildingsNear, "#100c22", true);
    }
    drawBuildings(list, color, windows) {
        const ctx = this.ctx;
        const base = this.floorY;
        ctx.fillStyle = color;
        for (const b of list) {
            ctx.fillRect(b.x, base - b.h, b.w, b.h);
            if (windows) {
                for (const wn of b.wins) {
                    ctx.fillStyle = `rgba(255,209,102,${0.12 + wn.lit * 0.45})`;
                    ctx.fillRect(b.x + wn.dx, base - b.h + wn.dy, 4, 6);
                }
                ctx.fillStyle = color;
            }
        }
    }
    drawCourt() {
        const ctx = this.ctx;
        const { W, H } = this;
        if (this.courtGrad) {
            ctx.fillStyle = this.courtGrad;
            ctx.fillRect(0, this.floorY, W, H - this.floorY);
        }
        // marcações quadriculadas
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.rimX, this.rimY, Math.min(W, H) * 0.52, 0, Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(W * 0.5, this.floorY);
        ctx.lineTo(W * 0.5, H);
        ctx.stroke();
        // linha de fundo iluminada
        ctx.strokeStyle = "rgba(255,170,80,0.35)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, this.floorY + 1);
        ctx.lineTo(W, this.floorY + 1);
        ctx.stroke();
        // textura do asfalto
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            const y = this.floorY + ((H - this.floorY) * i) / 4;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
    }
    drawHoopBack() {
        const ctx = this.ctx;
        const { H } = this;
        // poste
        ctx.fillStyle = "#0c0918";
        ctx.fillRect(this.poleX - H * 0.011, this.boardTop, H * 0.022, this.floorY - this.boardTop);
        // braço
        ctx.fillRect(this.boardX + this.boardW, this.rimY - H * 0.06, this.poleX - this.boardX - this.boardW, H * 0.016);
        // tabela
        ctx.fillStyle = "#f2ead8";
        ctx.fillRect(this.boardX, this.boardTop, this.boardW, this.boardBottom - this.boardTop);
        ctx.strokeStyle = "#cfc4ae";
        ctx.lineWidth = 2;
        ctx.strokeRect(this.boardX, this.boardTop, this.boardW, this.boardBottom - this.boardTop);
        // quadrado de colheita (retângulo vertical na face da tabela)
        ctx.strokeStyle = "#ff7a1a";
        ctx.lineWidth = 3;
        const sqW = this.boardW * 0.55;
        const sqH = Math.min(H * 0.055, this.boardW * 2.2);
        ctx.strokeRect(this.boardX + this.boardW / 2 - sqW / 2, this.rimY - sqH * 0.85, sqW, sqH);
        // linha do aro
        ctx.strokeStyle = "#ff7a1a";
        ctx.lineWidth = this.rimR * 1.3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(this.rimX - this.rimHalf, this.rimY);
        ctx.lineTo(this.rimX + this.rimHalf + this.rimR, this.rimY);
        ctx.stroke();
        // encaixe do aro na tabela
        ctx.fillStyle = "#c24e00";
        ctx.fillRect(this.rimX + this.rimHalf - 2, this.rimY - 3, this.boardX - this.rimX - this.rimHalf + 4, 6);
    }
    drawRimFront() {
        const ctx = this.ctx;
        // pontas do aro
        ctx.fillStyle = "#ff8a2a";
        ctx.beginPath();
        ctx.arc(this.rimX - this.rimHalf, this.rimY, this.rimR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(this.rimX + this.rimHalf, this.rimY, this.rimR, 0, Math.PI * 2);
        ctx.fill();
        this.drawNet();
    }
    drawNet() {
        const ctx = this.ctx;
        const lx = this.rimX - this.rimHalf;
        const rx = this.rimX + this.rimHalf;
        const ry = this.rimY;
        const depth = this.rimHalf * 1.5 + this.netOff;
        const bw = this.rimHalf * 0.5;
        const rows = 4;
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            const topX = lx + (rx - lx) * t;
            const botX = this.rimX - bw + bw * 2 * t;
            ctx.beginPath();
            ctx.moveTo(topX, ry);
            for (let r = 1; r <= rows; r++) {
                const tt = r / rows;
                const zig = r % 2 === 1 ? (i % 2 === 0 ? 4 : -4) : 0;
                ctx.lineTo(topX + (botX - topX) * tt + zig, ry + depth * tt);
            }
            ctx.stroke();
        }
        for (let r = 1; r <= rows; r++) {
            const tt = r / rows;
            const y = ry + depth * tt;
            const w = rx - lx + (bw * 2 - (rx - lx)) * tt;
            ctx.beginPath();
            ctx.moveTo(this.rimX - w / 2 + (r % 2 ? 3 : 0), y);
            ctx.lineTo(this.rimX + w / 2 + (r % 2 ? 3 : 0), y);
            ctx.stroke();
        }
    }
    drawBallShadow() {
        const b = this.ball;
        const hFrac = clamp(1 - (this.floorY - b.y) / (this.H * 0.8), 0.15, 1);
        const ctx = this.ctx;
        ctx.fillStyle = `rgba(0,0,0,${0.32 * hFrac})`;
        ctx.beginPath();
        ctx.ellipse(b.x, this.floorY + 5, b.r * 1.05 * hFrac, b.r * 0.28 * hFrac, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    drawBall() {
        const b = this.ball;
        const ctx = this.ctx;
        const r = b.r;
        // brilho do combo
        if (this.combo >= 3 && b.state === "flying") {
            const pulse = 0.4 + Math.sin(this.animT * 14) * 0.15;
            const g = ctx.createRadialGradient(b.x, b.y, r * 0.4, b.x, b.y, r * 2.6);
            g.addColorStop(0, `rgba(255,120,30,${pulse})`);
            g.addColorStop(1, "rgba(255,120,30,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(b.x, b.y, r * 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        // rastro
        if (b.trailN > 1 && b.state === "flying") {
            const speed = Math.hypot(b.vx, b.vy);
            if (speed > 260) {
                for (let i = 0; i < b.trailN; i++) {
                    const idx = (b.trailI - 1 - i + TRAIL_LEN) % TRAIL_LEN;
                    const t = 1 - i / TRAIL_LEN;
                    ctx.fillStyle =
                        this.combo >= 3
                            ? `rgba(255,${140 + ((t * 80) | 0)},40,${0.22 * t})`
                            : `rgba(255,150,60,${0.16 * t})`;
                    ctx.beginPath();
                    ctx.arc(b.trailX[idx], b.trailY[idx], r * 0.72 * t, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        const spawnScale = b.state === "ready" ? this.easeOutBack(b.spawnT) : 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.scale((1 + b.squash * 0.7) * spawnScale, (1 - b.squash) * spawnScale);
        const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.15);
        g.addColorStop(0, "#ffb347");
        g.addColorStop(0.55, "#ff7a1a");
        g.addColorStop(1, "#d14e00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        // costuras
        ctx.strokeStyle = "rgba(60,20,0,0.6)";
        ctx.lineWidth = Math.max(1.5, r * 0.08);
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.quadraticCurveTo(0, r * 0.22, r, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(-r * 0.22, 0, 0, r);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-r * 1.55, 0, r * 1.85, -0.42, 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 1.55, 0, r * 1.85, Math.PI - 0.42, Math.PI + 0.42);
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    drawAim() {
        const b = this.ball;
        const ctx = this.ctx;
        const ready = b.state === "ready" && this.phase === "playing";
        // dica de primeiro arremesso
        if (ready && !this.hasShot && !this.aimActive && !this.charging) {
            const pulse = 0.55 + Math.sin(this.animT * 5) * 0.3;
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 8]);
            ctx.beginPath();
            ctx.moveTo(b.x, b.y - b.r * 2);
            ctx.quadraticCurveTo(b.x + b.r * 3, b.y - b.r * 4.5, b.x + b.r * 5.5, b.y - b.r * 5.5);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = `800 ${Math.max(13, this.H * 0.02)}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillStyle = "#ffffff";
            ctx.fillText("ARRASTE E SOLTE", b.x + b.r * 2.4, b.y - b.r * 6.6);
            ctx.restore();
        }
        // mira por arraste
        if (this.aimActive && ready) {
            const dx = this.aimSX - this.aimCX;
            const dy = this.aimSY - this.aimCY;
            if (Math.hypot(dx, dy) > 14) {
                let vx = dx * this.dragK;
                let vy = dy * this.dragK;
                const sp = Math.hypot(vx, vy);
                if (sp > this.maxSpeed) {
                    const k = this.maxSpeed / sp;
                    vx *= k;
                    vy *= k;
                }
                this.drawTrajectory(b.x, b.y, vx, vy);
                // anel de força
                ctx.strokeStyle = "rgba(255,255,255,0.35)";
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r * 1.7, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = "#ffd166";
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r * 1.7, -Math.PI / 2, -Math.PI / 2 + (sp / this.maxSpeed) * Math.PI * 2);
                ctx.stroke();
            }
            // elástico
            ctx.strokeStyle = "rgba(255,255,255,0.25)";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(this.aimCX, this.aimCY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // mira por teclado
        if (ready && (this.charging || this.angleShowT > 0)) {
            const ang = (this.kbAngle * Math.PI) / 180;
            const len = b.r * 2.4;
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(b.x + Math.cos(ang) * len, b.y - Math.sin(ang) * len);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.beginPath();
            ctx.arc(b.x + Math.cos(ang) * len, b.y - Math.sin(ang) * len, 5, 0, Math.PI * 2);
            ctx.fill();
            if (this.charging) {
                const pow = Math.max(0.18, this.kbPower);
                const sp = this.minSpeed + (this.maxSpeed - this.minSpeed) * pow;
                this.drawTrajectory(b.x, b.y, Math.cos(ang) * sp, -Math.sin(ang) * sp);
                // barra de força
                const bw = Math.max(80, this.W * 0.16);
                const bh = 10;
                const bx = b.x - bw / 2;
                const by = b.y - b.r * 3.4;
                ctx.fillStyle = "rgba(0,0,0,0.45)";
                ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
                const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
                grad.addColorStop(0, "#6ee7b7");
                grad.addColorStop(0.6, "#ffd166");
                grad.addColorStop(1, "#ff5722");
                ctx.fillStyle = grad;
                ctx.fillRect(bx, by, bw * pow, bh);
            }
        }
    }
    drawTrajectory(x, y, vx, vy) {
        const ctx = this.ctx;
        let px = x;
        let py = y;
        let pvx = vx;
        let pvy = vy;
        const dt = 0.045;
        for (let i = 0; i < 26; i++) {
            pvy += this.gravity * dt;
            px += pvx * dt;
            py += pvy * dt;
            if (py > this.floorY)
                break;
            const t = 1 - i / 26;
            ctx.fillStyle = `rgba(255,255,255,${0.75 * t})`;
            ctx.beginPath();
            ctx.arc(px, py, 4.5 * t + 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    drawParticles() {
        const ctx = this.ctx;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.active)
                continue;
            const t = p.life / p.maxLife;
            if (p.kind === 0) {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.globalAlpha = Math.min(1, t * 1.5);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
                ctx.restore();
            }
            else if (p.kind === 1) {
                ctx.globalAlpha = t * 0.5;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            else if (p.kind === 2) {
                ctx.globalAlpha = t;
                ctx.fillStyle = t > 0.5 ? "#ffd166" : "#ff5722";
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            else {
                ctx.globalAlpha = t;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
    }
    drawPopups() {
        const ctx = this.ctx;
        for (const p of this.popups) {
            const t = 1 - p.life / p.maxLife;
            const scale = t < 0.18 ? this.easeOutBack(t / 0.18) : 1;
            const alpha = p.life < 0.35 ? p.life / 0.35 : 1;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(scale, scale);
            ctx.globalAlpha = alpha;
            ctx.font = `900 ${p.size}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineWidth = Math.max(2, p.size / 7);
            ctx.strokeStyle = "rgba(10,6,20,0.85)";
            ctx.strokeText(p.text, 0, 0);
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, 0, 0);
            ctx.restore();
        }
    }
    easeOutBack(t) {
        const c = 1.70158;
        const u = t - 1;
        return 1 + (c + 1) * u * u * u + c * u * u;
    }
    /* -------------------------------------------------------------- API pública */
    start() {
        this.score = 0;
        this.combo = 0;
        this.timeLeft = GAME_TIME;
        this.startBest = this.best;
        this.recordBroken = false;
        this.hasShot = false;
        this.kbAngle = 60;
        this.kbPower = 0;
        this.charging = false;
        this.aimActive = false;
        this.popups.length = 0;
        this.respawn();
        this.phase = "playing";
        this.cb.onPhase("playing");
        this.emitHud(true);
    }
    pause() {
        if (this.phase !== "playing")
            return;
        this.phase = "paused";
        this.charging = false;
        this.aimActive = false;
        this.cb.onPhase("paused");
    }
    resume() {
        if (this.phase !== "paused")
            return;
        this.phase = "playing";
        this.cb.onPhase("playing");
    }
    toIdle() {
        this.phase = "idle";
        this.idleT = 0;
        this.aimActive = false;
        this.charging = false;
        this.respawn();
        this.cb.onPhase("idle");
    }
    setBest(v) {
        this.best = Math.max(this.best, v);
        this.emitHud(true);
    }
    destroy() {
        cancelAnimationFrame(this.raf);
        if (this.ro)
            this.ro.disconnect();
        this.canvas.removeEventListener("pointerdown", this.onPointerDown);
        this.canvas.removeEventListener("pointermove", this.onPointerMove);
        this.canvas.removeEventListener("pointerup", this.onPointerUp);
        this.canvas.removeEventListener("pointercancel", this.onPointerUp);
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        document.removeEventListener("visibilitychange", this.onVisChange);
    }
    emitHud(force = false) {
        const tl = Math.max(0, Math.ceil(this.timeLeft));
        if (force ||
            this.hudCache.score !== this.score ||
            this.hudCache.timeLeft !== tl ||
            this.hudCache.combo !== this.combo ||
            this.hudCache.best !== this.best) {
            this.hudCache.score = this.score;
            this.hudCache.timeLeft = tl;
            this.hudCache.combo = this.combo;
            this.hudCache.best = this.best;
            this.cb.onHud({
                score: this.score,
                timeLeft: tl,
                combo: this.combo,
                best: this.best,
            });
        }
    }
}

/** Persistência local: tabela de recordes, melhor pontuação e preferência de som. */
const SCORES_KEY = "hooprush.scores.v1";
const BEST_KEY = "hooprush.best.v1";
const MUTE_KEY = "hooprush.muted.v1";
function loadScores() {
    try {
        const raw = localStorage.getItem(SCORES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed))
                return parsed.slice(0, 5);
        }
    }
    catch {
        /* ignorar */
    }
    return [];
}
function saveScore(score) {
    const list = loadScores();
    const isRecord = score > 0 && (list.length === 0 || score > list[0].score);
    const entry = {
        score,
        date: new Date().toLocaleDateString("pt-BR"),
    };
    const next = [...list, entry]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    try {
        localStorage.setItem(SCORES_KEY, JSON.stringify(next));
    }
    catch {
        /* ignorar */
    }
    return { list: next, isRecord };
}
function loadBest() {
    try {
        return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    }
    catch {
        return 0;
    }
}
function saveBest(v) {
    try {
        localStorage.setItem(BEST_KEY, String(v));
    }
    catch {
        /* ignorar */
    }
}
function loadMuted() {
    try {
        return localStorage.getItem(MUTE_KEY) === "1";
    }
    catch {
        return false;
    }
}
function saveMuted(m) {
    try {
        localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    }
    catch {
        /* ignorar */
    }
}

const root = document.getElementById('root');
root.innerHTML = `<div class="app"><div class="game-stage"><canvas id="gameCanvas" class="game-canvas"></canvas></div>
<div class="hud"><div><div class="hud-label">PONTOS</div><div class="hud-score" id="hudScore">0</div><div class="combo-badge" id="comboBadge" hidden>COMBO x2</div></div><div class="hud-timer" id="hudTimer">60</div><div class="hud-right"><div class="hud-best">RECORDE <span id="hudBest">0</span></div><button class="icon-btn" id="muteBtn" aria-label="Silenciar">♫</button><button class="icon-btn" id="pauseBtn" aria-label="Pausar" hidden>Ⅱ</button></div></div>
<div class="overlay" id="menuOverlay"><div class="panel"><div class="logo-ball-wrap"><svg class="logo-ball" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#ff7a1a"/><g stroke="#3a1400" stroke-width="3" fill="none"><path d="M4 50 Q50 62 96 50 M50 4 Q38 50 50 96 M18 14 Q40 50 18 86 M82 14 Q60 50 82 86"/></g></svg><div class="logo-shadow"></div></div><h1 class="logo">HOOP <span>RUSH</span></h1><p class="tagline">Basquete de rua · 60 segundos · quantas cestas você converte?</p><div class="howto"><div class="how-card"><div class="how-icon">☝</div><p><strong>No celular</strong><br>Arraste para mirar e solte para arremessar</p></div><div class="how-card"><div class="how-icon">⌨</div><p><strong>No PC</strong><br>← → miram · segure ESPAÇO e solte</p></div></div><button class="btn primary big" id="startBtn">Jogar</button><div class="best-line" id="bestLine" hidden></div><div class="hint">P = pausa · M = som · cestas sem tocar no aro valem +3</div></div></div>
<div class="overlay" id="pauseOverlay" hidden><div class="panel"><h2 class="pause-title">PAUSADO</h2><p class="pause-sub">Respiração... o cronômetro está parado.</p><button class="btn primary big" id="resumeBtn">▶ Continuar</button><div class="btn-row"><button class="btn ghost medium" id="restartPauseBtn">Recomeçar</button><button class="btn ghost medium" id="menuPauseBtn">Menu</button></div></div></div>
<div class="overlay" id="overOverlay" hidden><div class="panel"><h2 class="over-title">TEMPO ESGOTADO!</h2><div class="final-score" id="finalScore">0</div><div class="final-label">PONTOS</div><div class="record-badge" id="recordBadge" hidden>NOVO RECORDE!</div><div class="score-table"><header><span>#</span><span>PLACAR</span><span>DATA</span></header><div id="scoreRows"></div></div><div class="btn-row"><button class="btn primary medium" id="playAgainBtn">Jogar de novo</button><button class="btn ghost medium" id="menuOverBtn">Menu</button></div><div class="hint">Enter = jogar de novo</div></div></div></div>`;
const $ = id => document.getElementById(id);
let phase='idle', muted=loadMuted(), scores=loadScores(), best=loadBest(), overGuard=false;
const sfx=new SoundFX(); sfx.setMuted(muted);
function renderScores(){ $('scoreRows').innerHTML=scores.length?scores.map((s,i)=>`<div class="score-row"><span class="rank ${i<3?'r'+(i+1):''}">${i+1}</span><span class="row-score">${s.score}</span><span class="row-date">${s.date}</span></div>`).join(''):'<div class="table-empty">Nenhum registro ainda — seja o primeiro!</div>'; }
function setPhase(p){ phase=p; $('menuOverlay').hidden=p!=='idle'; $('pauseOverlay').hidden=p!=='paused'; $('overOverlay').hidden=p!=='over'; $('pauseBtn').hidden=p!=='playing'; $('hudTimer').classList.toggle('low',p==='playing'&&Number($('hudTimer').textContent)<=10); }
$('hudBest').textContent=best; $('bestLine').hidden=!best; $('bestLine').textContent='Seu recorde: '+best;
const engine=new HoopEngine($('gameCanvas'),{onHud(h){$('hudScore').textContent=h.score;$('hudTimer').textContent=h.timeLeft;$('hudBest').textContent=h.best;$('hudTimer').classList.toggle('low',phase==='playing'&&h.timeLeft<=10);$('comboBadge').hidden=h.combo<2;$('comboBadge').textContent='COMBO x'+h.combo;},onPhase:setPhase,onGameOver(score,isRecord){if(overGuard)return;overGuard=true;const result=saveScore(score);scores=result.list;if(score>loadBest())saveBest(score);best=loadBest();engine.setBest(best);$('finalScore').textContent=score;$('recordBadge').hidden=!(isRecord||result.isRecord);$('bestLine').hidden=!best;$('bestLine').textContent='Seu recorde: '+best;renderScores();}},sfx,best);
function startGame(){sfx.ensure();sfx.click();overGuard=false;engine.start();}
function toMenu(){overGuard=false;engine.toIdle();}
function toggleMute(){muted=!muted;sfx.setMuted(muted);saveMuted(muted);$('muteBtn').textContent=muted?'×♫':'♫';$('muteBtn').setAttribute('aria-label',muted?'Ativar som':'Silenciar');}
$('startBtn').onclick=startGame;$('resumeBtn').onclick=()=>{sfx.ensure();engine.resume();};$('pauseBtn').onclick=()=>engine.pause();$('muteBtn').onclick=()=>{sfx.ensure();toggleMute();};$('restartPauseBtn').onclick=startGame;$('menuPauseBtn').onclick=toMenu;$('playAgainBtn').onclick=startGame;$('menuOverBtn').onclick=toMenu;
window.addEventListener('keydown',e=>{if((e.code==='Enter'||e.code==='NumpadEnter')&&(phase==='idle'||phase==='over'))startGame();if(e.code==='KeyP'||e.code==='Escape'){if(phase==='playing')engine.pause();else if(phase==='paused')engine.resume();}if(e.code==='KeyM')toggleMute();});
if(muted)$('muteBtn').textContent='×♫';renderScores();
