import { defineConfig } from "vite";

const runtimeBundle = "/assets/index-BhJdAf8K.js";

function pearPerfPreview() {
  return {
    name: "pear-perf-preview",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith(runtimeBundle)) return null;

      const replacements = [
        [
          "var Ep=8,ts=[],ns=0,Xc=[];",
          "var Ep=4,ts=[],ns=0,Xc=[];",
          "limit image work to four concurrent jobs",
        ],
        [
          "let S=[],m=0;for(let C of h)S=S.concat(Pp(C.count,m)),m+=C.count;let E=Fp",
          "let S=[];let E=Fp",
          "keep reel fetching inside the current sliding window instead of exhausting all 483 frames",
        ],
        [
          "land:(C,z)=>{let B=()=>{s.frames[C]=z,s.loaded++};z.decode?z.decode().then(B,B):B()},want:()=>y});E.hot=()=>P&&performance.now()-P<500,Np(.10010000000000001,f,E)",
          "land:(C,z)=>{s.frames[C]=z,s.loaded++},want:()=>y});E.hot=()=>P&&performance.now()-P<500,Np(.1,f,E)",
          "load reel bytes immediately but only decode the sliding warm window",
        ],
        [
          "s.aim=S=>{P=performance.now(),S!==y&&(y=S,Ap(s.frames,S,s.N))}",
          "s.aim=S=>{P=performance.now(),S!==y&&(y=S,Ap(s.frames,S,s.N),Tp())}",
          "wake the reel loader when the requested frame window moves",
        ],
        [
          "de=ho(\"./films/plan\",121,2,He+ct+At,He+ct+At+Jn)",
          "de=ho(\"./films/plan\",121,2,.3,He+ct+At+Jn)",
          "start plan downloads around 20% road progress",
        ],
        [
          "let Q=-1,he=null,ue=null,Se=null,rt=0,ze=innerWidth<=720?1.5:2",
          "let Q=-1,he=null,ue=null,Se=null,pearHeroTime=-1,pearDprHoldUntil=0,rt=0,ze=innerWidth<=720?1.5:2",
          "add hero upload and moving-DPR state",
        ],
        [
          "let Et=Math.min(devicePixelRatio||1,qt),Re=1",
          "let pearHeavyZone=(yt.raw??0)<.12||(yt.raw??0)>.34&&(yt.raw??0)<.56;pearHeavyZone&&Math.abs(Z.velocity)>.15&&(pearDprHoldUntil=ce+600);let Et=Math.min(devicePixelRatio||1,qt,pearHeavyZone&&ce<pearDprHoldUntil?1.5:2),Re=1",
          "cap DPR at 1.5 while heavy sections are moving",
        ],
        [
          "s.readyState>=2&&(En<.999?(oe(0,Y.A,s),D.uniform2f($.uResA,s.videoWidth,s.videoHeight),s.paused&&W(),E>.99&&B()):s.paused||s.pause())",
          "s.readyState>=2&&(En<.999?(s.currentTime!==pearHeroTime&&(pearHeroTime=s.currentTime,oe(0,Y.A,s),D.uniform2f($.uResA,s.videoWidth,s.videoHeight)),s.paused&&W(),E>.99&&B()):s.paused||s.pause())",
          "avoid re-uploading an unchanged hero video frame",
        ],
        [
          "(S||innerWidth>720||f-lm>33)",
          "(S||f-lm>33)",
          "throttle the No Fees SVG filter updates to about 30fps",
        ],
        [
          'baseFrequency:"0.011 0.017",numOctaves:"4",seed:"9"',
          'baseFrequency:"0.011 0.017",numOctaves:"2",seed:"9"',
          "halve the No Fees turbulence octaves",
        ],
      ];

      let next = code;
      for (const [from, to, label] of replacements) {
        if (!next.includes(from)) {
          throw new Error(`Pear preview patch not found: ${label}`);
        }
        next = next.replace(from, to);
      }

      return {
        code: `window.__pearPreviewPatched=true;${next}`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? "/pear.no/" : "/",
  plugins: [pearPerfPreview()],
});
