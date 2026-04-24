const { useState, useEffect, useMemo, useRef, useCallback } = React;

// --------- Rank titles (unlocked by LEVEL) ---------
const RANKS = [
  'RECRUIT',      // 1
  'PRIVATE',      // 2
  'CORPORAL',     // 3
  'SERGEANT',     // 4
  'STAFF SGT',    // 5
  'LIEUTENANT',   // 6
  'CAPTAIN',      // 7
  'MAJOR',        // 8
  'COLONEL',      // 9
  'GENERAL',      // 10
  'MARSHAL',      // 11
  'LEGEND',       // 12+
];
function rankFor(level){
  return RANKS[Math.min(level-1, RANKS.length-1)] || 'RECRUIT';
}

// --------- storage ---------
const LS_KEY = 'taskslayer/v1';
const LS_TWEAKS = 'taskslayer/tweaks/v1';
const LS_POS = 'taskslayer/pos/v1';

function uid(){ return Math.random().toString(36).slice(2,9); }
function now(){ return Date.now(); }

const DEFAULT_TASKS = [
  { id: uid(), title: "Stand-up @ 09:30", due: isoToday(9,30), recurrence: "weekdays", done:false, boss:false },
  { id: uid(), title: "Ship pricing-page copy", due: isoToday(12,0), recurrence: "none", done:false, boss:false },
  { id: uid(), title: "Inbox zero", due: isoYesterday(17,0), recurrence: "daily", done:false, boss:false },
  { id: uid(), title: "BOSS: Q2 planning doc", due: isoInDays(3,17,0), recurrence: "none", done:false, boss:true, hpMax:5, hpLeft:3 },
  { id: uid(), title: "Gym — legs", due: isoToday(18,30), recurrence: "weekly", done:false, boss:false },
  { id: uid(), title: "Water the plants", due: isoInDays(-2, 9, 0), recurrence: "weekly", done:false, boss:false },
];

function isoToday(h, m){
  const d = new Date(); d.setHours(h,m,0,0); return d.getTime();
}
function isoYesterday(h,m){
  const d = new Date(); d.setDate(d.getDate()-1); d.setHours(h,m,0,0); return d.getTime();
}
function isoInDays(days,h,m){
  const d = new Date(); d.setDate(d.getDate()+days); d.setHours(h,m,0,0); return d.getTime();
}
function toLocalInput(ts){
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s){
  if (!s) return null;
  return new Date(s).getTime();
}
function fmtDue(ts){
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const dayDiff = Math.round((new Date(ts).setHours(0,0,0,0) - today.getTime()) / 86400000);
  const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  if (dayDiff === 0) return `TODAY ${t}`;
  if (dayDiff === 1) return `TMRW  ${t}`;
  if (dayDiff === -1) return `YDAY  ${t}`;
  if (dayDiff > 0 && dayDiff < 7) return `+${dayDiff}D   ${t}`;
  if (dayDiff < 0) return `-${Math.abs(dayDiff)}D   ${t}`;
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' ' + t;
}
function isOverdue(task){
  if (task.done) return false;
  return task.due && task.due < now();
}

function nextRecurrence(task){
  if (!task.due || task.recurrence==='none') return null;
  const d = new Date(task.due);
  // advance until in the future
  const advance = () => {
    if (task.recurrence==='daily') d.setDate(d.getDate()+1);
    else if (task.recurrence==='weekly') d.setDate(d.getDate()+7);
    else if (task.recurrence==='weekdays'){
      do { d.setDate(d.getDate()+1); } while (d.getDay()===0 || d.getDay()===6);
    } else if (task.recurrence==='monthly') d.setMonth(d.getMonth()+1);
  };
  advance();
  while (d.getTime() < now()) advance();
  return d.getTime();
}

// --------- state hooks ---------
function useLocalState(key, initial){
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch(e){}
    return typeof initial === 'function' ? initial() : initial;
  });
  useEffect(()=>{
    try { localStorage.setItem(key, JSON.stringify(v)); } catch(e){}
  },[key,v]);
  return [v, setV];
}

// --------- Tweaks default block (persisted via parent host) ---------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scanlines": true,
  "faceStyle": "pixel",
  "sfxOn": true,
  "flags": {}
}/*EDITMODE-END*/;

