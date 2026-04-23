/* PNG marine portraits — loaded from /faces/*.png */

function PixelFace({ state = 'healthy' }) {
  const src = `faces/${state}.png?v=2`;
  return (
    <img
      src={src}
      alt={`marine ${state}`}
      className="pix-face-img"
      style={{
        width: '146px',
        height: '146px',
        objectFit: 'cover',
        imageRendering: 'pixelated',
        display: 'block',
      }}
    />
  );
}

// SVG fallback (vector) — blocky marine
function SvgFace({ state='healthy' }){
  const hp = {healthy:100,focused:85,strained:65,wounded:45,bloodied:25,critical:10,dead:0}[state] ?? 100;
  const skin = hp<=0 ? '#8a6a58' : '#e29566';
  const skinLight = hp<=0 ? '#a08878' : '#f4c29a';
  const hasBlood = ['bloodied','critical','dead','wounded'].includes(state);
  const hasBruise = ['bloodied','critical','dead'].includes(state);
  const mouth = {
    healthy:  <path d="M38 84 Q60 96 82 84" stroke="#1a0a06" strokeWidth="5" fill="#1a0a06" strokeLinecap="round"/>,
    focused:  <rect x="40" y="82" width="40" height="4" fill="#1a0a06"/>,
    strained: <path d="M40 88 Q60 82 80 88" stroke="#1a0a06" strokeWidth="4" fill="none"/>,
    wounded:  <path d="M38 88 Q60 78 82 88 Q60 94 38 88 Z" fill="#d41616" stroke="#1a0a06" strokeWidth="2"/>,
    bloodied: <g><path d="M36 86 Q60 74 84 86 Q60 96 36 86 Z" fill="#d41616" stroke="#1a0a06" strokeWidth="2"/><rect x="48" y="86" width="24" height="8" fill="#6a0808"/></g>,
    critical: <path d="M34 88 Q60 68 86 88 L78 82 L68 86 L60 78 L52 86 L42 82 Z" fill="#d41616" stroke="#1a0a06" strokeWidth="2"/>,
    dead:     <rect x="38" y="86" width="44" height="5" fill="#1a0a06"/>,
  }[state];
  const eyes = state==='dead'
    ? (<g stroke="#0a0a0a" strokeWidth="5" strokeLinecap="round">
         <line x1="34" y1="54" x2="48" y2="66"/><line x1="48" y1="54" x2="34" y2="66"/>
         <line x1="72" y1="54" x2="86" y2="66"/><line x1="86" y1="54" x2="72" y2="66"/>
       </g>)
    : (<g>
         <rect x="32" y="54" width="18" height="10" fill="#f6f2e4" stroke="#0a0a0a" strokeWidth="1.5"/>
         <rect x="70" y="54" width="18" height="10" fill="#f6f2e4" stroke="#0a0a0a" strokeWidth="1.5"/>
         <rect x="38" y="55" width="6" height="8" fill="#2a5fb5"/>
         <rect x="76" y="55" width="6" height="8" fill="#2a5fb5"/>
       </g>);
  return (
    <svg className="svg-face" viewBox="0 0 120 120" shapeRendering="crispEdges">
      <rect x="8" y="96" width="104" height="20" fill="#152a15" stroke="#0a0a0a" strokeWidth="2"/>
      <rect x="14" y="100" width="92" height="4" fill="#5a8a5a"/>
      <rect x="20" y="36" width="80" height="62" fill={skin} stroke="#0a0a0a" strokeWidth="2"/>
      <rect x="26" y="44" width="68" height="10" fill={skinLight}/>
      <rect x="18" y="18" width="84" height="20" fill="#a04510" stroke="#0a0a0a" strokeWidth="2"/>
      <rect x="24" y="22" width="72" height="4" fill="#e68a2e"/>
      <rect x="30" y="48" width="22" height="4" fill="#4a1806"/>
      <rect x="68" y="48" width="22" height="4" fill="#4a1806"/>
      <rect x="56" y="62" width="8" height="14" fill="#b26a42"/>
      {eyes}
      {hasBlood && <rect x="24" y="40" width="10" height="22" fill="#d41616" opacity=".85"/>}
      {hasBruise && <rect x="28" y="52" width="6" height="6" fill="#4a1e5a" opacity=".8"/>}
      {mouth}
    </svg>
  );
}

function FaceByStyle({ style, state }){
  if (style === 'svg') return <SvgFace state={state} />;
  return <PixelFace state={state} scale={4} />;
}

function healthToFaceState(hp){
  if (hp <= 0) return 'dead';
  if (hp <= 10) return 'rage';
  if (hp <= 25) return 'critical';
  if (hp <= 40) return 'bloodied';
  if (hp <= 55) return 'wounded';
  if (hp <= 70) return 'strained';
  if (hp <= 85) return 'focused';
  return 'healthy';
}

Object.assign(window, { PixelFace, SvgFace, FaceByStyle, healthToFaceState });
