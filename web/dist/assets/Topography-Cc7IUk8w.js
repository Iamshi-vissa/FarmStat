import{r as ee,j as St}from"./react-C83MwftR.js";const io=.32,Ct=9,me=.05,Oe=160,Fe=1.7,Te=.45,no=2.8,ke=4,Lt=4,Re=256,ze=48,et=2e5,uo=[-.81,.58,-.02],At={forward:[0,1],backward:[0,-1],left:[-1,0],right:[1,0]},ao=["lift","trace","light"],lo={plus:0,dots:1},co=1.25,Ue=`
precision highp float;
precision highp int;

uniform float uFrequency;
uniform vec2 uMorph;
uniform sampler2D uSculpt;
uniform float uSculptOn;
uniform vec4 uPulses[${ke}];
uniform vec3 uEye;
uniform vec3 uForward;
uniform vec3 uNear;

uint lattice(ivec2 p) {
  uvec2 q = uvec2(p + 1073741824);
  uint h = q.x * 2654435761u + q.y * 2246822519u;
  h = (h ^ (h >> 15u)) * 739982445u;
  h = (h ^ (h >> 12u)) * 695872825u;
  return h ^ (h >> 15u);
}

float corner(ivec2 c, vec2 f) {
  uint h = lattice(c);
  vec2 g = vec2(float(h & 65535u), float(h >> 16u)) / 32767.5 - 1.0;
  return dot(g, f);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 c = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = corner(c, f);
  float b = corner(c + ivec2(1, 0), f - vec2(1.0, 0.0));
  float d = corner(c + ivec2(0, 1), f - vec2(0.0, 1.0));
  float e = corner(c + ivec2(1, 1), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

vec2 octave(vec2 p, vec2 shift) {
  return vec2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y) + shift;
}

float relief(vec2 t) {
  vec2 p = t * uFrequency;
  vec2 w = vec2(noise(p * 0.42 + uMorph), noise(p * 0.42 - uMorph.yx + vec2(5.2, 1.3)));
  p += w * 0.8;
  float n = noise(p) * 0.55;
  p = octave(p, vec2(7.1, 3.7));
  n += noise(p) * 0.15;
  p = octave(p, vec2(1.9, 8.3));
  n += noise(p) * 0.04;
  float s = log(1.0 + exp(7.0 * (3.0 * n + 0.05))) / 7.0;
  return s * s * 1.4 + 0.1 * n;
}

float swell(vec2 t) {
  float lift = 0.0;
  for (int i = 0; i < ${ke}; i++) {
    vec4 p = uPulses[i];
    if (p.w <= 0.0) continue;
    float x = (length(t - p.xy) - p.z) / (0.28 + p.z * 0.05);
    lift += exp(-x * x) * p.w;
  }
  return lift;
}

vec4 sculpted(vec2 t) {
  return uSculptOn > 0.5 ? textureLod(uSculpt, t / ${ze}.0, 0.0) : vec4(0.0);
}

float settle(vec2 world) {
  float depth = dot(vec3(world.x, 0.0, world.y) - uEye, uForward);
  float x = clamp((depth - uNear.x) / max(uNear.y - uNear.x, 1e-3), 0.0, 1.0);
  return mix(uNear.z, 1.0, x * x * x * (x * (x * 6.0 - 15.0) + 10.0));
}
`,fo=`#version 300 es
${Ue}
uniform ivec2 uBase;
uniform float uCell;
uniform float uDetail;
layout(location = 0) out vec4 outField;
layout(location = 1) out vec4 outHeight;

void main() {
  vec2 t = vec2(uBase + ivec2(gl_FragCoord.xy)) * uCell;
  vec4 carved = sculpted(t);
  float ring = swell(t);
  float ground = relief(t) + carved.r + ring * 0.14;
  vec2 dp = t * uFrequency * 5.0 + vec2(13.1, 4.7);
  float fine = noise(dp) * 0.6 + noise(octave(dp, vec2(2.3, 6.1))) * 0.3;
  outField = vec4(carved.g, ring, ground, carved.r);
  outHeight = vec4(ground + uDetail * 0.1 * fine, 0.0, 0.0, 1.0);
}`,so=n=>`#version 300 es
#define BAKED ${n?1:0}
${Ue}
uniform sampler2D uField;
uniform ivec2 uOrigin;
uniform ivec2 uCamCell;
uniform vec2 uCamFrac;
uniform float uCell;
uniform int uStride;
uniform float uHeight;
uniform mat4 uViewProj;
out vec2 vTexel;
out vec2 vTerrain;
out float vDepth;
out float vLift;
out vec3 vNormal;

float ground(vec2 t) {
  return relief(t) + swell(t) * 0.14;
}

void main() {
  ivec2 step = ivec2(gl_VertexID >> 1, gl_InstanceID + (gl_VertexID & 1)) * uStride;
  ivec2 local = uOrigin + step;
  vec2 terrain = vec2(local + uCamCell) * uCell;
  vec2 world = vec2(local) * uCell - uCamFrac;
  float k = settle(world);
#if BAKED
  ivec2 texel = step + 2;
  vec4 c = texelFetch(uField, texel, 0);
  vec4 l = texelFetch(uField, texel - ivec2(1, 0), 0);
  vec4 r = texelFetch(uField, texel + ivec2(1, 0), 0);
  vec4 d = texelFetch(uField, texel - ivec2(0, 1), 0);
  vec4 u = texelFetch(uField, texel + ivec2(0, 1), 0);
  float h = (c.b - c.a) * k + c.a;
  float dx = (l.b - l.a - r.b + r.a) * k + l.a - r.a;
  float dz = (d.b - d.a - u.b + u.a) * k + d.a - u.a;
  vNormal = vec3(dx * uHeight / (2.0 * uCell), 1.0, dz * uHeight / (2.0 * uCell));
  vTexel = vec2(texel) + 0.5;
#else
  float h = ground(terrain) * k;
  float hx = ground(terrain + vec2(0.04, 0.0)) * k;
  float hz = ground(terrain + vec2(0.0, 0.04)) * k;
  vNormal = vec3((h - hx) * uHeight / 0.04, 1.0, (h - hz) * uHeight / 0.04);
  vTexel = vec2(0.0);
#endif
  vec4 clip = uViewProj * vec4(world.x, h * uHeight, world.y, 1.0);
  gl_Position = clip;
  vTerrain = terrain;
  vDepth = clip.w;
  vLift = h * uHeight;
}`,mo=n=>`#version 300 es
#define BAKED ${n?1:0}
${Ue}
uniform sampler2D uField;
uniform highp sampler2D uHeightField;
uniform float uDetail;
uniform float uLines;
uniform float uLineWidth;
uniform float uMajor;
uniform vec3 uColor;
uniform float uBrightness;
uniform vec2 uFade;
uniform vec3 uFocus;
uniform vec4 uHeat;
uniform vec4 uLamp;
uniform vec4 uTrace;
uniform vec3 uSun;
uniform float uRefDepth;
uniform float uReveal;
uniform float uLightMode;
uniform float uOpacity;
uniform vec4 uGlitch[3];
uniform float uGlitchSeed;
uniform float uPixel;
in vec2 vTexel;
in vec2 vTerrain;
in float vDepth;
in float vLift;
in vec3 vNormal;
out vec4 outColor;

float smoother(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

float stroke(float dist, float width, float soft, float density, float crowd) {
  float cover = max(0.0, min(min(width, soft), 0.5 * (width + soft) - dist)) / soft;
  return mix(cover, min(width * density, 1.0) * 0.6, crowd);
}

float sampleHeight(vec2 coord, out vec2 slope) {
  vec2 u = coord - 0.5;
  vec2 i = floor(u + 0.5);
  vec2 f = u - i;
  vec3 wx = vec3(0.5 * (0.5 - f.x) * (0.5 - f.x), 0.75 - f.x * f.x, 0.5 * (0.5 + f.x) * (0.5 + f.x));
  vec3 wy = vec3(0.5 * (0.5 - f.y) * (0.5 - f.y), 0.75 - f.y * f.y, 0.5 * (0.5 + f.y) * (0.5 + f.y));
  vec3 dx = vec3(f.x - 0.5, -2.0 * f.x, 0.5 + f.x);
  vec3 dy = vec3(f.y - 0.5, -2.0 * f.y, 0.5 + f.y);
  ivec2 base = ivec2(i) - 1;
  float total = 0.0;
  slope = vec2(0.0);
  for (int y = 0; y < 3; y++) {
    float a = texelFetch(uHeightField, base + ivec2(0, y), 0).r;
    float b = texelFetch(uHeightField, base + ivec2(1, y), 0).r;
    float c = texelFetch(uHeightField, base + ivec2(2, y), 0).r;
    float row = a * wx.x + b * wx.y + c * wx.z;
    total += row * wy[y];
    slope += vec2((a * dx.x + b * dx.y + c * dx.z) * wy[y], row * dy[y]);
  }
  return total;
}

void main() {
  float py = gl_FragCoord.y / uPixel;
  float shift = 0.0;
  float split = 0.0;
  for (int i = 0; i < 3; i++) {
    if (py >= uGlitch[i].x && py < uGlitch[i].y) {
      shift = uGlitch[i].z * uPixel;
      split = uGlitch[i].w * uPixel;
    }
  }
  vec2 spot = vTerrain - dFdx(vTerrain) * shift;
#if BAKED
  vec2 ex = dFdx(vTexel);
  vec2 ey = dFdy(vTexel);
  vec2 coord = vTexel - ex * shift;
  vec2 slope;
  float h = sampleHeight(coord, slope);
  vec4 field = texture(uField, coord / vec2(textureSize(uField, 0)));
  float trail = field.r;
  float ring = field.g;
  float gx = dot(slope, ex) * uLines;
  float gy = dot(slope, ey) * uLines;
#else
  vec2 dp = spot * uFrequency * 5.0 + vec2(13.1, 4.7);
  float ring = swell(spot);
  float h = relief(spot) + ring * 0.14 + uDetail * 0.1 * (noise(dp) * 0.6 + noise(octave(dp, vec2(2.3, 6.1))) * 0.3);
  float trail = 0.0;
  float gx = dFdx(h) * uLines;
  float gy = dFdy(h) * uLines;
#endif

  float lc = h * uLines + 0.5;
  float density = max(sqrt(gx * gx + gy * gy), 1e-5);
  float dist = abs(fract(lc + 0.5) - 0.5) / density;
  float major = uMajor * (1.0 - step(0.5, mod(floor(lc + 0.5), 5.0)));

  vec2 hd = spot - uHeat.xy;
  float heat = exp(-dot(hd, hd) / (uHeat.z * uHeat.z)) * uHeat.w + trail * 0.6;
  float energy = heat + ring;

  float depth = max(vDepth, 0.01);
  float persp = clamp(sqrt(uRefDepth / depth), 0.6, 1.6);
  float width = uLineWidth * persp * (1.0 + 0.6 * major) * (1.0 + 0.45 * min(energy, 1.5));
  float soft = 1.0 + min(uFocus.y * abs(1.0 - uFocus.x / depth), uFocus.z);
  float crowd = smoothstep(0.3, 0.75, density * max(width, soft));
  float cover = stroke(dist, width, soft, density, crowd);
  vec3 cover3 = vec3(cover);
  if (split > 0.0) {
    float offset = split * density;
    cover3.r = stroke(abs(fract(lc + offset + 0.5) - 0.5) / density, width, soft, density, crowd);
    cover3.b = stroke(abs(fract(lc - offset + 0.5) - 0.5) / density, width, soft, density, crowd);
    vec2 block = floor(vec2(gl_FragCoord.x / (uPixel * 26.0), py / 5.0)) + uGlitchSeed * 71.0;
    float drop = fract(sin(dot(block, vec2(12.9898, 78.233))) * 43758.5453);
    cover3 *= drop > 0.82 ? 0.1 : 1.2;
  }

  vec3 normal = normalize(vNormal);
  float sun = clamp(dot(normal, uSun), 0.0, 1.0);
  vec3 toLamp = uLamp.xyz - vec3(vTerrain.x, vLift, vTerrain.y);
  float lampDistance = length(toLamp);
  float lamp = clamp(dot(normal, toLamp / max(lampDistance, 1e-3)), 0.0, 1.0) * uLamp.w / (1.0 + lampDistance * lampDistance * 0.9);
  float level = mix(0.45, 1.05, smoothstep(0.0, 1.1, h)) * mix(0.35, 1.25, sun * sun) * (1.0 + 0.6 * major);
  level += heat * 1.4 + ring * 3.0 + lamp * 1.2;

  float fade = 1.0 - smoother((depth - uFade.x) / max(uFade.y - uFade.x, 1e-3));
  vec3 light = cover3 * level;

  if (uTrace.y > 0.0) {
    float traceWidth = uLineWidth * persp * 1.8;
    float trace = stroke(abs(h - uTrace.x) * uLines / density, traceWidth, soft, density, crowd);
    vec2 td = spot - uTrace.zw;
    light += trace * uTrace.y * mix(0.35, 1.0, exp(-dot(td, td) / 20.0)) * 2.6;
  }
  light *= fade * uBrightness * uReveal;

  if (uLightMode > 0.5) {
    float ink = (1.0 - exp(-max(max(light.r, light.g), light.b) * 1.8)) * 0.92 * uOpacity;
    outColor = vec4(uColor * ink, ink);
    return;
  }

  vec3 color = 1.0 - exp(-uColor * light * 1.8);
  float top = max(max(color.r, color.g), color.b);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  color = max(color + dither / 255.0 * step(0.002, top), 0.0);
  outColor = vec4(color, max(max(color.r, color.g), color.b)) * uOpacity;
}`,ho=`#version 300 es
${Ue}
uniform ivec2 uOrigin;
uniform ivec2 uCamCell;
uniform vec2 uCamFrac;
uniform float uSpacing;
uniform int uColumns;
uniform float uHeight;
uniform mat4 uViewProj;
uniform vec2 uView;
uniform float uSize;
uniform float uRefDepth;
uniform vec4 uHeat;
uniform float uTime;
uniform vec4 uGlitch[3];
uniform float uPixel;
out vec2 vCorner;
out float vSize;
out float vGlow;
out float vFrame;
out float vDepth;

void main() {
  ivec2 local = uOrigin + ivec2(gl_InstanceID % uColumns, gl_InstanceID / uColumns);
  ivec2 id = local + uCamCell;
  vec2 terrain = vec2(id) * uSpacing;
  vec2 world = vec2(local) * uSpacing - uCamFrac;
  float ring = swell(terrain);
  float h = (relief(terrain) + ring * 0.14) * settle(world) + sculpted(terrain).r;
  vec4 clip = uViewProj * vec4(world.x, h * uHeight + 0.05, world.y, 1.0);
  uint seed = lattice(id + ivec2(911, 377));
  float a = float(seed & 1023u) / 1023.0;
  float b = float((seed >> 10u) & 1023u) / 1023.0;
  vec2 hd = terrain - uHeat.xy;
  float heat = exp(-dot(hd, hd) / (uHeat.z * uHeat.z)) * uHeat.w;
  float blink = step(0.92, a) * (0.5 + 0.5 * sin(uTime * (1.4 + b * 2.2) + b * 40.0));
  float size = uSize * clamp(sqrt(uRefDepth / max(clip.w, 0.01)), 0.6, 1.3) * (1.0 + 0.4 * heat + 0.35 * blink);
  float frame = max(smoothstep(0.55, 0.95, blink), smoothstep(0.3, 0.8, heat));
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec2 offset = corner * (size * (frame > 0.001 ? 2.6 : 1.0) + 1.5);
  float py = (clip.y / clip.w * 0.5 + 0.5) * uView.y / uPixel;
  float shift = 0.0;
  for (int i = 0; i < 3; i++) {
    if (py >= uGlitch[i].x && py < uGlitch[i].y) shift = uGlitch[i].z;
  }
  clip.xy += (offset + vec2(shift * uPixel, 0.0)) / uView * 2.0 * clip.w;
  gl_Position = clip;
  vCorner = offset;
  vSize = size;
  vFrame = frame;
  vGlow = 0.5 + 0.4 * b + blink * 0.9 + heat * 1.8 + ring * 3.0;
  vDepth = clip.w;
}`,vo=`#version 300 es
precision highp float;
uniform vec3 uColor;
uniform vec2 uFade;
uniform float uReveal;
uniform float uBrightness;
uniform float uLightMode;
uniform float uOpacity;
uniform float uStyle;
uniform float uPixel;
in vec2 vCorner;
in float vSize;
in float vGlow;
in float vFrame;
in float vDepth;
out vec4 outColor;

float smoother(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

void main() {
  vec2 a = abs(vCorner);
  float cover;
  if (uStyle < 0.5) {
    float thick = max(0.6 * uPixel, 0.5);
    float across = clamp(vSize - a.x + 0.5, 0.0, 1.0) * clamp(thick - a.y + 0.5, 0.0, 1.0);
    float down = clamp(vSize - a.y + 0.5, 0.0, 1.0) * clamp(thick - a.x + 0.5, 0.0, 1.0);
    cover = max(across, down);
  } else {
    cover = clamp(vSize * 0.42 - length(vCorner) + 0.5, 0.0, 1.0);
  }
  if (vFrame > 0.001) {
    float edge = vSize * 2.3;
    float reach = edge * 0.45;
    float line = max(0.5 * uPixel, 0.5);
    float sides = clamp(line - abs(a.x - edge) + 0.5, 0.0, 1.0) * clamp(a.y - edge + reach + 0.5, 0.0, 1.0) * clamp(edge + line - a.y + 0.5, 0.0, 1.0);
    float caps = clamp(line - abs(a.y - edge) + 0.5, 0.0, 1.0) * clamp(a.x - edge + reach + 0.5, 0.0, 1.0) * clamp(edge + line - a.x + 0.5, 0.0, 1.0);
    cover = max(cover, max(sides, caps) * vFrame * 0.8);
  }
  float fade = 1.0 - smoother((vDepth - uFade.x) / max(uFade.y - uFade.x, 1e-3));
  float light = cover * vGlow * fade * fade * uReveal * uBrightness;
  if (uLightMode > 0.5) {
    float ink = (1.0 - exp(-light * 1.8)) * 0.92 * uOpacity;
    outColor = vec4(uColor * ink, ink);
    return;
  }
  vec3 color = 1.0 - exp(-uColor * light * 1.8);
  outColor = vec4(color, max(max(color.r, color.g), color.b)) * uOpacity;
}`,Me=`#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,po=`#version 300 es
precision highp float;
uniform sampler2D uPrevious;
uniform vec4 uSegment;
uniform vec4 uBrush;
uniform vec4 uBurst;
uniform vec2 uDecay;
out vec4 outColor;