// --------- Root ---------
function App(){
  const [tasks, setTasks] = useLocalState(LS_KEY, DEFAULT_TASKS);
  const [tweaks, setTweaks] = useLocalState(LS_TWEAKS, TWEAK_DEFAULTS);
  const [tab, setTab] = useState('today');
  const [editing, setEditing] = useState(null); // task or {}
  const [editMode, setEditMode] = useState(false); // tweaks panel visibility
  const [tick, setTick] = useState(0);
  const [dog, setDogState] = useState(() => loadDog());
  const [medpacks, setMedpacks] = useLocalState('taskslayer/medpacks/v1', 0); // earned HP buffer from kills
  const [ammo, setAmmo] = useLocalState('taskslayer/ammo/v1', 0); // earned currency, spent on rewards
  const [totalEarned, setTotalEarned] = useLocalState('taskslayer/ammo-earned/v1', 0); // lifetime ammo earned (drives LEVEL)
  const [demotions, setDemotions] = useLocalState('taskslayer/demotions/v1', 0); // times HP hit 0 (reduces LEVEL)
  const [vacation, setVacation] = useLocalState('taskslayer/vacation/v1', null); // {startedAt: ms} or null
  const [levelUpFx, setLevelUpFx] = useState(null); // {level, title}
  const [deathFx, setDeathFx] = useState(null); // {countdown}
  const prevLevelRef = useRef(null);
  const prevHpRef = useRef(100);

  // One-time starter ammo boost for existing players (so they can test the Arsenal)
  useEffect(()=>{
    try {
      if (!localStorage.getItem('taskslayer/ammo/starter-granted')){
        setAmmo(a => a + 150);
        setTotalEarned(t => t + 150); // count it toward leveling
        localStorage.setItem('taskslayer/ammo/starter-granted', '1');
      }
      // seed totalEarned for existing players who already had ammo (one-time)
      if (!localStorage.getItem('taskslayer/earned-seeded/v1')){
        const current = parseInt(localStorage.getItem('taskslayer/ammo/v1') || '0', 10) || 0;
        if (current > 0) setTotalEarned(t => Math.max(t, current));
        localStorage.setItem('taskslayer/earned-seeded/v1', '1');
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const [rewards, setRewards] = useLocalState('taskslayer/rewards/v1', [
    { id: 'r1', name: 'Candy Bar',       cost: 40,  icon: 'pistol',  desc: 'A sweet frag reward.' },
    { id: 'r2', name: '15-Min Break',    cost: 25,  icon: 'knife',   desc: 'Stand down for 15.' },
    { id: 'r3', name: 'Coffee Run',      cost: 35,  icon: 'shotgun', desc: 'Fuel up, soldier.' },
    { id: 'r4', name: 'Episode of TV',   cost: 60,  icon: 'smg',     desc: 'One episode, then back to work.' },
    { id: 'r5', name: 'Game Hour',       cost: 80,  icon: 'rocket',  desc: '60 minutes of games.' },
    { id: 'r6', name: 'Day Off',         cost: 200, icon: 'bfg',     desc: 'Ultimate payout. Earned.' },
  ]);
  const [unlockFx, setUnlockFx] = useState(null); // {name, icon} for unlock animation
  const [faceMenu, setFaceMenu] = useState(false); // marine face click menu

  const startVacation = () => {
    setVacation({ startedAt: Date.now() });
    setFaceMenu(false);
  };
  const endVacation = () => {
    if (!vacation) return;
    const elapsed = Date.now() - vacation.startedAt;
    // Grace: push all active task due dates forward by the vacation duration
    setTasks(ts => ts.map(t => {
      if (t.done) return t;
      if (!t.due) return t;
      return { ...t, due: t.due + elapsed };
    }));
    setVacation(null);
    setFaceMenu(false);
  };
  const setDog = useCallback((fnOrVal) => {
    setDogState(prev => {
      const next = typeof fnOrVal === 'function' ? fnOrVal(prev) : fnOrVal;
      saveDog(next);
      return next;
    });
  }, []);
  const fxLayerRef = useRef(null);

  // Edit-mode protocol
  useEffect(()=>{
    function onMsg(e){
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') setEditMode(true);
      else if (d.type === '__deactivate_edit_mode') setEditMode(false);
    }
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type:'__edit_mode_available'}, '*');
    return ()=> window.removeEventListener('message', onMsg);
  },[]);

  // Persist tweaks to parent
  const commitTweak = (patch) => {
    setTweaks(t => {
      const next = {...t, ...patch};
      try { window.parent.postMessage({type:'__edit_mode_set_keys', edits: next},'*'); } catch(e){}
      return next;
    });
  };

  // Apply scanline toggle on body
  useEffect(()=>{
    document.body.classList.toggle('crt', !!tweaks.scanlines);
  },[tweaks.scanlines]);

  // Periodic tick so overdue updates live
  useEffect(()=>{
    const id = setInterval(()=> setTick(t=>t+1), 15000);
    return ()=>clearInterval(id);
  },[]);

  // Cyberdog decay tick — every 15s, advance stats (paused during vacation)
  const vacationRef = useRef(null);
  useEffect(()=>{ vacationRef.current = vacation; },[vacation]);
  useEffect(()=>{
    const advance = () => {
      if (vacationRef.current) {
        // On vacation: freeze Rex by resetting lastTick so no time elapses
        setDog(prev => prev.alive ? { ...prev, lastTick: Date.now() } : prev);
        return;
      }
      setDog(prev => advanceDog(prev, Date.now(), overdueCountRef.current || 0));
    };
    // also advance on mount so time-away shows up
    advance();
    const id = setInterval(advance, 15000);
    return ()=>clearInterval(id);
  },[setDog]);

  // Derived HUD numbers
  const { hp, level, score, activeTasks, overdueCount } = useMemo(()=>{
    const active = tasks.filter(t=>!t.done);
    // While on vacation, nothing is overdue (grace period)
    const overdue = vacation ? [] : active.filter(isOverdue);
    // HP: starts 100, -15 per overdue non-boss, -25 per overdue boss (capped)
    let hp = 100;
    for (const t of overdue){
      hp -= t.boss ? 25 : 15;
    }
    hp += medpacks; // medpacks from kills push HP up (over-heal capped at 100)
    hp = Math.max(0, Math.min(100, hp));
    // AMMO: active tasks remaining today
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
    const ammo = active.filter(t => t.due && t.due >= todayStart.getTime() && t.due <= todayEnd.getTime()).length;
    // Score: done tasks * 10, bosses = hpMax*50
    const score = tasks.reduce((s,t)=>{
      if (!t.done) return s;
      return s + (t.boss ? (t.hpMax||3)*50 : 10);
    }, 0);
    const level = Math.max(1, Math.floor(totalEarned / 1000) + 1 - demotions);
    return { hp, level, score, activeTasks: active.length, overdueCount: overdue.length };
  }, [tasks, tick, medpacks, totalEarned, demotions, vacation]);

  // Keep overdue in a ref so the dog tick always reads the latest value
  const overdueCountRef = useRef(0);
  useEffect(()=>{ overdueCountRef.current = overdueCount; },[overdueCount]);

  // --- LEVEL UP detection ---
  useEffect(() => {
    if (prevLevelRef.current === null) {
      prevLevelRef.current = level;
      return;
    }
    if (level > prevLevelRef.current) {
      const rank = rankFor(level);
      setLevelUpFx({ level, title: rank });
      // play boss sfx as celebration
      playSfx(tweaks.sfxOn, 'boss', window.innerWidth/2, window.innerHeight/3);
      setTimeout(() => setLevelUpFx(null), 3000);
    }
    prevLevelRef.current = level;
  }, [level, tweaks.sfxOn]);

  // --- DEATH detection (HP crosses from >0 to 0) ---
  useEffect(() => {
    const wasAlive = prevHpRef.current > 0;
    if (wasAlive && hp === 0 && !deathFx) {
      // trigger death
      const canDemote = level > 1;
      setDeathFx({ canDemote, countdown: 5 });
      // demote if possible
      if (canDemote) {
        setDemotions(d => d + 1);
      }
      // heal up to 50 by adding medpacks so HP isn't 0 forever
      // (medpacks added so derived HP = baseline(from overdue) + medpacks, capped 100.
      //  Target: HP ~= 50. overdue damage roughly = (100 - baseline). Easiest: just force
      //  medpacks to 50, user can still take damage again from overdue tasks tomorrow.)
      setMedpacks(50);
      playSfx(tweaks.sfxOn, 'hit', window.innerWidth/2, window.innerHeight/2);
    }
    prevHpRef.current = hp;
  }, [hp, level, deathFx, tweaks.sfxOn]);

  // Death countdown
  useEffect(() => {
    if (!deathFx) return;
    if (deathFx.countdown <= 0) { setDeathFx(null); return; }
    const t = setTimeout(() => setDeathFx(d => d ? { ...d, countdown: d.countdown - 1 } : null), 1000);
    return () => clearTimeout(t);
  }, [deathFx]);

  // --------- Task actions ---------
  const addTask = (t) => setTasks(ts => [...ts, {id: uid(), done:false, ...t}]);
  const updateTask = (id, patch) => setTasks(ts => ts.map(t => t.id===id ? {...t, ...patch} : t));
  const deleteTask = (id) => setTasks(ts => ts.filter(t => t.id !== id));

  const flashFace = () => {
    const el = document.querySelector('.face-frame');
    if (el){ el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  };

  const feedDogFromTask = (isBoss, amount) => {
    setDog(d => {
      if (!d.alive) return d;
      let hunger = clamp(d.hunger + amount);
      let mood = clamp(d.mood + (isBoss ? 10 : 3));
      let xp = d.xp + (isBoss ? XP_PER_TASK * 3 : XP_PER_TASK);
      let level = d.level;
      while (xp >= 50){ xp -= 50; level += 1; }
      return { ...d, hunger, mood, xp, level };
    });
  };

  // Grant HP medpack (capped so you can't overflow to infinity).
  // Medpacks count toward HP in the derived state; cap at +50 buffer.
  const grantMedpack = (amount) => {
    setMedpacks(m => Math.min(50, Math.max(0, m + amount)));
  };

  const completeTask = (task, e) => {
    // Spawn gibs at click point
    const rect = e?.currentTarget?.getBoundingClientRect?.();
    const ox = rect ? rect.left + rect.width/2 : window.innerWidth/2;
    const oy = rect ? rect.top + rect.height/2 : window.innerHeight/2;
    if (task.boss){
      // boss takes multiple hits
      const left = (task.hpLeft ?? task.hpMax ?? 3) - 1;
      if (left > 0){
        updateTask(task.id, { hpLeft: left });
        spawnGibs(ox, oy, true, 10);
        spawnBoom(ox, oy, '-HP!');
        playSfx(tweaks.sfxOn, 'hit', ox, oy);
        feedDogFromTask(false, FEED_PER_TASK / 2);
        return;
      } else {
        // boss down
        spawnGibs(ox, oy, true, 60);
        spawnBoom(ox, oy, 'BOSS DOWN! +5 AMMO');
        playSfx(tweaks.sfxOn, 'boss', ox, oy);
        feedDogFromTask(true, FEED_PER_TASK * 2);
        grantMedpack(25 + (task.hpMax || 3) * 5); // big heal for boss
        setAmmo(a => a + 5);
        setTotalEarned(t => t + 5);
        if (task.recurrence && task.recurrence !== 'none'){
          const nx = nextRecurrence(task);
          updateTask(task.id, { done:false, hpLeft: task.hpMax||3, due: nx });
        } else {
          updateTask(task.id, { done:true });
        }
        return;
      }
    }
    // normal task
    spawnGibs(ox, oy, false, 24);
    spawnBoom(ox, oy, 'KILL! +1 AMMO');
    playSfx(tweaks.sfxOn, 'frag', ox, oy);
    feedDogFromTask(false, FEED_PER_TASK);
    grantMedpack(5); // small heal per kill
    setAmmo(a => a + 1);
    setTotalEarned(t => t + 1);
    if (task.recurrence && task.recurrence !== 'none'){
      const nx = nextRecurrence(task);
      updateTask(task.id, { done:false, due: nx });
    } else {
      updateTask(task.id, { done:true });
    }
  };

  // --------- FX ---------
  const spawnGibs = (x,y,boss,n) => {
    const layer = fxLayerRef.current; if (!layer) return;
    for (let i=0;i<n;i++){
      const g = document.createElement('div');
      g.className = 'gib' + (boss?' boss':'');
      g.style.left = x + 'px'; g.style.top = y + 'px';
      const ang = Math.random()*Math.PI*2;
      const spd = 120 + Math.random()*260;
      const dx = Math.cos(ang)*spd; const dy = Math.sin(ang)*spd - 100;
      layer.appendChild(g);
      const start = performance.now();
      const dur = 700 + Math.random()*400;
      function step(t){
        const p = (t-start)/dur;
        if (p>=1){ g.remove(); return; }
        const gx = x + dx*p;
        const gy = y + dy*p + 600*p*p;
        g.style.transform = `translate(${gx-x}px, ${gy-y}px) scale(${1 - p*0.5})`;
        g.style.opacity = 1 - p;
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    flashFace();
  };
  const spawnBoom = (x,y,txt) => {
    const layer = fxLayerRef.current; if (!layer) return;
    const el = document.createElement('div');
    el.className='boom'; el.textContent = txt;
    el.style.left = x+'px'; el.style.top = y+'px';
    layer.appendChild(el);
    const start = performance.now();
    function step(t){
      const p = (t-start)/700;
      if (p>=1){ el.remove(); return; }
      el.style.transform = `translate(-50%,-50%) scale(${1+p*0.6})`;
      el.style.opacity = 1-p;
      el.style.filter = `hue-rotate(${p*40}deg)`;
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  const filtered = useMemo(()=>{
    const all = tasks.slice().sort((a,b)=>{
      if (a.done !== b.done) return a.done?1:-1;
      return (a.due||Infinity) - (b.due||Infinity);
    });
    const today0 = new Date(); today0.setHours(0,0,0,0);
    const today1 = new Date(); today1.setHours(23,59,59,999);
    if (tab==='today') return all.filter(t=>!t.done && t.due && t.due <= today1.getTime());
    if (tab==='upcoming') return all.filter(t=>!t.done && t.due && t.due > today1.getTime());
    if (tab==='bosses') return all.filter(t=>t.boss && !t.done);
    if (tab==='done') return all.filter(t=>t.done);
    return all;
  },[tasks, tab, tick]);

  const counts = useMemo(()=>{
    const today1 = new Date(); today1.setHours(23,59,59,999);
    return {
      today: tasks.filter(t=>!t.done && t.due && t.due<=today1.getTime()).length,
      upcoming: tasks.filter(t=>!t.done && t.due && t.due>today1.getTime()).length,
      bosses: tasks.filter(t=>t.boss && !t.done).length,
      done: tasks.filter(t=>t.done).length,
    };
  },[tasks, tick]);

  const faceState = healthToFaceState(hp);

  return (
    <>
      <div className="fx-layer" ref={fxLayerRef}/>
      <div className={"stage" + (vacation ? " standby" : "")}>
        <div className="screen">
          <div className="screen-header">
            <div className="title">
              <span className="dot"/>
              <span className="banner">TASK&nbsp;SLAYER</span>
              <span style={{color:'var(--ink-dim)',fontSize:8}}>v1.0  ·  E1M{level}</span>
            </div>
            <div style={{display:'flex',gap:14,alignItems:'center',fontSize:8,color:'var(--ink)'}}>
              <span>OVERDUE: {overdueCount}</span>
              <span>ACTIVE: {activeTasks}</span>
              <ClockBlock mini/>
              <span style={{color:'var(--ink-hot)'}}>◉ REC</span>
            </div>
          </div>

          <div className="screen-body">
            <TaskAddBar onAdd={addTask}/>

            <div className="tabs">
              <Tab id="today" current={tab} onClick={setTab} label="TODAY" count={counts.today}/>
              <Tab id="upcoming" current={tab} onClick={setTab} label="UPCOMING" count={counts.upcoming}/>
              <Tab id="bosses" current={tab} onClick={setTab} label="BOSSES" count={counts.bosses}/>
              <Tab id="done" current={tab} onClick={setTab} label="FRAGGED" count={counts.done}/>
              <Tab id="rewards" current={tab} onClick={setTab} label="ARSENAL" count={rewards.length} hot={ammo>=Math.min(...rewards.map(r=>r.cost))}/>
            </div>

            {tab === 'rewards' ? (
              <Arsenal
                rewards={rewards}
                setRewards={setRewards}
                ammo={ammo}
                onRedeem={(r)=>{
                  if (ammo < r.cost) return;
                  setAmmo(a => a - r.cost);
                  setUnlockFx({ name: r.name, icon: r.icon, ts: Date.now() });
                  playSfx(tweaks.sfxOn, 'boss', window.innerWidth/2, window.innerHeight/2);
                  setTimeout(()=> setUnlockFx(null), 2200);
                }}
              />
            ) : (
            <div className="task-list">
              {tab !== 'rewards' && filtered.length === 0 && (
                <div className="empty">
                  <span className="big">NO HOSTILES IN SECTOR</span>
                  {tab==='today' ? 'All clear for today. Enjoy the silence, marine.' :
                   tab==='bosses' ? 'No active bosses. Slay something bigger — use [+ BOSS].' :
                   tab==='done' ? 'No frags logged yet. Go get some.' :
                   'Nothing upcoming. Add a task above.'}
                </div>
              )}
              {filtered.map(t => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onComplete={completeTask}
                  onEdit={()=> setEditing(t)}
                  onDelete={()=> deleteTask(t.id)}
                  onSnooze={()=> {
                    const add = t.boss ? 86400000 : 3600000; // boss +1d, others +1h
                    updateTask(t.id, { due: (t.due||now()) + add });
                  }}
                />
              ))}
            </div>
            )}
          </div>
        </div>

        <Hud hp={hp} ammo={ammo} level={level} score={score}
             faceState={faceState} faceStyle={tweaks.faceStyle}
             overdueCount={overdueCount}
             totalEarned={totalEarned}
             vacation={vacation}
             faceMenu={faceMenu} setFaceMenu={setFaceMenu}
             onStartVacation={startVacation} onEndVacation={endVacation}
             dog={dog} setDog={setDog}/>
      </div>

      {editing && (
        <TaskModal
          task={editing.id ? editing : null}
          onCancel={()=>setEditing(null)}
          onSave={(patch)=>{
            if (editing.id) updateTask(editing.id, patch);
            else addTask(patch);
            setEditing(null);
          }}
          onDelete={editing.id ? ()=>{deleteTask(editing.id); setEditing(null);} : null}
        />
      )}

      {editMode && (
        <TweaksPanel
          tweaks={tweaks}
          onChange={commitTweak}
          onClose={()=>setEditMode(false)}
        />
      )}

      {unlockFx && <UnlockOverlay name={unlockFx.name} icon={unlockFx.icon}/>}
      {levelUpFx && <LevelUpOverlay level={levelUpFx.level} title={levelUpFx.title}/>}
      {deathFx && <DeathOverlay countdown={deathFx.countdown} demoted={deathFx.canDemote}/>}
      {vacation && <StandbyOverlay startedAt={vacation.startedAt} onEnd={endVacation}/>}
    </>
  );
}

// --------- HUD ---------
function Hud({ hp, ammo, level, score, faceState, faceStyle, overdueCount, dog, setDog, totalEarned, vacation, faceMenu, setFaceMenu, onStartVacation, onEndVacation }){
  const hpLow = hp <= 30;
  const rank = rankFor(level);
  // progress toward next level from lifetime ammo earned
  const levelStart = (level - 1 + (level > 1 ? 0 : 0)) * 1000; // conceptual floor (not accounting demotions)
  const nextAt = 1000 - ((totalEarned || 0) % 1000);
  return (
    <div className="hud">
      <div className="hud-cell face-plate">
        <div className={"face-frame" + (vacation ? " vacation" : "")} onClick={()=>setFaceMenu(v=>!v)} role="button" title="Tactical Options">
          <FaceByStyle style={'pixel'} state={vacation ? 'healthy' : faceState} />
          {vacation && <div className="face-zzz">z z z</div>}
        </div>
        {faceMenu && (
          <FaceMenu
            vacation={vacation}
            onStartVacation={onStartVacation}
            onEndVacation={onEndVacation}
            onClose={()=>setFaceMenu(false)}
          />
        )}
        <div className="face-stats">
          <div>
            <div className="stat-label">HEALTH</div>
            <div className={"stat-num " + (hpLow?'low':'')}>{hp}%</div>
          </div>
          <div>
            <div className="stat-label">STATUS</div>
            <div className="stat-num" style={{fontSize:20,color:'var(--ink-hot)'}}>
              {hp===0 ? 'K.O.' : hp<=20 ? 'CRITICAL' : hp<=40 ? 'BLOODIED' : hp<=60 ? 'STRAINED' : hp<=80 ? 'STEADY' : 'LOCKED IN'}
            </div>
          </div>
        </div>
      </div>

      <div className="hud-center">
        <Stat label="AMMO" value={ammo}/>
        <div className="hud-cell" style={{alignItems:'flex-start'}}>
          <div className="label">LEVEL</div>
          <div className="value">{level}</div>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:'var(--ink-hot)',letterSpacing:1,marginTop:-2}}>{rank}</div>
          <div style={{fontFamily:"'VT323',monospace",fontSize:12,color:'var(--ink-dim)',marginTop:2}}>NEXT: {nextAt} AMMO</div>
        </div>
        <Stat label="SCORE" value={score}/>
        <Stat label="OVERDUE" value={overdueCount} low={overdueCount>0}/>
      </div>

      <div className="hud-cell dog-cell">
        <CyberdogPanel dog={dog} setDog={setDog}/>
      </div>
    </div>
  );
}
// --------- Face Menu (tactical options) ---------
function FaceMenu({ vacation, onStartVacation, onEndVacation, onClose }){
  useEffect(()=>{
    const onDown = (e)=>{
      if (e.target.closest('.face-menu') || e.target.closest('.face-frame')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return ()=>document.removeEventListener('mousedown', onDown);
  },[onClose]);
  const days = vacation ? Math.floor((Date.now() - vacation.startedAt) / 86400000) : 0;
  const hrs = vacation ? Math.floor(((Date.now() - vacation.startedAt) / 3600000) % 24) : 0;
  return (
    <div className="face-menu">
      <div className="face-menu-title">TACTICAL OPTIONS</div>
      {vacation ? (
        <>
          <div className="face-menu-row vac-active">
            <span className="dot" />
            <div>
              <div style={{fontFamily:"'VT323',monospace",fontSize:18,color:'var(--ink-hot)',letterSpacing:1}}>ON VACATION</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:'var(--ink-dim)'}}>
                {days > 0 ? `${days}d ${hrs}h` : `${hrs}h`} elapsed · deadlines frozen
              </div>
            </div>
          </div>
          <button className="face-menu-btn hot" onClick={onEndVacation}>RETURN TO DUTY</button>
        </>
      ) : (
        <>
          <button className="face-menu-btn" onClick={onStartVacation}>
            <span className="fm-icon">⛱</span>
            <span>
              <div className="fm-main">VACATION MODE</div>
              <div className="fm-sub">freeze deadlines · pause Rex · STANDBY</div>
            </span>
          </button>
          <button className="face-menu-btn ghost" disabled>
            <span className="fm-icon">◊</span>
            <span>
              <div className="fm-main">SICK LEAVE</div>
              <div className="fm-sub">[coming soon]</div>
            </span>
          </button>
          <button className="face-menu-btn ghost" disabled>
            <span className="fm-icon">⚑</span>
            <span>
              <div className="fm-main">FOCUS MODE</div>
              <div className="fm-sub">[coming soon]</div>
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function Stat({label, value, suffix, low}){
  return (
    <div className={"hud-cell" + (low ? " stat-pulse" : "")} style={{alignItems:'flex-start'}}>
      <div className="label">{label}</div>
      <div className={"value"+(low?' ':'')} style={low?{color:'var(--danger)',textShadow:'0 0 8px rgba(255,59,47,0.6)'}:{}}>
        {value}{suffix && <span style={{fontSize:14,color:'var(--ink-dim)'}}>{suffix}</span>}
      </div>
    </div>
  );
}
function ArsenalChips(){
  // static flavor chips
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
      {['FOCUS.45','DEADLINE-SHOTGUN','POMO-RIFLE','BFG-9000'].map(w=>(
        <span key={w} className="chip rec">{w}</span>
      ))}
    </div>
  );
}
function ClockBlock({mini}){
  const [t,setT] = useState(new Date());
  useEffect(()=>{
    const id = setInterval(()=>setT(new Date()), 1000);
    return ()=>clearInterval(id);
  },[]);
  const pad = n => String(n).padStart(2,'0');
  return (
    <span style={{fontFamily:'VT323,monospace',fontSize: mini?12:26, color:'var(--ink-hot)'}}>
      {pad(t.getHours())}:{pad(t.getMinutes())}{mini?'':':'+pad(t.getSeconds())}
    </span>
  );
}

// --------- Tabs ---------
function Tab({id, current, onClick, label, count, hot}){
  return (
    <button className={"tab " + (current===id?'active':'') + (hot?' hot':'')} onClick={()=>onClick(id)}>
      {label}{count!=null && <span className="count">[{count}]</span>}
    </button>
  );
}

// --------- Pixel calendar date picker ---------
const DOW = ['S','M','T','W','T','F','S'];
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function sameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function PixelDatePicker({value, onChange}){
  // value is a Date
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const [pos, setPos] = useState({top:0, left:0});
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const triggerRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const compute = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const popW = 260, popH = 360;
      let top = r.bottom + 4;
      let left = r.left;
      if (left + popW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popW - 8);
      if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 4);
      setPos({top, left});
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);
  const pad = (n) => String(n).padStart(2,'0');
  const label = `${MONTHS[value.getMonth()]} ${pad(value.getDate())} ${value.getFullYear()} • ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const prevMonthDays = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i=0;i<startDow;i++){
    cells.push({d: prevMonthDays - startDow + 1 + i, muted: true, date: new Date(y, m-1, prevMonthDays - startDow + 1 + i)});
  }
  for (let i=1;i<=daysInMonth;i++){
    cells.push({d:i, muted:false, date: new Date(y, m, i)});
  }
  while (cells.length % 7 !== 0){
    const i = cells.length - (startDow + daysInMonth) + 1;
    cells.push({d:i, muted:true, date: new Date(y, m+1, i)});
  }
  const today = new Date();
  const pickDay = (date) => {
    const next = new Date(date);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(next);
  };
  const onTime = (e) => {
    const [hh, mm] = e.target.value.split(':').map(n => parseInt(n,10));
    if (isNaN(hh) || isNaN(mm)) return;
    const next = new Date(value);
    next.setHours(hh, mm, 0, 0);
    onChange(next);
  };
  const timeStr = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return (
    <div className="datepick-wrap" ref={wrapRef}>
      <button type="button" ref={triggerRef} className="datepick-trigger" onClick={()=>setOpen(o=>!o)}>
        <span>{label}</span>
        <span className="caret">{open?'▲':'▼'}</span>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={popRef} className="datepick-pop" style={{top:pos.top, left:pos.left}}>
          <div className="datepick-head">
            <button type="button" className="datepick-nav" onClick={()=>setView(new Date(y, m-1, 1))}>‹</button>
            <span>{MONTHS[m]} {y}</span>
            <button type="button" className="datepick-nav" onClick={()=>setView(new Date(y, m+1, 1))}>›</button>
          </div>
          <div className="datepick-grid">
            {DOW.map((d,i)=><div key={i} className="datepick-dow">{d}</div>)}
            {cells.map((c,i)=>{
              const cls = ['datepick-day'];
              if (c.muted) cls.push('muted');
              if (sameDay(c.date, today)) cls.push('today');
              if (sameDay(c.date, value)) cls.push('selected');
              return (
                <button
                  key={i}
                  type="button"
                  className={cls.join(' ')}
                  onClick={()=>pickDay(c.date)}
                >{c.d}</button>
              );
            })}
          </div>
          <div className="datepick-time">
            <span>TIME</span>
            <input type="time" value={timeStr} onChange={onTime} />
          </div>
          <div className="datepick-foot">
            <button type="button" className="btn ghost" onClick={()=>{
              const t = new Date();
              t.setHours(17,0,0,0);
              onChange(t);
              setView(new Date(t.getFullYear(), t.getMonth(), 1));
            }}>TODAY</button>
            <button type="button" className="btn" onClick={()=>setOpen(false)}>OK</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// --------- Add bar ---------
function TaskAddBar({onAdd}){
  const [title,setTitle] = useState('');
  const [dueDay,setDueDay] = useState('today');
  const [customDate,setCustomDate] = useState(() => {
    const d = new Date();
    d.setHours(17,0,0,0);
    return d;
  });
  const [rec,setRec] = useState('none');
  const [isBoss,setIsBoss] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    let dueTs;
    if (dueDay==='custom') {
      if (isNaN(customDate.getTime())) return;
      dueTs = customDate.getTime();
    } else {
      const d = new Date();
      if (dueDay==='tomorrow') d.setDate(d.getDate()+1);
      if (dueDay==='next-week') d.setDate(d.getDate()+7);
      if (dueDay==='today') d.setHours(17,0,0,0);
      else d.setHours(12,0,0,0);
      dueTs = d.getTime();
    }
    onAdd({
      title: title.trim(),
      due: dueTs,
      recurrence: rec,
      boss: isBoss,
      ...(isBoss ? {hpMax:3, hpLeft:3} : {}),
    });
    setTitle('');
  };
  return (
    <form className="add-bar" onSubmit={submit}>
      <input className="input" placeholder="> ENTER NEW TARGET_" value={title} onChange={e=>setTitle(e.target.value)} />
      <select className="input" value={dueDay} onChange={e=>setDueDay(e.target.value)}>
        <option value="today">DUE TODAY 17:00</option>
        <option value="tomorrow">TOMORROW 12:00</option>
        <option value="next-week">NEXT WEEK</option>
        <option value="custom">PICK DATE…</option>
      </select>
      {dueDay==='custom' && (
        <PixelDatePicker value={customDate} onChange={setCustomDate} />
      )}
      <select className="input" value={rec} onChange={e=>setRec(e.target.value)}>
        <option value="none">ONE-TIME</option>
        <option value="daily">RECURRING • DAILY</option>
        <option value="weekdays">RECURRING • WEEKDAYS</option>
        <option value="weekly">RECURRING • WEEKLY</option>
        <option value="monthly">RECURRING • MONTHLY</option>
      </select>
      <div style={{display:'flex',gap:6}}>
        <button type="button" className={"btn "+(isBoss?'boss':'ghost')} onClick={()=>setIsBoss(b=>!b)}>
          {isBoss?'★ BOSS':'+ BOSS'}
        </button>
        <button type="submit" className="btn">+ ADD</button>
      </div>
    </form>
  );
}

// --------- Task row ---------
function TaskRow({ task, onComplete, onEdit, onDelete, onSnooze }){
  const overdue = isOverdue(task);
  const cls = ['task'];
  if (overdue) cls.push('overdue');
  if (task.boss) cls.push('boss');
  if (task.done) cls.push('done');
  return (
    <div className={cls.join(' ')}>
      <div className={"checkbox"+(task.boss?' boss':'')} onClick={(e)=>!task.done && onComplete(task, e)} title={task.boss?'HIT BOSS':'FRAG'}>
        {task.done ? '✕' : task.boss ? '★' : ''}
      </div>
      <div>
        <div className="t-title">{task.title}</div>
        <div className="t-meta">
          {task.boss && <span className="chip boss">BOSS</span>}
          {task.recurrence && task.recurrence!=='none' && <span className="chip rec">⟳ {task.recurrence.toUpperCase()}</span>}
          {overdue && <span className="chip hot">OVERDUE</span>}
        </div>
        {task.boss && !task.done && (
          <>
            <div className="boss-hp"><span style={{width: `${((task.hpLeft||0)/(task.hpMax||1))*100}%`}}/></div>
            <div className="boss-hp-label"><span>BOSS HP</span><span>{task.hpLeft||0}/{task.hpMax||1}</span></div>
          </>
        )}
      </div>
      <div className={"t-due " + (overdue?'hot':'')}>{fmtDue(task.due)}</div>
      <div className="t-actions">
        {!task.done && <button className="iconbtn" title="Snooze +1h" onClick={onSnooze}>Zz</button>}
        <button className="iconbtn" title="Edit" onClick={onEdit}>✎</button>
        <button className="iconbtn" title="Delete" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

// --------- Modal (edit) ---------
function TaskModal({task, onCancel, onSave, onDelete}){
  const [title,setTitle]=useState(task?.title || '');
  const [due,setDue]=useState(toLocalInput(task?.due || isoToday(17,0)));
  const [rec,setRec]=useState(task?.recurrence || 'none');
  const [boss,setBoss]=useState(!!task?.boss);
  const [hpMax,setHpMax]=useState(task?.hpMax || 3);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{task ? 'EDIT TARGET' : 'NEW TARGET'}</h3>
        <div className="fld">
          <label>TITLE</label>
          <input className="input" value={title} onChange={e=>setTitle(e.target.value)} autoFocus/>
        </div>
        <div className="row">
          <div className="fld"><label>DUE</label>
            <input className="input" type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/>
          </div>
          <div className="fld"><label>RECURRENCE</label>
            <select className="input" value={rec} onChange={e=>setRec(e.target.value)}>
              <option value="none">One-time</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="fld"><label>TYPE</label>
            <button type="button" className={"btn "+(boss?'boss':'ghost')} onClick={()=>setBoss(b=>!b)}>
              {boss?'★ BOSS ENEMY':'Normal target'}
            </button>
          </div>
          {boss && (
            <div className="fld"><label>HP (HITS TO KILL)</label>
              <input className="input" type="number" min="1" max="20" value={hpMax} onChange={e=>setHpMax(parseInt(e.target.value)||1)}/>
            </div>
          )}
        </div>
        <div className="actions">
          {onDelete && <button className="btn danger" onClick={onDelete}>DELETE</button>}
          <div style={{flex:1}}/>
          <button className="btn ghost" onClick={onCancel}>CANCEL</button>
          <button className="btn" onClick={()=>{
            if (!title.trim()) return;
            const patch = {
              title:title.trim(),
              due: fromLocalInput(due),
              recurrence: rec,
              boss,
              ...(boss ? {hpMax, hpLeft: task?.hpLeft!=null?Math.min(task.hpLeft,hpMax):hpMax} : {hpMax:undefined, hpLeft:undefined}),
            };
            onSave(patch);
          }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}

// Flag registry — new features append to this list. Defaults are applied when the key is missing.
// Setting a flag to false in the Tweaks UI lets the user disable a feature live without a redeploy.
const FLAG_REGISTRY = [
  // { key: 'notifications', label: 'Notifications', defaultOn: false },
  // Batches 4–7 will populate this as features land.
];
function flagOn(tweaks, key){
  const entry = FLAG_REGISTRY.find(f => f.key === key);
  const defaultOn = entry ? entry.defaultOn : false;
  const v = tweaks && tweaks.flags ? tweaks.flags[key] : undefined;
  return v === undefined ? defaultOn : !!v;
}

// --------- Tweaks panel ---------
function TweaksPanel({ tweaks, onChange, onClose }){
  const toggleFlag = (key) => {
    const next = { ...(tweaks.flags || {}) };
    next[key] = !flagOn(tweaks, key);
    onChange({ flags: next });
  };
  return (
    <div className="tweaks">
      <h4>TWEAKS</h4>
      <div className="tweak-row">
        <span>Scanlines</span>
        <div className={"switch "+(tweaks.scanlines?'on':'')} onClick={()=>onChange({scanlines:!tweaks.scanlines})}>
          <div className="knob"/>
        </div>
      </div>
      <div className="tweak-row">
        <span>SFX (visual)</span>
        <div className={"switch "+(tweaks.sfxOn?'on':'')} onClick={()=>onChange({sfxOn:!tweaks.sfxOn})}>
          <div className="knob"/>
        </div>
      </div>
      <div className="tweak-row" style={{flexDirection:'column',alignItems:'stretch',gap:6,display:'none'}}>
        <span>Face style</span>
        <div className="seg">
          {[['pixel','PIXEL'],['svg','VECTOR']].map(([k,l])=>(
            <button key={k} className={tweaks.faceStyle===k?'on':''} onClick={()=>onChange({faceStyle:k})} style={{flex:1}}>{l}</button>
          ))}
        </div>
      </div>
      {FLAG_REGISTRY.length > 0 && (
        <>
          <h4 style={{marginTop:14}}>FLAGS</h4>
          {FLAG_REGISTRY.map(f => (
            <div className="tweak-row" key={f.key}>
              <span>{f.label}</span>
              <div className={"switch "+(flagOn(tweaks, f.key)?'on':'')} onClick={()=>toggleFlag(f.key)}>
                <div className="knob"/>
              </div>
            </div>
          ))}
        </>
      )}
      <div style={{display:'flex',gap:6,marginTop:10}}>
        <button className="btn ghost" style={{flex:1,fontSize:8}} onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}

// --------- 8-bit bark SFX (Web Audio) ---------
let _audioCtx = null;
function getAudio(){
  if (!_audioCtx){
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ return null; }
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playBark(on, kind){
  if (on === false) return;
  const ctx = getAudio(); if (!ctx) return;
  // kind: 'feed' = low excited woof, 'pet' = happy yip-yip, default = bark
  const pattern = kind === 'pet'
    ? [{f: 480, d: 0.07}, {f: 720, d: 0.08, gap: 0.05}]
    : kind === 'feed'
    ? [{f: 260, d: 0.09}, {f: 380, d: 0.11, gap: 0.04}]
    : [{f: 340, d: 0.10}];
  let t = ctx.currentTime;
  pattern.forEach(step => {
    t += step.gap || 0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // square wave for classic NES/Game Boy chip tone
    osc.type = 'square';
    // pitch envelope: bark has a quick downward glide
    osc.frequency.setValueAtTime(step.f * 1.35, t);
    osc.frequency.exponentialRampToValueAtTime(step.f * 0.75, t + step.d);
    // amplitude envelope: punchy attack, quick decay
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + step.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + step.d + 0.02);
    t += step.d;
  });
}

// --------- Visual "SFX" (on-screen text) ---------
function playSfx(on, kind, x, y){
  if (!on) return;
  const words = {
    frag: ['BLAM!','PEW!','KA-POW!','FRAG!','ZAP!'],
    hit:  ['THWACK!','WHUMP!','CRUNCH!'],
    boss: ['BOOOM!','MEGA-FRAG!','VICTORY!','CRUSHED!'],
  }[kind] || ['POW!'];
  const txt = words[Math.floor(Math.random()*words.length)];
  const el = document.createElement('div');
  el.className='sfx-bubble'; el.textContent = txt;
  el.style.left = (x + (Math.random()*60-30))+'px';
  el.style.top = (y - 30 + (Math.random()*20-10))+'px';
  document.body.appendChild(el);
  const start = performance.now();
  const dur = 800;
  const rot = (Math.random()*30-15);
  function step(t){
    const p = (t-start)/dur;
    if (p>=1){ el.remove(); return; }
    el.style.transform = `translate(-50%,-50%) translateY(${-40*p}px) rotate(${rot}deg) scale(${0.8 + p*0.6})`;
    el.style.opacity = 1-p;
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

// Expose for other script files (e.g. cyberdog.jsx) to trigger
window.playBark = playBark;

// --------- Weapon Icon (pixel SVG) ---------
function WeaponIcon({ kind, size=56 }){
  const P = 'var(--ink-hot)';
  const D = 'var(--ink-dim)';
  const S = '#000';
  const common = { width:size, height:size, viewBox:'0 0 32 32', shapeRendering:'crispEdges', style:{imageRendering:'pixelated'} };
  switch (kind){
    case 'knife': return (
      <svg {...common}>
        <rect x="14" y="3" width="4" height="18" fill={P}/>
        <rect x="15" y="3" width="2" height="18" fill="#fff"/>
        <rect x="12" y="20" width="8" height="3" fill={D}/>
        <rect x="13" y="23" width="6" height="6" fill="#662f10"/>
        <rect x="14" y="24" width="4" height="4" fill="#8a4418"/>
      </svg>
    );
    case 'pistol': return (
      <svg {...common}>
        <rect x="6" y="12" width="18" height="6" fill={P}/>
        <rect x="22" y="10" width="4" height="2" fill={P}/>
        <rect x="10" y="18" width="6" height="8" fill={D}/>
        <rect x="11" y="19" width="4" height="6" fill="#111"/>
        <rect x="6" y="14" width="18" height="1" fill="#fff" opacity="0.5"/>
      </svg>
    );
    case 'shotgun': return (
      <svg {...common}>
        <rect x="2" y="10" width="22" height="5" fill={P}/>
        <rect x="2" y="10" width="22" height="1" fill="#fff" opacity="0.4"/>
        <rect x="24" y="12" width="4" height="3" fill={D}/>
        <rect x="14" y="15" width="4" height="6" fill={D}/>
        <rect x="18" y="15" width="8" height="10" fill="#662f10"/>
        <rect x="19" y="16" width="6" height="8" fill="#8a4418"/>
      </svg>
    );
    case 'smg': return (
      <svg {...common}>
        <rect x="4" y="10" width="22" height="5" fill={P}/>
        <rect x="26" y="11" width="2" height="3" fill={P}/>
        <rect x="10" y="15" width="5" height="10" fill={D}/>
        <rect x="11" y="16" width="3" height="8" fill="#111"/>
        <rect x="14" y="15" width="5" height="4" fill={D}/>
        <rect x="4" y="10" width="22" height="1" fill="#fff" opacity="0.5"/>
      </svg>
    );
    case 'rocket': return (
      <svg {...common}>
        <rect x="2" y="12" width="24" height="6" fill={P}/>
        <rect x="26" y="13" width="2" height="4" fill={D}/>
        <rect x="12" y="18" width="4" height="7" fill={D}/>
        <rect x="16" y="8" width="4" height="4" fill="#ff7a1a"/>
        <rect x="17" y="6" width="2" height="2" fill="#ffbf7a"/>
        <rect x="2" y="12" width="24" height="1" fill="#fff" opacity="0.4"/>
      </svg>
    );
    case 'bfg': return (
      <svg {...common}>
        <rect x="3" y="10" width="24" height="10" fill={D}/>
        <rect x="3" y="10" width="24" height="2" fill={P}/>
        <rect x="27" y="13" width="2" height="4" fill={P}/>
        <rect x="8" y="13" width="14" height="4" fill="#0cff0c"/>
        <rect x="10" y="14" width="10" height="2" fill="#aaff6a"/>
        <rect x="13" y="20" width="6" height="6" fill={D}/>
        <rect x="14" y="21" width="4" height="4" fill="#111"/>
      </svg>
    );
    default: return (
      <svg {...common}>
        <rect x="6" y="12" width="20" height="8" fill={P}/>
        <rect x="6" y="12" width="20" height="2" fill="#fff" opacity="0.3"/>
      </svg>
    );
  }
}

// --------- Arsenal (rewards) ---------
function Arsenal({ rewards, setRewards, ammo, onRedeem }){
  const [editing, setEditing] = useState(null); // reward obj or {} for new
  const update = (id, patch) => setRewards(rs => rs.map(r => r.id===id ? {...r, ...patch} : r));
  const remove = (id) => setRewards(rs => rs.filter(r => r.id !== id));
  const save = (patch) => {
    if (editing.id){
      update(editing.id, patch);
    } else {
      setRewards(rs => [...rs, { id: 'r'+Date.now(), icon:'pistol', ...patch }]);
    }
    setEditing(null);
  };
  return (
    <div className="arsenal">
      <div className="arsenal-banner">
        <span className="arsenal-title">// ARSENAL.EXE — UNLOCK REWARDS WITH AMMO //</span>
        <button className="btn small" onClick={()=>setEditing({})}>+ NEW</button>
      </div>
      <div className="weapon-grid">
        {rewards.map(r => {
          const locked = ammo < r.cost;
          return (
            <div key={r.id} className={'weapon-card ' + (locked?'locked':'ready')}>
              <div className="weapon-icon-frame">
                <WeaponIcon kind={r.icon} size={64}/>
                {locked && <div className="weapon-lock">🔒</div>}
              </div>
              <div className="weapon-info">
                <div className="weapon-name">{r.name}</div>
                <div className="weapon-desc">{r.desc || '\u00a0'}</div>
                <div className="weapon-cost">
                  <span className="ammo-pip">▣</span> {r.cost} AMMO
                </div>
              </div>
              <div className="weapon-actions">
                <button
                  className={'btn ' + (locked?'ghost':'')}
                  style={{flex:1, fontSize:8}}
                  disabled={locked}
                  onClick={()=>onRedeem(r)}
                >{locked ? 'LOCKED' : 'REDEEM'}</button>
                <button className="btn ghost tiny" onClick={()=>setEditing(r)} title="Edit">✎</button>
                <button className="btn ghost tiny" onClick={()=>{ if(confirm('Delete "'+r.name+'"?')) remove(r.id); }} title="Delete">✕</button>
              </div>
            </div>
          );
        })}
        {rewards.length === 0 && (
          <div className="empty" style={{gridColumn:'1/-1'}}>
            <span className="big">ARSENAL EMPTY</span>
            Add your first reward — hit + NEW above.
          </div>
        )}
      </div>

      {editing && <RewardModal reward={editing.id ? editing : null} onCancel={()=>setEditing(null)} onSave={save}/>}
    </div>
  );
}

function RewardModal({ reward, onSave, onCancel }){
  const [name,setName] = useState(reward?.name || '');
  const [cost,setCost] = useState(reward?.cost ?? 25);
  const [icon,setIcon] = useState(reward?.icon || 'pistol');
  const [desc,setDesc] = useState(reward?.desc || '');
  const save = (e) => {
    e?.preventDefault?.();
    if (!name.trim()) return;
    onSave({ name:name.trim(), cost:Math.max(1, parseInt(cost,10)||1), icon, desc:desc.trim() });
  };
  const icons = [
    ['knife','KNIFE'],['pistol','PISTOL'],['shotgun','SHOTGUN'],
    ['smg','SMG'],['rocket','ROCKET'],['bfg','BFG-9000'],
  ];
  return (
    <div className="modal-bg" onClick={onCancel}>
      <form className="modal" onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h3>{reward ? 'EDIT REWARD' : 'NEW REWARD'}</h3>
        <div className="fld">
          <label>NAME</label>
          <input className="inp" autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Day Off"/>
        </div>
        <div className="row">
          <div className="fld">
            <label>COST (AMMO)</label>
            <input className="inp" type="number" min="1" value={cost} onChange={e=>setCost(e.target.value)}/>
          </div>
          <div className="fld">
            <label>WEAPON</label>
            <select className="inp" value={icon} onChange={e=>setIcon(e.target.value)}>
              {icons.map(([k,l])=> <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="fld">
          <label>DESCRIPTION (OPTIONAL)</label>
          <input className="inp" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Flavor text…"/>
        </div>
        <div className="fld">
          <label>PREVIEW</label>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px',border:'1px solid var(--ink-deep)',background:'#040c04'}}>
            <WeaponIcon kind={icon} size={56}/>
            <div style={{fontFamily:"'VT323',monospace",fontSize:18,color:'var(--ink-hot)'}}>{name||'UNNAMED'} <span style={{color:'var(--ink-dim)'}}>— {cost} AMMO</span></div>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onCancel}>CANCEL</button>
          <button type="submit" className="btn">SAVE</button>
        </div>
      </form>
    </div>
  );
}

// --------- Unlock Overlay (triggers on redeem) ---------
function UnlockOverlay({ name, icon }){
  return (
    <div className="unlock-overlay">
      <div className="unlock-box">
        <div className="unlock-label">// WEAPON UNLOCKED //</div>
        <div className="unlock-icon"><WeaponIcon kind={icon} size={140}/></div>
        <div className="unlock-name">{name}</div>
        <div className="unlock-sub">REDEEM IN MEATSPACE, MARINE</div>
      </div>
    </div>
  );
}

// --------- Level Up Overlay ---------
function LevelUpOverlay({ level, title }){
  return (
    <div className="unlock-overlay levelup-overlay">
      <div className="unlock-box levelup-box">
        <div className="unlock-label" style={{color:'#aaff6a'}}>// PROMOTION //</div>
        <div className="levelup-star">★</div>
        <div className="unlock-name" style={{fontSize:22}}>LVL {level}</div>
        <div className="levelup-title">{title}</div>
        <div className="unlock-sub">RANK EARNED · STAY FROSTY</div>
      </div>
    </div>
  );
}

// --------- Death Overlay ---------
function DeathOverlay({ countdown, demoted }){
  return (
    <div className="death-overlay">
      <div className="death-box">
        <div className="death-label">// VITALS FLATLINED //</div>
        <div className="death-headline">YOU DIED</div>
        {demoted
          ? <div className="death-sub">RANK DEMOTED · STAND BACK UP, MARINE</div>
          : <div className="death-sub">YOU HELD AT RECRUIT · NOWHERE TO FALL</div>}
        <div className="death-counter">RESPAWN IN {countdown}</div>
        <div className="death-hint">Clear overdue tasks to rebuild HP.</div>
      </div>
    </div>
  );
}

// --------- Standby (Vacation) Overlay ---------
function StandbyOverlay({ startedAt, onEnd }){
  const [, setNow] = useState(Date.now());
  useEffect(()=>{
    const id = setInterval(()=>setNow(Date.now()), 1000);
    return ()=>clearInterval(id);
  },[]);
  const elapsed = Date.now() - startedAt;
  const days = Math.floor(elapsed / 86400000);
  const hrs = Math.floor((elapsed / 3600000) % 24);
  const mins = Math.floor((elapsed / 60000) % 60);
  const secs = Math.floor((elapsed / 1000) % 60);
  const pad = n => String(n).padStart(2,'0');
  const dur = days > 0 ? `${days}d ${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  return (
    <div className="standby-overlay" onClick={onEnd}>
      <div className="standby-scanline"/>
      <div className="standby-box">
        <div className="standby-dot"><span/></div>
        <div className="standby-label">// SIGNAL STANDBY //</div>
        <div className="standby-headline">VACATION MODE</div>
        <div className="standby-sub">deadlines frozen · Rex napping · HP locked</div>
        <div className="standby-timer">{dur}</div>
        <div className="standby-hint">[ click anywhere to return to duty ]</div>
      </div>
    </div>
  );
}