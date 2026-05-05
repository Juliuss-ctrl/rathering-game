function initStarfield() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, stars = [];
  function resize() { W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; }
  function init() {
    resize();
    stars = Array.from({length:80},()=>({ x:Math.random()*W, y:Math.random()*H, r:Math.random()*0.8+0.2, phase:Math.random()*Math.PI*2 }));
  }
  let t=0;
  function draw() {
    ctx.clearRect(0,0,W,H);
    t+=0.008;
    stars.forEach(s=>{
      const f=0.3+0.7*Math.sin(t*0.5+s.phase);
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,255,255,${f*0.4})`; ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize',resize);
  init(); draw();
}

function showToast(msg,duration=2400) {
  let el=document.getElementById('toast');
  if (!el){el=document.createElement('div');el.id='toast';document.body.appendChild(el);}
  el.textContent=msg; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),duration);
}

const Session = {
  set:(k,v)=>sessionStorage.setItem(k,JSON.stringify(v)),
  get:(k)=>{try{return JSON.parse(sessionStorage.getItem(k));}catch{return null;}},
  clear:()=>sessionStorage.clear(),
};

const AudioCtx=window.AudioContext||window.webkitAudioContext;
let _actx=null;
function getAudioCtx(){if(!_actx)_actx=new AudioCtx();return _actx;}
function playTone(hz,ms,vol=0.12){
  try{const ctx=getAudioCtx(),osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=hz;osc.type='sine';
  gain.gain.setValueAtTime(vol,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+ms/1000);
  osc.start(ctx.currentTime);osc.stop(ctx.currentTime+ms/1000);}catch{}
}
function soundClick(){playTone(800,40,0.08);}
function soundVote(){playTone(600,80,0.12);setTimeout(()=>playTone(900,60,0.08),80);}
function soundStart(){playTone(500,80,0.10);setTimeout(()=>playTone(630,80,0.10),90);setTimeout(()=>playTone(750,120,0.12),180);}
function soundResult(){playTone(750,100,0.12);setTimeout(()=>playTone(940,100,0.12),110);setTimeout(()=>playTone(1120,180,0.14),220);}
