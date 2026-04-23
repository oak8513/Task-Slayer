// Cyberdog tamagotchi pet — lives in the HUD arsenal slot.
// Shared component; state + tick loop live in App via useCyberdog hook below.

const DOG_LS = 'taskslayer/cyberdog/v2';

// decay rates per real-minute (tuned so neglect over ~4–8h starts to hurt)
const DECAY = {
  hunger: 0.18,     // -% per minute (reaches 0 in ~9h from full)
  mood:   0.12,
  energy: 0.10,
  overdueBoost: 0.35, // extra hunger/mood drain per minute per overdue task
};

const FEED_PER_TASK = 8;   // % hunger restored per task completion
const FEED_BUTTON   = 20;  // % per manual feed
const PET_GAIN      = 18;  // mood per pet-and-play
const CLEAN_MOOD    = 8;
const SLEEP_ENERGY  = 30;  // energy per sleep tick cycle
const XP_PER_TASK   = 10;

function makeDog() {
  return {
    alive: true,
    hunger: 80,
    mood: 75,
    energy: 70,
    xp: 0,
    level: 1,
    bornAt: Date.now(),
    diedAt: null,
    asleep: false,
    lastTick: Date.now(),
    // transient reaction (not persisted): {kind:'feed'|'pet'|'clean'|'hurt'|'revive', until:ts}
  };
}

function loadDog(){
  try {
    const raw = localStorage.getItem(DOG_LS);
    if (!raw) return makeDog();
    const d = JSON.parse(raw);
    return { ...makeDog(), ...d };
  } catch { return makeDog(); }
}

function saveDog(d){
  try { localStorage.setItem(DOG_LS, JSON.stringify(d)); } catch {}
}

function clamp(n, lo=0, hi=100){ return Math.max(lo, Math.min(hi, n)); }

function advanceDog(dog, now, overdueCount){
  if (!dog.alive) return dog;
  const dtMin = (now - (dog.lastTick || now)) / 60000;
  if (dtMin <= 0) return { ...dog, lastTick: now };
  const boost = 1 + overdueCount * (DECAY.overdueBoost);
  let hunger = clamp(dog.hunger - DECAY.hunger * dtMin * boost);
  let mood   = clamp(dog.mood   - DECAY.mood   * dtMin * boost);
  let energy = clamp(dog.energy - (dog.asleep ? -DECAY.energy*3 : DECAY.energy) * dtMin);
  // starvation damages mood
  if (hunger < 15) mood = clamp(mood - dtMin * 0.3);
  // low energy drops mood
  if (energy < 10) mood = clamp(mood - dtMin * 0.2);

  // death: hunger 0 for an extended stretch OR mood+hunger both at 0
  let alive = dog.alive;
  let diedAt = dog.diedAt;
  if (hunger === 0 && mood === 0 && alive){
    alive = false;
    diedAt = now;
  }

  return { ...dog, hunger, mood, energy, alive, diedAt, lastTick: now };
}

function moodLabel(d){
  if (!d.alive) return 'K.I.A.';
  if (d.asleep) return 'ZZZZ…';
  if (d.hunger < 15) return 'STARVING';
  if (d.mood < 20) return 'DEPRESSED';
  if (d.energy < 15) return 'EXHAUSTED';
  if (d.mood > 80 && d.hunger > 60) return 'HAPPY';
  if (d.mood > 60) return 'CONTENT';
  return 'OK';
}

// ---- Sprite: Real pixel-art German Shepherd photo sprite ----
// Picks a face image based on current state (hunger/mood/energy/alive/reaction).
function dogFaceForState(dog, reaction){
  if (!dog.alive) return 'crying';        // K.I.A. — full tears
  if (reaction === 'feed' || reaction === 'pet') return 'happy';
  if (reaction === 'clean') return 'alert';
  if (dog.asleep) return 'tired';
  // composite "misery" score — higher = sadder face
  const misery = (100 - dog.hunger) * 0.6 + (100 - dog.mood) * 0.9 + (100 - dog.energy) * 0.3;
  // Scale: 0 = perfect, ~230 = all zero
  if (misery < 40) return 'happy';
  if (misery < 75) return 'alert';
  if (misery < 110) return 'neutral';
  if (misery < 140) return 'tired';
  if (misery < 170) return 'sad';
  if (misery < 200) return 'hurt';
  return 'teary';
}