vec2 wrapped(vec2 d) {
  return d - ${ze}.0 * floor(d / ${ze}.0 + 0.5);
}

void main() {
  vec4 previous = texelFetch(uPrevious, ivec2(gl_FragCoord.xy), 0);
  vec2 t = gl_FragCoord.xy / ${Re}.0 * ${ze}.0;
  vec2 a = wrapped(t - uSegment.xy);
  vec2 ab = uSegment.zw - uSegment.xy;
  float k = clamp(dot(a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 d = a - ab * k;
  float g = exp(-dot(d, d) / (uBrush.x * uBrush.x)) * uBrush.w;
  float height = previous.r * uDecay.x;
  height += (uBrush.y - height) * g * uBrush.z;
  float heat = previous.g * uDecay.y;
  heat += (1.0 - heat) * g * uBrush.z;
  vec2 b = wrapped(t - uBurst.xy);
  height += uBurst.w * exp(-dot(b, b) / (uBurst.z * uBurst.z));
  outColor = vec4(height, heat, 0.0, 1.0);
}`,xo=`#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTarget;
uniform vec2 uTexel;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uTarget;
  vec4 color = texture(uSource, uv - uTexel);
  color += texture(uSource, uv + uTexel);
  color += texture(uSource, uv + vec2(uTexel.x, -uTexel.y));
  color += texture(uSource, uv + vec2(-uTexel.x, uTexel.y));
  outColor = min(color * 0.25, vec4(1.0));
}`,go=`#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTarget;
uniform vec2 uStep;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uTarget;
  vec4 color = texture(uSource, uv) * 0.181862;
  color += (texture(uSource, uv + uStep * 1.423135) + texture(uSource, uv - uStep * 1.423135)) * 0.284316;
  color += (texture(uSource, uv + uStep * 3.326702) + texture(uSource, uv - uStep * 3.326702)) * 0.106598;
  color += (texture(uSource, uv + uStep * 5.242989) + texture(uSource, uv - uStep * 5.242989)) * 0.018156;
  outColor = color;
}`,Eo=`#version 300 es
precision highp float;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uBloom3;
uniform vec2 uView;
uniform float uGlow;
uniform float uLightMode;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec4 halo = texture(uBloom0, uv) * 0.4;
  halo += texture(uBloom1, uv) * 0.3;
  halo += texture(uBloom2, uv) * 0.2;
  halo += texture(uBloom3, uv) * 0.1;
  if (uLightMode > 0.5) {
    outColor = halo * uGlow * 0.35;
    return;
  }
  vec3 color = halo.rgb * uGlow * 1.6;
  color = color / (1.0 + color);
  outColor = vec4(color, max(max(color.r, color.g), color.b));
}`,S=(n,c,a)=>Math.min(a,Math.max(c,n)),re=n=>{const c=S(n,0,1);return c*c*c*(c*(c*6-15)+10)},yo=(n,c)=>{let a=Math.imul(n+1073741824,2654435761)+Math.imul(c+1073741824,2246822519)>>>0;return a=Math.imul(a^a>>>15,739982445)>>>0,a=Math.imul(a^a>>>12,695872825)>>>0,(a^a>>>15)>>>0},Ie=(n,c,a,l)=>{const m=yo(n,c);return((m&65535)/32767.5-1)*a+((m>>>16)/32767.5-1)*l},ne=(n,c)=>{const a=Math.floor(n),l=Math.floor(c),m=n-a,g=c-l,_=m*m*m*(m*(m*6-15)+10),q=g*g*g*(g*(g*6-15)+10),$=Ie(a,l,m,g),X=Ie(a+1,l,m-1,g),B=Ie(a,l+1,m,g-1),I=Ie(a+1,l+1,m-1,g-1),G=$+(X-$)*_;return G+(B+(I-B)*_-G)*q},Dt=(n,c,a,l,m)=>{let g=n*a,_=c*a;const q=ne(g*.42+l,_*.42+m),$=ne(g*.42-m+5.2,_*.42-l+1.3);g+=q*.8,_+=$*.8;let X=ne(g,_)*.55;const B=1.6*g-1.2*_+7.1,I=1.2*g+1.6*_+3.7;X+=ne(B,I)*.15,X+=ne(1.6*B-1.2*I+1.9,1.2*B+1.6*I+8.3)*.04;const G=Math.log(1+Math.exp(7*(3*X+.05)))/7;return G*G*1.4+.1*X},wo=(n,c,a)=>{const l=n*a*5+13.1,m=c*a*5+4.7;return ne(l,m)*.6+ne(1.6*l-1.2*m+2.3,1.2*l+1.6*m+6.1)*.3},_t=(n,c,a)=>{const l=n.createShader(c);return l?(n.shaderSource(l,a),n.compileShader(l),l):null},ie=(n,c,a)=>{const l=_t(n,n.VERTEX_SHADER,c),m=_t(n,n.FRAGMENT_SHADER,a),g=n.createProgram();return!l||!m||!g?null:(n.attachShader(g,l),n.attachShader(g,m),n.linkProgram(g),n.deleteShader(l),n.deleteShader(m),{program:g,uniforms:{}})},Pt=(n,c)=>{if(!n.getProgramParameter(c.program,n.LINK_STATUS))return!1;const a=n.getProgramParameter(c.program,n.ACTIVE_UNIFORMS);for(let l=0;l<a;l++){const m=n.getActiveUniform(c.program,l);m&&(c.uniforms[m.name.replace(/\[0\]$/,"")]=n.getUniformLocation(c.program,m.name))}return!0},Fo=n=>{let c=String(n||"#ffffff").replace("#","").trim();(c.length===3||c.length===4)&&(c=c.slice(0,3).split("").map(l=>l+l).join(""));const a=parseInt(c.slice(0,6),16);return Number.isNaN(a)?[1,1,1]:[(a>>16&255)/255,(a>>8&255)/255,(a&255)/255]},To=(n,c)=>{const a=Math.cos(c),l=[Math.sin(n)*a,-Math.sin(c),Math.cos(n)*a],m=[Math.cos(n),0,-Math.sin(n)],g=[l[1]*m[2]-l[2]*m[1],l[2]*m[0]-l[0]*m[2],l[0]*m[1]-l[1]*m[0]];return{f:l,r:m,u:g}},tt=n=>S(.4877/n,io,.6),Mo=({eye:n,f:c,r:a,u:l},m,g)=>{const _=1/tt(m),q=1/(me-Oe),$=[a[0],l[0],-c[0],0,a[1],l[1],-c[1],0,a[2],l[2],-c[2],0,-(a[0]*n[0]+a[1]*n[1]+a[2]*n[2]),-(l[0]*n[0]+l[1]*n[1]+l[2]*n[2]),c[0]*n[0]+c[1]*n[1]+c[2]*n[2],1],X=[_/m,0,0,0,0,_,0,0,0,0,(Oe+me)*q,-1,0,0,2*Oe*me*q,0];for(let B=0;B<4;B++)for(let I=0;I<4;I++){let G=0;for(let ue=0;ue<4;ue++)G+=X[ue*4+I]*$[B*4+ue];g[B*4+I]=G}return g},bo=({color:n="#4f7cff",lineCount:c=22,lineWidth:a=1.2,majorLines:l=!0,elevation:m=1,foreground:g=.2,scale:_=1,detail:q=.35,tilt:$=32,speed:X=.25,direction:B="forward",morph:I=.2,glow:G=.6,depthOfField:ue=.4,fog:Bt=.35,brightness:Nt=1,opacity:It=1,mouseInteraction:Ot=!0,hoverEffect:ot="lift",mouseRadius:zt=1,mouseStrength:kt=.6,trail:Ut=.3,parallax:Ht=.5,clickEffect:Xt="pulse",markers:Gt="none",glitch:Vt=0,intro:Zt=!0,lightMode:jt=!1,dpr:qt,className:$t="",style:Kt})=>{const rt=ee.useRef(null),it=ee.useRef(null),He=ee.useRef(null),be=ee.useRef(0),[Wt,Yt]=ee.useState(0),nt={color:n,lineCount:S(c,2,80),lineWidth:Math.max(.2,a),majorLines:l,elevation:S(m,0,3),foreground:S(g,0,1),scale:S(_,.2,5),detail:S(q,0,1),tilt:S($,12,90),speed:X,direction:At[B]??At.forward,morph:Math.max(0,I),glow:Math.max(0,G),depthOfField:S(ue,0,1),fog:S(Bt,0,1),brightness:Math.max(0,Nt),opacity:S(It,0,1),mouseInteraction:Ot,hoverEffect:ao.includes(ot)?ot:"lift",mouseRadius:Math.max(.1,zt),mouseStrength:Math.max(0,kt),trail:S(Ut,0,1),parallax:S(Ht,0,1),clickEffect:Xt,markers:lo[Gt]??-1,glitch:S(Vt,0,1),intro:Zt,lightMode:jt,dpr:qt},U=ee.useRef(nt);return U.current=nt,ee.useEffect(()=>{const ae=rt.current,L=it.current,Qt=Math.min(U.current.dpr||window.devicePixelRatio||1,2),e=L?.getContext("webgl2",{alpha:!0,premultipliedAlpha:!0,antialias:Qt<1.5,depth:!0,stencil:!1,preserveDrawingBuffer:!0,powerPreference:"low-power"});if(!ae||!L||!e)return;cancelAnimationFrame(be.current),be.current=0;const Se=e.getExtension("KHR_parallel_shader_compile"),he=!!e.getExtension("EXT_color_buffer_float"),de=ie(e,so(he),mo(he));let K=he?ie(e,Me,fo):null,W=he?ie(e,Me,po):null;const te=ie(e,Me,xo),Y=ie(e,Me,go),ve=ie(e,Me,Eo),pe=ie(e,ho,vo);if(!de||!te||!Y||!ve||!pe)return;const Xe=()=>[de,K,W,te,Y,ve,pe].filter(Boolean),ut=()=>!Se||Xe().every(t=>e.getProgramParameter(t.program,Se.COMPLETION_STATUS_KHR)),at=t=>!t||Pt(e,t)?t:(e.deleteProgram(t.program),null),lt=()=>(K=at(K),W=at(W),[de,te,Y,ve,pe].every(t=>Pt(e,t)));if(!Se&&!lt()){Xe().forEach(t=>e.deleteProgram(t.program));return}const ct=t=>t.preventDefault(),ft=()=>Yt(t=>t+1);L.addEventListener("webglcontextlost",ct),L.addEventListener("webglcontextrestored",ft);const st=e.createVertexArray(),Jt=he?e.RGBA16F:e.RGBA8,xe=(t,r,i,f)=>{const u=e.createTexture();return e.bindTexture(e.TEXTURE_2D,u),e.texStorage2D(e.TEXTURE_2D,1,i,t,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,f),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,f),u},Ge=()=>({texture:null,framebuffer:e.createFramebuffer(),depth:null,width:0,height:0}),Ve=(t,r,i,f)=>{t.texture&&t.width===r&&t.height===i||(t.texture&&e.deleteTexture(t.texture),t.texture=xe(r,i,Jt,e.CLAMP_TO_EDGE),t.width=r,t.height=i,e.bindFramebuffer(e.FRAMEBUFFER,t.framebuffer),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t.texture,0),f&&(t.depth||(t.depth=e.createRenderbuffer()),e.bindRenderbuffer(e.RENDERBUFFER,t.depth),e.renderbufferStorage(e.RENDERBUFFER,e.DEPTH_COMPONENT24,r,i),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.DEPTH_ATTACHMENT,e.RENDERBUFFER,t.depth)))},Ce=Ge(),Le=Array.from({length:Lt},()=>[Ge(),Ge()]);let P=W?[0,1].map(()=>{const t=xe(Re,Re,e.RG16F,e.REPEAT),r=e.createFramebuffer();return e.bindFramebuffer(e.FRAMEBUFFER,r),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),{texture:t,framebuffer:r}}):null;const ge=xe(1,1,e.RGBA8,e.REPEAT),E={texture:null,heights:null,framebuffer:e.createFramebuffer(),width:0,height:0};let le=0;const eo=(t,r)=>{E.texture&&t<=E.width&&r<=E.height||(E.texture&&e.deleteTexture(E.texture),E.heights&&e.deleteTexture(E.heights),E.width=Math.max(t,Math.ceil(E.width*1.25),64),E.height=Math.max(r,Math.ceil(E.height*1.25),64),E.texture=xe(E.width,E.height,e.RGBA16F,e.CLAMP_TO_EDGE),E.heights=xe(E.width,E.height,e.R32F,e.CLAMP_TO_EDGE),e.bindTexture(e.TEXTURE_2D,E.heights),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.bindFramebuffer(e.FRAMEBUFFER,E.framebuffer),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,E.texture,0),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT1,e.TEXTURE_2D,E.heights,0),e.drawBuffers([e.COLOR_ATTACHMENT0,e.COLOR_ATTACHMENT1]))},V=(t,r)=>{e.activeTexture(e.TEXTURE0+t),e.bindTexture(e.TEXTURE_2D,r)},Q=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches??!1,Ze=new Float32Array(16),Ee=new Float32Array(ke*4),ce=new Float32Array(12),N={until:0,next:1.5,roll:0,seed:0};let je=7919;const Z=()=>(je=je*16807%2147483647,(je-1)/2147483646),j=[],O={x:0,y:0,inside:!1},h={width:1,height:1,ratio:1,cell:.05,cellKey:""},o={intro:U.current.intro&&!Q?0:1,rise:1,travelX:0,travelZ:0,morph:0,yaw:0,pitch:0,yawVelocity:0,pitchVelocity:0,presence:0,focus:Ct,hit:null,brushFrom:null,sculptLife:0,burst:null,level:0,trace:0,clock:0,tilt:U.current.tilt,elevation:U.current.elevation,scale:U.current.scale};o.rise=re(o.intro);let fe=0,Ae=0,De=!0,_e=0,Pe=!Se,mt=!1;const qe=()=>{const t=Math.min(o.tilt*Math.PI/180+o.pitch,Math.PI/2-1e-4),r=To(o.yaw,t),i=o.elevation*Fe*o.rise*.18,f=o.elevation*Fe*o.rise*1.3+.9,u=Math.max(Ct,(f-i)/Math.sin(t));return{...r,distance:u,eye:[-r.f[0]*u,i-r.f[1]*u,-r.f[2]*u]}},$e=(t,r,i)=>{const f=h.width/h.height,u=tt(f),v=[0,1,2].map(d=>t.f[d]+t.r[d]*r*u*f+t.u[d]*i*u),b=Math.hypot(v[0],v[1],v[2]);return v.map(d=>d/b)},Ke=(t,r)=>r[0]*t.f[0]+r[1]*t.f[1]+r[2]*t.f[2],We=(t,r)=>{const i=$e(t,0,r);return i[1]>-.001?1/0:t.eye[1]/-i[1]*Ke(t,i)},ht=(t,r)=>[We(t,-1)*.9,t.distance,r.foreground],to=(t,r,i,f)=>{const u=(i-t.eye[0])*t.f[0]-t.eye[1]*t.f[1]+(f-t.eye[2])*t.f[2];return r[2]+(1-r[2])*re((u-r[0])/Math.max(r[1]-r[0],.001))},dt=(t,r,i,f)=>{const u=$e(t,i,f),v=o.elevation*Fe*o.rise,b=Te/o.scale,d=ht(t,r),w=x=>{const z=t.eye[0]+u[0]*x,R=t.eye[2]+u[2]*x,oe=Dt(o.travelX+z,o.travelZ+R,b,o.morph*.37,o.morph*.23);return t.eye[1]+u[1]*x-oe*v*to(t,d,z,R)};let M=me,A=w(M);for(let x=0;x<200&&M<Oe*.5;x++){const z=M+Math.max(.02,A*.4),R=w(z);if(R<0){let oe=M,k=z;for(let ye=0;ye<10;ye++){const T=(oe+k)*.5;w(T)<0?k=T:oe=T}return{x:o.travelX+t.eye[0]+u[0]*k,y:t.eye[1]+u[1]*k,z:o.travelZ+t.eye[2]+u[2]*k,depth:k*Ke(t,u)}}M=z,A=R}return null},oo=(t,r,i)=>{const f=o.elevation*Fe*o.rise*1.7+.2+r.mouseStrength,u={minX:1/0,maxX:-1/0,minZ:1/0,maxZ:-1/0,near:1/0},v=(b,d)=>{const w=t.eye[0]+b[0]*d,M=t.eye[2]+b[2]*d;u.minX=Math.min(u.minX,w),u.maxX=Math.max(u.maxX,w),u.minZ=Math.min(u.minZ,M),u.maxZ=Math.max(u.maxZ,M)};for(const b of[-1.08,0,1.08])for(const d of[-1.08,1.08]){const w=$e(t,b,d),M=Math.max(Ke(t,w),.001);let A=me,x=i*1.05/M;w[1]<-1e-4&&(A=Math.max(me,(t.eye[1]-f)/-w[1]),x=Math.min(x,t.eye[1]/-w[1])),A=Math.min(A,x),v(w,A),v(w,x),u.near=Math.min(u.near,A*M)}return u},vt=(t,r)=>{const i=Math.floor(o.travelX/r),f=Math.floor(o.travelZ/r),u=o.travelX-i*r,v=o.travelZ-f*r,b=Math.floor((t.minX+u)/r)-2,d=Math.floor((t.minZ+v)/r)-2,w=S(Math.ceil((t.maxX+u)/r)+2-b,1,4e3),M=S(Math.ceil((t.maxZ+v)/r)+2-d,1,Math.floor(et*1.5/w));return{cell:r,camX:i,camZ:f,fracX:u,fracZ:v,k0:b,m0:d,columns:w,rows:M}},Ye=()=>{if(!Pe)return;const t=U.current,r=qe();Mo(r,h.width/h.height,Ze);const i=We(r,-1),f=Math.min(We(r,1),r.distance*3.2),u=Math.max(f,i*1.6,r.distance*1.4),v=u+(i*1.8-u)*t.fog,b=v*.7+(i*.7-v*.7)*t.fog,d=oo(r,t,v),w=`${h.width}x${h.height}@${h.ratio}|${Math.round(o.tilt/4)}|${Math.round(o.elevation*5)}|${t.fog}`;if(w!==h.cellKey){h.cellKey=w;const y=h.height*h.ratio*.5/tt(h.width/h.height);let C=S(14*Math.max(d.near,.5)/y,.02,.4);const F=(d.maxX-d.minX)*(d.maxZ-d.minZ)/(C*C);F>et&&(C*=Math.sqrt(F/et)),h.cell=C}const M=Fo(t.color),A=o.elevation*Fe*o.rise,x=vt(d,h.cell),z=ht(r,t),R=t.markers>=0?vt(d,co):null,k=(o.hit&&t.mouseInteraction?o.presence:0)*(.35+.5*t.mouseStrength),ye=t.depthOfField*h.height*.016,T=re(o.intro/.35),H=o.hit?o.hit.x:0,se=o.hit?o.hit.z:0;if(Ee.fill(0),j.forEach((y,C)=>{Ee.set([y.x,y.z,y.age*4.2,Math.exp(-y.age*1.1)*re(y.age/.08)],C*4)}),e.bindVertexArray(st),K){const y=x.columns+7,C=x.rows+7;eo(y,C),e.bindFramebuffer(e.FRAMEBUFFER,E.framebuffer),e.viewport(0,0,y,C),e.useProgram(K.program);const F=K.uniforms;V(0,P?P[le].texture:ge),e.uniform1i(F.uSculpt,0),e.uniform1f(F.uSculptOn,P?1:0),e.uniform1f(F.uFrequency,Te/o.scale),e.uniform2f(F.uMorph,o.morph*.37,o.morph*.23),e.uniform4fv(F.uPulses,Ee),e.uniform2i(F.uBase,x.k0-2+x.camX,x.m0-2+x.camZ),e.uniform1f(F.uCell,x.cell),e.uniform1f(F.uDetail,t.detail),e.disable(e.DEPTH_TEST),e.disable(e.BLEND),e.drawArrays(e.TRIANGLES,0,3)}const we=(y,C,F,D)=>{e.viewport(0,0,C,F),e.useProgram(de.program);const s=de.uniforms;if(V(0,K?E.texture:ge),e.uniform1i(s.uField,0),V(1,K?E.heights:ge),e.uniform1i(s.uHeightField,1),e.uniform1f(s.uFrequency,Te/o.scale),e.uniform2f(s.uMorph,o.morph*.37,o.morph*.23),e.uniform4fv(s.uPulses,Ee),e.uniform2i(s.uOrigin,x.k0,x.m0),e.uniform2i(s.uCamCell,x.camX,x.camZ),e.uniform2f(s.uCamFrac,x.fracX,x.fracZ),e.uniform1f(s.uCell,x.cell),e.uniform1i(s.uStride,D),e.uniform1f(s.uHeight,A),e.uniform3fv(s.uEye,r.eye),e.uniform3fv(s.uForward,r.f),e.uniform3fv(s.uNear,z),e.uniform1f(s.uRefDepth,r.distance),e.uniformMatrix4fv(s.uViewProj,!1,Ze),e.uniform1f(s.uDetail,t.detail),e.uniform1f(s.uLines,t.lineCount),e.uniform1f(s.uLineWidth,t.lineWidth*y),e.uniform1f(s.uMajor,t.majorLines?1:0),e.uniform3fv(s.uColor,M),e.uniform1f(s.uBrightness,t.brightness),e.uniform2f(s.uFade,b,v),e.uniform3f(s.uFocus,o.focus,ye*y,h.height*.03*y),e.uniform4f(s.uHeat,H,se,.9*t.mouseRadius,k),e.uniform4f(s.uLamp,H,o.hit?o.hit.y+1.4:0,se,k),e.uniform4f(s.uTrace,o.level,o.trace,H,se),e.uniform3fv(s.uSun,uo),e.uniform1f(s.uReveal,T),e.uniform1f(s.uLightMode,t.lightMode?1:0),e.uniform1f(s.uOpacity,t.opacity),e.uniform4fv(s.uGlitch,ce),e.uniform1f(s.uGlitchSeed,N.seed),e.uniform1f(s.uPixel,y),e.enable(e.DEPTH_TEST),e.depthFunc(e.LESS),e.disable(e.BLEND),e.clearColor(0,0,0,0),e.clearDepth(1),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),e.drawArraysInstanced(e.TRIANGLE_STRIP,0,2*(Math.ceil(x.columns/D)+1),Math.ceil(x.rows/D)),R){e.useProgram(pe.program);const p=pe.uniforms;V(2,P?P[le].texture:ge),e.uniform1i(p.uSculpt,2),e.uniform1f(p.uSculptOn,P?1:0),e.uniform1f(p.uFrequency,Te/o.scale),e.uniform2f(p.uMorph,o.morph*.37,o.morph*.23),e.uniform4fv(p.uPulses,Ee),e.uniform3fv(p.uEye,r.eye),e.uniform3fv(p.uForward,r.f),e.uniform3fv(p.uNear,z),e.uniform2i(p.uOrigin,R.k0,R.m0),e.uniform2i(p.uCamCell,R.camX,R.camZ),e.uniform2f(p.uCamFrac,R.fracX,R.fracZ),e.uniform1f(p.uSpacing,R.cell),e.uniform1i(p.uColumns,R.columns+1),e.uniform1f(p.uHeight,A),e.uniformMatrix4fv(p.uViewProj,!1,Ze),e.uniform2f(p.uView,C,F),e.uniform1f(p.uSize,4*y),e.uniform1f(p.uRefDepth,r.distance),e.uniform4f(p.uHeat,H,se,1.2*t.mouseRadius,k),e.uniform1f(p.uTime,o.clock),e.uniform4fv(p.uGlitch,ce),e.uniform1f(p.uPixel,y),e.uniform3fv(p.uColor,M),e.uniform2f(p.uFade,b,v),e.uniform1f(p.uReveal,T),e.uniform1f(p.uBrightness,t.brightness),e.uniform1f(p.uLightMode,t.lightMode?1:0),e.uniform1f(p.uOpacity,t.opacity),e.uniform1f(p.uStyle,t.markers),e.depthFunc(e.LEQUAL),e.depthMask(!1),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA),e.drawArraysInstanced(e.TRIANGLE_STRIP,0,4,(R.columns+1)*(R.rows+1)),e.disable(e.BLEND),e.depthMask(!0)}e.disable(e.DEPTH_TEST)},Ne=t.glow>.001;if(Ne){const y=Math.max(1,Math.round(h.width/2)),C=Math.max(1,Math.round(h.height/2));Ve(Ce,y,C,!0),Le.forEach((D,s)=>{const p=Math.max(1,Math.round(h.width/2**(s+2))),bt=Math.max(1,Math.round(h.height/2**(s+2)));Ve(D[0],p,bt,!1),Ve(D[1],p,bt,!1)}),e.bindFramebuffer(e.FRAMEBUFFER,Ce.framebuffer),we(.5,y,C,2);let F=Ce;Le.forEach(([D,s])=>{e.bindFramebuffer(e.FRAMEBUFFER,D.framebuffer),e.viewport(0,0,D.width,D.height),e.useProgram(te.program),V(0,F.texture),e.uniform1i(te.uniforms.uSource,0),e.uniform2f(te.uniforms.uTarget,D.width,D.height),e.uniform2f(te.uniforms.uTexel,1/F.width,1/F.height),e.drawArrays(e.TRIANGLES,0,3),e.useProgram(Y.program),e.uniform1i(Y.uniforms.uSource,0),e.uniform2f(Y.uniforms.uTarget,s.width,s.height),e.bindFramebuffer(e.FRAMEBUFFER,s.framebuffer),V(0,D.texture),e.uniform2f(Y.uniforms.uStep,1/D.width,0),e.drawArrays(e.TRIANGLES,0,3),e.bindFramebuffer(e.FRAMEBUFFER,D.framebuffer),V(0,s.texture),e.uniform2f(Y.uniforms.uStep,0,1/s.height),e.drawArrays(e.TRIANGLES,0,3),F=D})}if(e.bindFramebuffer(e.FRAMEBUFFER,null),we(h.ratio,L.width,L.height,1),Ne){e.viewport(0,0,L.width,L.height),e.useProgram(ve.program);const y=ve.uniforms;Le.forEach(([C],F)=>{V(F,C.texture),e.uniform1i(y[`uBloom${F}`],F)}),e.uniform2f(y.uView,L.width,L.height),e.uniform1f(y.uGlow,t.glow*T),e.uniform1f(y.uLightMode,t.lightMode?1:0),e.enable(e.BLEND),t.lightMode?e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA):e.blendFunc(e.ONE,e.ONE),e.drawArrays(e.TRIANGLES,0,3),e.disable(e.BLEND)}for(let y=Lt;y>=0;y--)V(y,null)},ro=(t,r)=>{if(!P||!W)return!1;const i=t.mouseInteraction&&t.hoverEffect==="lift"&&o.presence>.001?o.hit:null,f=o.burst;if(!i&&!f&&o.sculptLife<=0)return!1;const u=o.brushFrom||i,v=P[le],b=P[1-le];e.bindFramebuffer(e.FRAMEBUFFER,b.framebuffer),e.viewport(0,0,Re,Re),e.useProgram(W.program);const d=W.uniforms;if(V(0,v.texture),e.uniform1i(d.uPrevious,0),i&&u?e.uniform4f(d.uSegment,u.x,u.z,i.x,i.z):e.uniform4f(d.uSegment,0,0,0,0),e.uniform4f(d.uBrush,1.1*t.mouseRadius,.9*t.mouseStrength,1-Math.exp(-r*7),i?o.presence:0),f){const M=re(f.age/.7);f.age+=r;const A=(re(f.age/.7)-M)*.9*Math.max(t.mouseStrength,.3);e.uniform4f(d.uBurst,f.x,f.z,1.6*t.mouseRadius,A),f.age>=.7&&(o.burst=null)}else e.uniform4f(d.uBurst,0,0,1,0);const w=.25+3*t.trail*t.trail;return e.uniform2f(d.uDecay,Math.exp(-r/w),Math.exp(-r/.7)),e.disable(e.BLEND),e.drawArrays(e.TRIANGLES,0,3),le=1-le,o.brushFrom=i?{x:i.x,z:i.z}:null,i||f?o.sculptLife=w*6:o.sculptLife-=r,!0};let pt=U.current.dpr;const Qe=()=>{const t=U.current;pt=t.dpr,h.width=Math.max(1,ae.clientWidth),h.height=Math.max(1,ae.clientHeight),h.ratio=Math.min(t.dpr||window.devicePixelRatio||1,2),L.width=Math.max(1,Math.round(h.width*h.ratio)),L.height=Math.max(1,Math.round(h.height*h.ratio)),Ye(),J()},Je=t=>{if(fe=0,!De||document.hidden)return;if(!Pe){if(e.isContextLost())return;if(!ut()){fe=requestAnimationFrame(Je);return}if(!lt()){Rt();return}!W&&P&&(P.forEach(T=>{e.deleteTexture(T.texture),e.deleteFramebuffer(T.framebuffer)}),P=null),Pe=!0,Ye()}const r=U.current;r.dpr!==pt&&Qe();const i=Ae?S((t-Ae)/1e3,0,1/20):1/60;Ae=t,!r.intro||Q?o.intro=1:o.intro<1&&(o.intro=Math.min(1,o.intro+i/no)),o.rise=re(o.intro);const f=Q?1:1-Math.exp(-i/.4);o.tilt+=(r.tilt-o.tilt)*f,o.elevation+=(r.elevation-o.elevation)*f,o.scale=r.scale,o.clock+=i;const u=Q?0:r.glitch;if(u>0)if(o.clock>=N.next&&o.clock>=N.until&&(N.until=o.clock+.1+Z()*.22*(.5+u),N.next=N.until+(9-7.4*u)*(.45+Z()*1.1),N.roll=0),o.clock<N.until){if(o.clock>=N.roll){ce.fill(0);const T=1+Math.floor(Z()*3);for(let H=0;H<T;H++){const se=3+Z()*Z()*h.height*.14,we=Z()*h.height,Ne=(Z()-.5)*2*(10+46*u);ce.set([we,we+se,Ne,1+Z()*3*u],H*4)}N.seed=Z(),N.roll=o.clock+.04+Z()*.05}}else ce.fill(0);else ce.fill(0);Q||(o.travelX+=r.direction[0]*r.speed*.8*i,o.travelZ+=r.direction[1]*r.speed*.8*i,o.morph+=r.morph*.12*i);const v=O.inside&&r.mouseInteraction;o.presence+=((v?1:0)-o.presence)*(1-Math.exp(-i/(v?.18:.45)));const b=O.x/h.width*2-1,d=1-O.y/h.height*2,w=Q||!v?0:r.parallax,M=b*w*.09,A=-d*w*.045;o.yawVelocity+=(38*(M-o.yaw)-11*o.yawVelocity)*i,o.pitchVelocity+=(38*(A-o.pitch)-11*o.pitchVelocity)*i,o.yaw+=o.yawVelocity*i,o.pitch+=o.pitchVelocity*i;const x=qe();v?(o.hit=dt(x,r,b,d),o.hit&&o.brushFrom&&Math.hypot(o.hit.x-o.brushFrom.x,o.hit.z-o.brushFrom.z)>3*r.mouseRadius&&(o.brushFrom=null)):o.presence<.002&&(o.hit=null,o.brushFrom=null);const z=o.hit&&r.mouseInteraction&&r.hoverEffect==="trace"?o.presence:0;if(o.hit){const T=Te/o.scale,H=Dt(o.hit.x,o.hit.z,T,o.morph*.37,o.morph*.23)+r.detail*.1*wo(o.hit.x,o.hit.z,T);o.level=o.trace<.01?H:o.level+(H-o.level)*(1-Math.exp(-i/.09))}o.trace+=(z-o.trace)*(1-Math.exp(-i/.2));const R=o.hit&&r.depthOfField>0?o.hit.depth:x.distance;o.focus+=(R-o.focus)*(1-Math.exp(-i/.35));for(let T=j.length-1;T>=0;T--)j[T].age+=i,j[T].age>4&&j.splice(T,1);const oe=ro(r,i);Ye();const k=Math.abs(r.tilt-o.tilt)>.01||Math.abs(r.elevation-o.elevation)>1e-4||Math.abs(o.yaw-M)>1e-4||Math.abs(o.pitch-A)>1e-4||Math.abs(o.yawVelocity)>1e-4||Math.abs(o.pitchVelocity)>1e-4||Math.abs(R-o.focus)>.001||Math.abs(z-o.trace)>.001;_e=!Q&&(r.speed!==0||r.morph!==0||r.glitch>0||r.markers>=0)||o.intro<1||j.length>0||oe||k||o.presence>.001&&o.presence<.999?0:_e+i,_e<.5&&(fe=requestAnimationFrame(Je))};function J(){_e=0,!fe&&De&&!document.hidden&&(Ae=0,fe=requestAnimationFrame(Je))}const xt=t=>{const r=ae.getBoundingClientRect(),i=t.clientX-r.left,f=t.clientY-r.top;return{x:i,y:f,inside:i>=0&&f>=0&&i<=r.width&&f<=r.height}},gt=t=>{const{x:r,y:i,inside:f}=xt(t),u=O.inside;O.inside=f,f&&(O.x=r,O.y=i),(f||u)&&J()},Et=t=>{const r=U.current,{x:i,y:f,inside:u}=xt(t);if(!u||(O.x=i,O.y=f,O.inside=!0,J(),r.glitch>0&&!Q&&(N.until=o.clock+.16,N.roll=0),!r.mouseInteraction||r.clickEffect!=="pulse"&&r.clickEffect!=="peak"))return;const v=dt(qe(),r,i/h.width*2-1,1-f/h.height*2);v&&(r.clickEffect==="peak"&&P?o.burst={x:v.x,z:v.z,age:0}:r.clickEffect==="pulse"&&(j.length>=ke&&j.shift(),j.push({x:v.x,z:v.z,age:0})))},Be=t=>{t.pointerType==="touch"&&(O.inside=!1,J())},yt=()=>{O.inside=!1,J()},wt=()=>J(),Ft=new ResizeObserver(Qe);Ft.observe(ae);const Tt=new IntersectionObserver(t=>{De=t.some(r=>r.isIntersecting),De&&J()});Tt.observe(ae),window.addEventListener("pointermove",gt,{passive:!0}),window.addEventListener("pointerdown",Et,{passive:!0}),window.addEventListener("pointerup",Be,{passive:!0}),window.addEventListener("pointercancel",Be,{passive:!0}),document.documentElement.addEventListener("pointerleave",yt),document.addEventListener("visibilitychange",wt);const Mt=()=>{if(!e.isContextLost()){if(!Pe&&!ut()){requestAnimationFrame(Mt);return}Xe().forEach(t=>e.deleteProgram(t.program))}},Rt=()=>{mt||(mt=!0,cancelAnimationFrame(fe),He.current=null,Ft.disconnect(),Tt.disconnect(),window.removeEventListener("pointermove",gt),window.removeEventListener("pointerdown",Et),window.removeEventListener("pointerup",Be),window.removeEventListener("pointercancel",Be),document.documentElement.removeEventListener("pointerleave",yt),document.removeEventListener("visibilitychange",wt),L.removeEventListener("webglcontextlost",ct),L.removeEventListener("webglcontextrestored",ft),[Ce,...Le.flat()].forEach(t=>{t.texture&&e.deleteTexture(t.texture),t.depth&&e.deleteRenderbuffer(t.depth),e.deleteFramebuffer(t.framebuffer)}),P?.forEach(t=>{e.deleteTexture(t.texture),e.deleteFramebuffer(t.framebuffer)}),e.deleteTexture(ge),e.deleteVertexArray(st),E.texture&&e.deleteTexture(E.texture),E.heights&&e.deleteTexture(E.heights),e.deleteFramebuffer(E.framebuffer),Mt())};return Qe(),He.current=J,()=>{Rt();const t=()=>{be.current=0,!L.isConnected&&!e.isContextLost()&&e.getExtension("WEBGL_lose_context")?.loseContext()};L.isConnected?be.current=requestAnimationFrame(t):t()}},[Wt]),ee.useEffect(()=>{He.current?.()}),St.jsx("div",{ref:rt,className:`topography-container ${$t}`.trim(),style:Kt,children:St.jsx("canvas",{ref:it,className:"topography-canvas","aria-hidden":"true"})})};export{bo as default};
