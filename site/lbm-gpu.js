/* D2Q9 BGK engine — WebGL2 fragment shaders, ping-pong float textures.
 *
 * Same equations as lbm-cpu.js / lbm.py. Populations are stored as
 * DEVIATIONS g_i = f_i - w_i in three RGBA32F textures (T0: g0..g3,
 * T1: g4..g7, T2: g8) — raw f_i would waste fp32 mantissa on the constant
 * part (blindspot #8). Requires EXT_color_buffer_float; without it the
 * caller must fall back to the CPU engine (or visual-only mode).
 *
 * Passes per step: A collide (MRT x3) -> B stream + half-way bounce-back +
 * inlet/outlet (MRT x3). Forces: dedicated pass writing per-cell link
 * contributions for two tracked bodies into one RGBA32F target, read back
 * and summed on the CPU at gauge rate.
 */
"use strict";

const LBMGPU = (() => {
  const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
  const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
  const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
  const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];

  const GLSL_COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
const int CX[9] = int[9](0,1,0,-1,0,1,-1,-1,1);
const int CY[9] = int[9](0,0,1,0,-1,1,1,-1,-1);
const float WQ[9] = float[9](4./9.,1./9.,1./9.,1./9.,1./9.,1./36.,1./36.,1./36.,1./36.);
const int OPP[9] = int[9](0,3,4,1,2,7,8,5,6);
uniform ivec2 uGrid;
ivec2 wrapc(ivec2 p){ return ivec2((p.x+uGrid.x)%uGrid.x,(p.y+uGrid.y)%uGrid.y); }
float g_at(sampler2D t0, sampler2D t1, sampler2D t2, ivec2 p, int q){
  if(q<4)  return texelFetch(t0,p,0)[q];
  if(q<8)  return texelFetch(t1,p,0)[q-4];
  return texelFetch(t2,p,0).x;
}
`;

  const VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos,0.,1.); }`;

  // Pass A: collide. Reads g textures, writes post-collision g (3 MRTs).
  const FS_COLLIDE = GLSL_COMMON + `
uniform sampler2D uF0, uF1, uF2, uObst;
uniform float uOmega, uTau;
uniform vec2 uG;               // body force
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float ob = texelFetch(uObst,p,0).x;
  vec4 a = texelFetch(uF0,p,0), b = texelFetch(uF1,p,0);
  float g8 = texelFetch(uF2,p,0).x;
  if(ob>0.5){ o0=a; o1=b; o2=vec4(g8,0.,0.,0.); return; }
  float g[9]; g[0]=a.x; g[1]=a.y; g[2]=a.z; g[3]=a.w;
  g[4]=b.x; g[5]=b.y; g[6]=b.z; g[7]=b.w; g[8]=g8;
  float rho = 1.0; vec2 m = vec2(0.);
  for(int q=0;q<9;q++){ rho += g[q]; m += vec2(float(CX[q]),float(CY[q]))*g[q]; }
  vec2 u = m/rho + uTau*uG/rho;
  float us = dot(u,u);
  float go[9];
  for(int q=0;q<9;q++){
    float cu = float(CX[q])*u.x + float(CY[q])*u.y;
    float feq = WQ[q]*rho*(1.+3.*cu+4.5*cu*cu-1.5*us);
    go[q] = g[q] + uOmega*((feq-WQ[q]) - g[q]);
  }
  o0 = vec4(go[0],go[1],go[2],go[3]);
  o1 = vec4(go[4],go[5],go[6],go[7]);
  o2 = vec4(go[8],0.,0.,0.);
}`;

  // Pass B: stream (pull) + half-way bounce-back + open BCs.
  const FS_STREAM = GLSL_COMMON + `
uniform sampler2D uF0, uF1, uF2, uObst;
uniform vec2 uWallU[8];        // per-body wall velocity
uniform float uOpen;           // 1 = inlet/outlet on x
uniform vec2 uInletU;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
float streamed(ivec2 p, int q){
  ivec2 src = wrapc(p - ivec2(CX[q],CY[q]));
  float ob = texelFetch(uObst,src,0).x;
  if(ob>0.5){
    int oq = OPP[q];
    int b = int(ob+0.5);
    float corr = 6.*WQ[oq]*(float(CX[oq])*uWallU[b].x + float(CY[oq])*uWallU[b].y);
    return g_at(uF0,uF1,uF2,p,oq) - corr;
  }
  return g_at(uF0,uF1,uF2,src,q);
}
float eqDev(int q, float rho, vec2 u){
  float cu = float(CX[q])*u.x + float(CY[q])*u.y;
  return WQ[q]*rho*(1.+3.*cu+4.5*cu*cu-1.5*dot(u,u)) - WQ[q];
}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float g[9];
  if(uOpen>0.5 && p.x==0){
    for(int q=0;q<9;q++) g[q] = eqDev(q, 1.0, uInletU);
  } else if(uOpen>0.5 && p.x==uGrid.x-1){
    ivec2 pp = ivec2(uGrid.x-2, p.y);       // zero-gradient: copy neighbor's
    for(int q=0;q<9;q++) g[q] = streamed(pp, q);   // post-stream value
  } else {
    for(int q=0;q<9;q++) g[q] = streamed(p, q);
  }
  o0 = vec4(g[0],g[1],g[2],g[3]);
  o1 = vec4(g[4],g[5],g[6],g[7]);
  o2 = vec4(g[8],0.,0.,0.);
}`;

  // Moments pass: (rho, ux, uy, obst) for display + self-check readback.
  const FS_MOMENTS = GLSL_COMMON + `
uniform sampler2D uF0, uF1, uF2, uObst;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float ob = texelFetch(uObst,p,0).x;
  float rho = 1.0; vec2 m = vec2(0.);
  for(int q=0;q<9;q++){
    float g = g_at(uF0,uF1,uF2,p,q);
    rho += g; m += vec2(float(CX[q]),float(CY[q]))*g;
  }
  vec2 u = (ob>0.5) ? vec2(0.) : m/rho;
  o = vec4(rho, u.x, u.y, ob);
}`;

  // Force pass: per-cell momentum-exchange contributions for bodies 2 and 3
  // (post-stream form: F_link = c_oq * (2 f_new_q + corr), f = g + w).
  const FS_FORCE = GLSL_COMMON + `
uniform sampler2D uF0, uF1, uF2, uObst;
uniform vec2 uWallU[8];
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  if(texelFetch(uObst,p,0).x>0.5){ o=vec4(0.); return; }
  vec2 fA = vec2(0.), fB = vec2(0.);
  for(int q=1;q<9;q++){
    ivec2 nb = wrapc(p - ivec2(CX[q],CY[q]));
    float ob = texelFetch(uObst,nb,0).x;
    if(ob>1.5){                        // bodies 2,3 tracked (1 = walls/road)
      int oq = OPP[q]; int b = int(ob+0.5);
      float corr = 6.*WQ[oq]*(float(CX[oq])*uWallU[b].x+float(CY[oq])*uWallU[b].y);
      float fq = g_at(uF0,uF1,uF2,p,q) + WQ[q];
      vec2 c = vec2(float(CX[oq]),float(CY[oq]));
      vec2 dF = c*(2.*fq + corr);
      if(b==2) fA += dF; else fB += dF;
    }
  }
  o = vec4(fA, fB);
}`;

  // Display pass: colormap a field derived from the moments texture straight
  // to the canvas — no CPU readback in the render loop at all.
  const FS_DISPLAY = GLSL_COMMON + `
uniform sampler2D uMom;
uniform int uField;            // 0 vorticity, 1 speed, 2 pressure
uniform float uScale;
uniform vec3 uStops[5];
out vec4 o;
vec3 ramp(float t){
  t = clamp(t, 0., 1.) * 4.;
  int i = int(min(t, 3.));
  return mix(uStops[i], uStops[i+1], t - float(i));
}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 m = texelFetch(uMom,p,0);
  if(m.w > 0.5){
    int id = int(m.w+0.5);
    o = vec4(id==2 ? vec3(0.17,0.25,0.35) : id==3 ? vec3(0.35,0.24,0.14)
                   : vec3(0.12,0.13,0.15), 1.);
    return;
  }
  float v;
  if(uField==1){ v = length(m.yz)*uScale; }
  else if(uField==2){ v = (m.x-1.)*uScale + 0.5; }
  else {
    vec4 xm = texelFetch(uMom, wrapc(p+ivec2(-1,0)), 0);
    vec4 xp = texelFetch(uMom, wrapc(p+ivec2( 1,0)), 0);
    vec4 ym = texelFetch(uMom, wrapc(p+ivec2(0,-1)), 0);
    vec4 yp = texelFetch(uMom, wrapc(p+ivec2(0, 1)), 0);
    v = ((xp.z-xm.z) - (yp.y-ym.y)) * 0.5 * uScale + 0.5;
  }
  o = vec4(ramp(v), 1.);
}`;

  // Refill pass: cells that changed solid->fluid get equilibrium populations
  // (the documented "pressure pop" alternative to leaving stale garbage).
  const FS_REFILL = GLSL_COMMON + `
uniform sampler2D uF0, uF1, uF2, uObst, uObstPrev;
uniform vec2 uInletU;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uF0,p,0), b = texelFetch(uF1,p,0);
  float g8 = texelFetch(uF2,p,0).x;
  bool wasSolid = texelFetch(uObstPrev,p,0).x > 0.5;
  bool nowFluid = texelFetch(uObst,p,0).x < 0.5;
  if(wasSolid && nowFluid){
    float us = dot(uInletU,uInletU);
    float g[9];
    for(int q=0;q<9;q++){
      float cu = float(CX[q])*uInletU.x + float(CY[q])*uInletU.y;
      g[q] = WQ[q]*(1.+3.*cu+4.5*cu*cu-1.5*us) - WQ[q];
    }
    o0 = vec4(g[0],g[1],g[2],g[3]);
    o1 = vec4(g[4],g[5],g[6],g[7]);
    o2 = vec4(g[8],0.,0.,0.);
  } else { o0=a; o1=b; o2=vec4(g8,0.,0.,0.); }
}`;

  function compile(gl, vsrc, fsrc) {
    const p = gl.createProgram();
    for (const [t, s] of [[gl.VERTEX_SHADER, vsrc], [gl.FRAGMENT_SHADER, fsrc]]) {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error("shader: " + gl.getShaderInfoLog(sh));
      }
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("link: " + gl.getProgramInfoLog(p));
    }
    return p;
  }

  class GpuEngine {
    constructor(nx, ny, opts = {}) {
      this.nx = nx; this.ny = ny; this.n = nx * ny;
      this.tau = opts.tau ?? 0.6;
      this.u0 = opts.u0 ?? 0;
      this.uPerturb = 0;
      this.gx = opts.gx ?? 0; this.gy = opts.gy ?? 0;
      this.open = !!opts.open;
      this.steps = 0;
      const canvas = opts.canvas ?? (typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(nx, ny) : document.createElement("canvas"));
      const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
      if (!gl) throw new Error("no-webgl2");
      if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("no-fp32");
      this.gl = gl;
      this.progCollide = compile(gl, VS, FS_COLLIDE);
      this.progStream = compile(gl, VS, FS_STREAM);
      this.progMoments = compile(gl, VS, FS_MOMENTS);
      this.progForce = compile(gl, VS, FS_FORCE);
      this.progDisplay = compile(gl, VS, FS_DISPLAY);
      this.progRefill = compile(gl, VS, FS_REFILL);
      this.canvas = canvas;
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.texF = [0, 1].map(() => [0, 1, 2].map(() => this._makeTex(gl.RGBA32F)));
      this.cur = 0;
      this.texObst = this._makeTex(gl.R32F);
      this.texObstPrev = this._makeTex(gl.R32F);
      this.texMoments = this._makeTex(gl.RGBA32F);
      this.texForce = this._makeTex(gl.RGBA32F);
      this.fboF = [0, 1].map(i => this._makeFbo(this.texF[i], true));
      this.fboMoments = this._makeFbo([this.texMoments]);
      this.fboForce = this._makeFbo([this.texForce]);
      this.obst = new Uint8Array(this.n);
      this.wallU = new Float32Array(16);
      this._mBuf = new Float32Array(this.n * 4);
      this._fBuf = new Float32Array(this.n * 4);
      this.forces = [];
      for (let b = 0; b < 8; b++) this.forces.push({ fx: 0, fy: 0 });
      this._uploadObstacle();
      this.initEquilibrium(1, 0, 0);
    }

    _makeTex(ifmt) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, this.nx, this.ny);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    _makeFbo(texs, mrt = false) {
      const gl = this.gl;
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      texs.forEach((t, i) => gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
      if (mrt) {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1,
        gl.COLOR_ATTACHMENT2]);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("fbo-incomplete");
      }
      return fbo;
    }

    setObstacle(fn) {
      let x0 = this.nx, x1 = 0, y0 = this.ny, y1 = 0;
      for (let i = 0; i < this.n; i++) {
        const x = i % this.nx, y = (i / this.nx) | 0;
        const v = fn(x, y) | 0;
        this.obst[i] = v;
        if (v >= 2) {           // tracked bodies: bbox for cheap force readback
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      this.bbox = (x1 >= x0)
        ? [Math.max(0, x0 - 2), Math.max(0, y0 - 2),
        Math.min(this.nx - 1, x1 + 2), Math.min(this.ny - 1, y1 + 2)]
        : null;
      // stash previous obstacle field, upload new, refill uncovered cells
      const gl = this.gl;
      if (this.steps > 0) {
        const prev = new Float32Array(this.n);
        for (let i = 0; i < this.n; i++) prev[i] = this._prevObst ? this._prevObst[i] : 0;
        gl.bindTexture(gl.TEXTURE_2D, this.texObstPrev);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny,
          gl.RED, gl.FLOAT, prev);
      }
      this._uploadObstacle();
      if (this.steps > 0) this._refill();
      this._prevObst = this.obst.slice();
    }

    _refill() {
      const gl = this.gl;
      gl.viewport(0, 0, this.nx, this.ny);
      gl.bindVertexArray(this.vao);
      const dst = 1 - this.cur;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboF[dst]);
      const pr = this.progRefill;
      this._bindCommon(pr, this.texF[this.cur]);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.texObstPrev);
      gl.uniform1i(gl.getUniformLocation(pr, "uObstPrev"), 4);
      gl.uniform2f(gl.getUniformLocation(pr, "uInletU"), this.u0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = dst;
    }

    _uploadObstacle() {
      const gl = this.gl;
      const data = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) data[i] = this.obst[i];
      gl.bindTexture(gl.TEXTURE_2D, this.texObst);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny,
        gl.RED, gl.FLOAT, data);
    }

    setWallVelocity(body, ux, uy) {
      this.wallU[2 * body] = ux; this.wallU[2 * body + 1] = uy;
    }

    initEquilibrium(rho0, ux0, uy0) {
      const gl = this.gl;
      const planes = [0, 1, 2].map(() => new Float32Array(this.n * 4));
      for (let i = 0; i < this.n; i++) {
        const x = i % this.nx, y = (i / this.nx) | 0;
        const solid = this.obst[i] > 0;
        const ux = solid ? 0 : (typeof ux0 === "function" ? ux0(x, y) : ux0);
        const uy = solid ? 0 : (typeof uy0 === "function" ? uy0(x, y) : uy0);
        const r = typeof rho0 === "function" ? rho0(x, y) : rho0;
        const us = ux * ux + uy * uy;
        for (let q = 0; q < 9; q++) {
          const cu = CX[q] * ux + CY[q] * uy;
          const g = W[q] * r * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * us) - W[q];
          if (q < 4) planes[0][i * 4 + q] = g;
          else if (q < 8) planes[1][i * 4 + q - 4] = g;
          else planes[2][i * 4] = g;
        }
      }
      for (const set of this.texF) {
        for (let k = 0; k < 3; k++) {
          gl.bindTexture(gl.TEXTURE_2D, set[k]);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny,
            gl.RGBA, gl.FLOAT, planes[k]);
        }
      }
      this.steps = 0;
    }

    _bindCommon(prog, srcSet) {
      const gl = this.gl;
      gl.useProgram(prog);
      gl.uniform2i(gl.getUniformLocation(prog, "uGrid"), this.nx, this.ny);
      const names = ["uF0", "uF1", "uF2"];
      srcSet.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(gl.getUniformLocation(prog, names[i]), i);
      });
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.texObst);
      gl.uniform1i(gl.getUniformLocation(prog, "uObst"), 3);
    }

    step(nSteps = 1) {
      const gl = this.gl;
      gl.viewport(0, 0, this.nx, this.ny);
      gl.bindVertexArray(this.vao);
      for (let s = 0; s < nSteps; s++) {
        // A: collide  cur -> other
        let src = this.texF[this.cur], dst = 1 - this.cur;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboF[dst]);
        this._bindCommon(this.progCollide, src);
        gl.uniform1f(gl.getUniformLocation(this.progCollide, "uOmega"), 1 / this.tau);
        gl.uniform1f(gl.getUniformLocation(this.progCollide, "uTau"), this.tau);
        gl.uniform2f(gl.getUniformLocation(this.progCollide, "uG"), this.gx, this.gy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.cur = dst;
        // B: stream  cur -> other
        src = this.texF[this.cur]; dst = 1 - this.cur;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboF[dst]);
        this._bindCommon(this.progStream, src);
        gl.uniform2fv(gl.getUniformLocation(this.progStream, "uWallU"), this.wallU);
        gl.uniform1f(gl.getUniformLocation(this.progStream, "uOpen"), this.open ? 1 : 0);
        gl.uniform2f(gl.getUniformLocation(this.progStream, "uInletU"),
          this.u0, this.uPerturb);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.cur = dst;
        this.steps++;
      }
    }

    // run moments pass and read back (rho, ux, uy, obst) per cell
    computeMoments() {
      const gl = this.gl;
      gl.viewport(0, 0, this.nx, this.ny);
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMoments);
      this._bindCommon(this.progMoments, this.texF[this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, this._mBuf);
      if (!this._mViews) {
        this._mViews = {
          rho: new Float32Array(this.n), ux: new Float32Array(this.n),
          uy: new Float32Array(this.n),
        };
      }
      const v = this._mViews, b = this._mBuf;
      for (let i = 0; i < this.n; i++) {
        v.rho[i] = b[4 * i]; v.ux[i] = b[4 * i + 1]; v.uy[i] = b[4 * i + 2];
      }
      return v;
    }

    momentsPass() {   // render moments to texture only (no readback) for display
      const gl = this.gl;
      gl.viewport(0, 0, this.nx, this.ny);
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMoments);
      this._bindCommon(this.progMoments, this.texF[this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return this.texMoments;
    }

    mass() {
      const m = this.computeMoments();
      let s = 0;
      for (let i = 0; i < this.n; i++) s += m.rho[i];
      return s;
    }

    syncForces() {
      const gl = this.gl;
      if (!this.bbox) return this.forces;
      const [bx0, by0, bx1, by1] = this.bbox;
      const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
      gl.viewport(0, 0, this.nx, this.ny);
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboForce);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(bx0, by0, w, h);
      this._bindCommon(this.progForce, this.texF[this.cur]);
      gl.uniform2fv(gl.getUniformLocation(this.progForce, "uWallU"), this.wallU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      const buf = this._fBuf.subarray(0, w * h * 4);
      gl.readPixels(bx0, by0, w, h, gl.RGBA, gl.FLOAT, buf);
      let ax = 0, ay = 0, cx = 0, cy = 0;
      for (let i = 0; i < w * h; i++) {
        ax += buf[4 * i]; ay += buf[4 * i + 1];
        cx += buf[4 * i + 2]; cy += buf[4 * i + 3];
      }
      this.forces[2] = { fx: ax, fy: ay };
      this.forces[3] = { fx: cx, fy: cy };
      return this.forces;
    }

    // GPU display: no readback. cmapStops: 5 [r,g,b] arrays in 0..1.
    drawDisplay(field, cmapStops, scale) {
      const gl = this.gl;
      this.momentsPass();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindVertexArray(this.vao);
      const pr = this.progDisplay;
      gl.useProgram(pr);
      gl.uniform2i(gl.getUniformLocation(pr, "uGrid"), this.nx, this.ny);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texMoments);
      gl.uniform1i(gl.getUniformLocation(pr, "uMom"), 0);
      gl.uniform1i(gl.getUniformLocation(pr, "uField"),
        field === "speed" ? 1 : field === "press" ? 2 : 0);
      gl.uniform1f(gl.getUniformLocation(pr, "uScale"), scale);
      gl.uniform3fv(gl.getUniformLocation(pr, "uStops"),
        new Float32Array(cmapStops.flat()));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    bodyForce(b) { return this.forces[b]; }
  }

  return { GpuEngine };
})();
if (typeof window !== "undefined") window.LBMGPU = LBMGPU;