function CyberdogSprite({ dog, reaction }){
  const [breath, setBreath] = React.useState(0);
  React.useEffect(()=>{
    let raf; const start = performance.now();
    const tick = (t) => {
      setBreath(Math.sin((t-start)/900));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[]);

  const face = dogFaceForState(dog, reaction);
  const dead = !dog.alive;
  const asleep = dog.asleep && dog.alive;
  const bob = dead ? 0 : asleep ? breath * 0.8 : breath * 1.6;

  return (
    <div className="dog-sprite" data-dead={dead}>
      <img
        src={`dogs/${face}.png?v=1`}
        alt={face}
        style={{
          transform:`translateY(${bob}px)`,
          transition:'transform 60ms linear',
          filter: reaction === 'pet' ? 'drop-shadow(0 0 8px rgba(255,122,26,0.7))'
                : reaction === 'feed' ? 'drop-shadow(0 0 6px rgba(96,255,133,0.5))'
                : reaction === 'clean' ? 'drop-shadow(0 0 8px rgba(159,208,255,0.7))'
                : 'none',
        }}
      />
      {/* Reaction overlays */}
      {reaction === 'feed' && <div className="dog-react">♥ +HGR</div>}
      {reaction === 'pet'  && <div className="dog-react">♥♥♥</div>}
      {reaction === 'clean'&& <div className="dog-react">✧ ✦ ✧</div>}
      {asleep && <div className="dog-react dog-react-zzz">Z z z</div>}
      {dead && <div className="dog-react dog-react-kia">K.I.A.</div>}
    </div>
  );
}

// ---- Bar component ----
function DogBar({label, value, color, warn}){
  const lowColor = warn && value < 25 ? '#ff3b2f' : color;
  return (
    <div className="dog-bar">
      <span className="dog-bar-label">{label}</span>
      <div className="dog-bar-track">
        <div className="dog-bar-fill" style={{width:`${Math.round(value)}%`, background:lowColor, boxShadow:`0 0 6px ${lowColor}66`}}/>
      </div>
      <span className="dog-bar-num" style={{color:lowColor}}>{Math.round(value)}</span>
    </div>
  );
}

// ---- Main panel ----
function CyberdogPanel({ dog, setDog, petName = 'REX' }){
  const [reaction, setReaction] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false); // mobile-only toggle
  const pulse = (k, ms=900) => {
    setReaction(k);
    clearTimeout(pulse._t);
    pulse._t = setTimeout(()=>setReaction(null), ms);
  };

  const act = (kind) => {
    if (!dog.alive && kind !== 'revive') return;
    setDog(prev => {
      const n = { ...prev };
      if (kind === 'feed'){
        n.hunger = clamp(prev.hunger + FEED_BUTTON);
        n.mood   = clamp(prev.mood + 4);
        n.xp += 2;
      } else if (kind === 'pet'){
        n.mood   = clamp(prev.mood + PET_GAIN);
        n.energy = clamp(prev.energy - 3);
        n.xp += 2;
      } else if (kind === 'clean'){
        n.mood   = clamp(prev.mood + CLEAN_MOOD);
        n.xp += 1;
      } else if (kind === 'sleep'){
        n.asleep = !prev.asleep;
      } else if (kind === 'revive'){
        const dead = makeDog();
        dead.xp = 0; dead.level = 1;
        return { ...dead, bornAt: Date.now() };
      }
      // level up every 50xp
      while (n.xp >= 50){ n.xp -= 50; n.level += 1; }
      return n;
    });
    pulse(kind === 'sleep' ? null : kind);
    // 8-bit bark on feed/pet (only when alive)
    if (dog.alive && (kind === 'feed' || kind === 'pet')){
      if (typeof window.playBark === 'function') window.playBark(true, kind);
    }
  };

  const age = Math.floor((Date.now() - (dog.bornAt||Date.now())) / 60000); // minutes
  const mood = moodLabel(dog);

  return (
    <div className="dog-panel" data-expanded={expanded ? 'true' : 'false'}>
      <div className="dog-header">
        <span className="stat-label">PET.EXE</span>
        <span className="dog-name">{petName}_K9_UNIT</span>
        <span className="dog-status">{mood}</span>
      </div>

      <div className="dog-body">
        <div className="dog-window" onClick={()=>setExpanded(e=>!e)} role="button" title="Tap to toggle stats">
          <div className="dog-window-inner" data-dead={!dog.alive}>
            <CyberdogSprite dog={dog} reaction={reaction}/>
          </div>
          <div className="dog-window-scan"/>
          <div className="dog-tap-hint">TAP</div>
        </div>

        <div className="dog-stats">
          <DogBar label="HGR" value={dog.hunger} color="#ff7a1a" warn/>
          <DogBar label="MOD" value={dog.mood}   color="#60ff85" warn/>
          <DogBar label="NRG" value={dog.energy} color="#4aa3ff"/>
          <div className="dog-meta">
            <span>LVL <b>{dog.level}</b></span>
            <span>XP {dog.xp}/50</span>
            <span>AGE {age}m</span>
          </div>
        </div>
      </div>

      <div className="dog-actions">
        {dog.alive ? (
          <>
            <button className="dog-btn" onClick={()=>act('feed')} title="Feed (+hunger)">FEED</button>
            <button className="dog-btn" onClick={()=>act('pet')} title="Play (+mood)">PET</button>
            <button className="dog-btn" onClick={()=>act('clean')} title="Clean (+mood)">CLN</button>
            <button className={"dog-btn"+(dog.asleep?' on':'')} onClick={()=>act('sleep')} title="Toggle sleep">
              {dog.asleep?'WAKE':'SLP'}
            </button>
          </>
        ) : (
          <button className="dog-btn revive" onClick={()=>act('revive')} title="Reboot cyberdog">REVIVE</button>
        )}
      </div>
    </div>
  );
}

Object.assign(window, {
  CyberdogPanel, CyberdogSprite,
  loadDog, saveDog, advanceDog, makeDog,
  FEED_PER_TASK, XP_PER_TASK, clamp,
});
