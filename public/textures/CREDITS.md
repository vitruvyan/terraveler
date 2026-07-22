# Texture & rendering credits

## Textures (this directory)

2K planet/Sun textures and the Saturn ring alpha map, downloaded from
Solar System Scope (`https://www.solarsystemscope.com/textures/`):

- `2k_sun.jpg`
- `2k_mercury.jpg`
- `2k_venus_surface.jpg`
- `2k_earth_daymap.jpg`
- `2k_mars.jpg`
- `2k_jupiter.jpg`
- `2k_saturn.jpg`
- `2k_saturn_ring_alpha.png`
- `2k_uranus.jpg`
- `2k_neptune.jpg`

License: **CC BY 4.0** — Solar System Scope (`www.solarsystemscope.com`),
attribution required: "2k textures by Solar System Scope
(www.solarsystemscope.com), CC BY 4.0."

## Rendering approach

The three.js scene in `components/SolarSystem3D.tsx` (bloom-lit Sun via
EffectComposer + UnrealBloomPass, hover OutlinePass, Phong-shaded planets,
alpha-mapped Saturn ring, cinematic orbiting-follow camera) is adapted from
**N3rson/Solar-System-3D** (MIT license), re-typed into this React/TypeScript
codebase and rebuilt around this app's own time/motion data (`t`, the probe's
AU-plane position from `lib/voyage-motion.ts`, and the planet ephemeris in
`lib/planet-ephemeris.ts`) rather than the original project's static demo
scene.

## Imagery elsewhere in this app

The flyby photographs shown in the Mission Log / Imagery lens
(`data/voyager2.json`) are NASA/JPL public domain (U.S. government work), not
part of this texture set — see each waypoint's `media[].credit` /
`source_url` for its individual citation.
