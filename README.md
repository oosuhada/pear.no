# "Claude Code Can't Do This."
### Yeah, about that.

[pear.no](https://pear.no/) went viral as *"the coolest website on the internet."* Riding along with every repost was the same confident verdict: **"Claude Code can't do this."**

<p align="center">
  <img src="docs/media/claude-code-cant-do-this.jpg" width="504" alt="Viral social post making the false claim that Claude Code cannot create the Pear website experience">
</p>

Except Pear had already posted their own build notes: GPT Image 2 for stills, Seedance 2 for motion, and Fable 5 running inside Claude Code — with the specific detail that no Figma file was ever opened. Nobody checked before hitting repost.

<br/>

## Receipts, Not Arguments

<p align="center">
  <img src="docs/media/pear-scroll-demo.webp" width="960" alt="Full-page scroll recording of the live Pear reconstruction">
</p>

<br/>
<p align="center"><a href="https://oosuhada.github.io/pear.no/"><strong>Live Reconstruction</strong></a></p>
<br/>
| The claim | This repo |
|---|---|
| "Claude Code can't do this" | You're scrolling through it right now |
| "No Figma file exists" | Still doesn't |
| Cinematic, scroll-driven WebGL | Preserved — plus a rebuilt loading / frame-delivery pipeline for a smoother scroll |
<br/>
## From prompt to production

<p align="center">
  <img src="docs/media/pear-ai-process.jpg" width="960" alt="Pear visual showing a GPT Image 2 prompt beside the generated neoclassical artwork">
</p>

Same shape as Pear's own pipeline: an image model paints the stills, a video model sets them in motion, and Claude Code assembles and ships the site — no handoff to a design tool in the middle.

## Why bother

Arguing with a screenshot is a losing move — a repost doesn't carry a burden of proof. Rebuilding the thing does. So here it is, loading in a browser, no design file required.

---

*This is an independent technical study and is not affiliated with Pear AS. The original concept, art direction, branding, copy, and media belong to their respective creators and owners.*
