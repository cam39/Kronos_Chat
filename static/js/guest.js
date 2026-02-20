const guestStory = (() => {
    const state = { affinity: 0, mood: 'neutral', inventory: [], flags: {}, history: [], soundEnabled: false, sceneMap: {} };
    let scenes = {};

    const textEl = document.getElementById('story-text');
    const metaEl = document.getElementById('story-meta');
    const choicesEl = document.getElementById('choices');
    const toggleSoundBtn = document.getElementById('toggle-sound');
    const resetBtn = document.getElementById('reset-session');
    const coreEl = document.getElementById('kronos-core');

    let audioCtx;
    function ensureAudio() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
        }
        return audioCtx;
    }
    function hashStr(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        return Math.abs(h);
    }
    function playBubbleVoice(id) {
        if (!state.soundEnabled) return;
        const ctx = ensureAudio();
        if (!ctx) return;
        const base = 180 + (hashStr(id) % 60);
        const osc = ctx.createOscillator();
        const filt = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base, ctx.currentTime);
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(900, ctx.currentTime);
        filt.Q.value = 0.7;
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.18);
        osc.connect(filt);
        filt.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    }
    function setMood(mood) {
        state.mood = mood;
        if (coreEl) {
            coreEl.style.boxShadow = mood === 'angry'
              ? '0 0 24px rgba(255,80,80,0.5), inset 0 0 24px rgba(255,80,80,0.25)'
              : mood === 'happy'
              ? '0 0 24px rgba(204,255,0,0.6), inset 0 0 24px rgba(204,255,0,0.3)'
              : '0 0 14px rgba(204,255,0,0.25), inset 0 0 14px rgba(204,255,0,0.15)';
            coreEl.style.borderColor = mood === 'angry' ? '#ff5050' : 'var(--accent)';
        }
    }

    function playTypingSound(seed) {
        if (!state.soundEnabled) return;
        const ctx = ensureAudio();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const filt = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            const r = (seed * 9301 + 49297) % 233280;
            const f = 220 + (r % 40);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, ctx.currentTime);
            filt.type = 'lowpass';
            filt.frequency.setValueAtTime(800, ctx.currentTime);
            filt.Q.value = 0.9;
            gain.gain.setValueAtTime(0.001, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.004, ctx.currentTime + 0.06);
            osc.connect(filt);
            filt.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.07);
        } catch (e) {
            console.warn('Audio init failed', e);
        }
    }

    function typeWriter(text, cb, sceneId) {
        if (sceneId) {
            playBubbleVoice(sceneId);
            playTypingSound(hashStr(sceneId));
        }
        textEl.textContent = '';
        let i = 0;
        const charsPerFrame = 2;
        const step = () => {
            if (i < text.length) {
                const next = Math.min(charsPerFrame, text.length - i);
                textEl.textContent += text.slice(i, i + next);
                i += next;
                if (Math.random() > 0.5) playTypingSound(i + hashStr(sceneId || 'x'));
                window.requestAnimationFrame(step);
            } else if (cb) {
                cb();
            }
        };
        step();
    }

    function persist() {
        try {
            const payload = {
                affinity: state.affinity,
                mood: state.mood,
                inventory: state.inventory,
                flags: state.flags,
                history: state.history
            };
            fetch('/api/guest/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(() => {});
        } catch (e) {
            console.error('Persist error', e);
        }
    }

    function choose(sceneId) {
        const scene = scenes[sceneId] || state.sceneMap[sceneId];
        if (!scene) return;
        state.history.push(sceneId);
        persist();

        if (sceneId.startsWith('ending_')) {
            setMood(state.affinity > 1 ? 'happy' : state.affinity < 0 ? 'angry' : 'neutral');
        } else {
            if (state.affinity > 2) setMood('happy');
            else if (state.affinity < -1) setMood('angry');
            else setMood('curious');
        }

        const content = Array.isArray(scene.paragraphs) ? scene.paragraphs.join('\\n\\n') : String(scene.text || '');
        typeWriter(content, () => {
            if (metaEl) metaEl.textContent = `Scène: ${scene.id || 'n/a'}`;
            choicesEl.innerHTML = '';
            (scene.choices || []).forEach(choice => {
                const btn = document.createElement('button');
                btn.className = 'btn-guest';
                btn.textContent = choice.label;
                btn.onclick = () => {
                    state.affinity += choice.deltaAffinity || 0;
                    const children = Array.from(choicesEl.children);
                    children.forEach(ch => ch.disabled = true);
                    choicesEl.innerHTML = '';
                    try {
                        fetch('/api/guest/log', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                scene: scene.id || '',
                                text: scene.text || '',
                                vars: scene.vars || {},
                                choice: choice.id || ''
                            })
                        }).catch(() => {});
                    } catch (e) {}
                    choose(choice.next);
                };
                choicesEl.appendChild(btn);
            });
        }, scene.id || '');
    }

    if (toggleSoundBtn) {
        toggleSoundBtn.addEventListener('click', () => {
            state.soundEnabled = !state.soundEnabled;
            toggleSoundBtn.textContent = state.soundEnabled ? 'Son: ON' : 'Son: OFF';
            toggleSoundBtn.setAttribute('aria-pressed', state.soundEnabled ? 'true' : 'false');
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            state.affinity = 0;
            state.mood = 'neutral';
            state.inventory = [];
            state.flags = {};
            state.history = [];
            persist();
            choose('intro');
        });
    }

    async function loadDialogues() {
        try {
            const buildMap = (data) => {
                const m = {};
                (data.scenes || []).forEach(s => { m[s.id] = s; });
                if (Array.isArray(data.templates)) {
                    data.templates.forEach(t => {
                        const count = Math.max(1, Math.min(30000, parseInt(t.count || 0)));
                        const prefix = String(t.prefix || 'auto');
                        for (let i = 1; i <= count; i++) {
                            const id = `${prefix}_${i}`;
                            const nextId = i < count ? `${prefix}_${i+1}` : (t.end1 || 'ending_observer');
                            m[id] = {
                                id,
                                node: t.node || 'auto',
                                text: String(t.text || '').replace('{i}', i),
                                vars: t.vars || {},
                                choices: [
                                    { id: `${id}_cont`, label: t.continue_label || 'Continuer', next: nextId },
                                    { id: `${id}_branch`, label: t.branch_label || 'Explorer', next: t.branch_next || 'resilience' },
                                    { id: `${id}_exit`, label: t.exit_label || 'Quitter', next: t.end2 || 'ending_ghost' }
                                ]
                            };
                        }
                    });
                }
                return m;
            };
            let chosen = {};
            try {
                const resExpanded = await fetch('/static/data/guest_dialogues_expanded.json', { cache: 'no-cache' });
                if (resExpanded.ok) {
                    const dataExpanded = await resExpanded.json();
                    chosen = buildMap(dataExpanded);
                }
            } catch (_) {}
            try {
                const resBase = await fetch('/static/data/guest_dialogues.json', { cache: 'no-cache' });
                if (resBase.ok) {
                    const dataBase = await resBase.json();
                    const mapBase = buildMap(dataBase);
                    if (Object.keys(mapBase).length > Object.keys(chosen).length) chosen = mapBase;
                }
            } catch (_) {}
            scenes = chosen;
        } catch (e) { console.error('Dialogue load failed', e); }
    }

    window.addEventListener('load', async () => {
        await loadDialogues();
        if (textEl && choicesEl) choose('intro');
        const canvas = document.getElementById('matrix-bg');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const cols = Math.floor(canvas.width / 20);
            const drops = new Array(cols).fill(1);
            setInterval(() => {
                ctx.fillStyle = 'rgba(9, 9, 11, 0.05)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ccff00';
                ctx.font = '15px monospace';
                for (let i = 0; i < drops.length; i++) {
                    const char = String.fromCharCode(33 + Math.random() * 94);
                    ctx.fillText(char, i * 20, drops[i] * 20);
                    if (drops[i] * 20 > canvas.height && Math.random() > 0.975) drops[i] = 0;
                    drops[i]++;
                }
            }, 33);
        }
    });

    return { choose };
})();
