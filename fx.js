/* NorCal Premier Prawn — visual effects (vanilla, no dependencies) */
(function () {
  "use strict";
  var doc = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- 1. Hero water shader (WebGL1) ---------- */
  function initWater(canvas) {
    var gl;
    try {
      gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    } catch (e) { gl = null; }
    if (!gl) return;

    var vs = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
    var fs = [
      "#ifdef GL_FRAGMENT_PRECISION_HIGH",
      "precision highp float;",
      "#else",
      "precision mediump float;",
      "#endif",
      "uniform vec2 R;uniform float T;uniform vec2 M;",
      "float h(float n){return fract(sin(n)*43758.5453);}",
      "float caus(vec2 p,float t){vec2 i=p;float c=1.;const float k=.005;",
      " for(int n=0;n<4;n++){float tt=t*(1.-(3.5/float(n+1)));",
      "  i=p+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));",
      "  c+=1./length(vec2(p.x/(sin(i.x+tt)/k),p.y/(cos(i.y+tt)/k)));}",
      " c/=4.;c=1.17-pow(c,1.4);return pow(abs(c),8.);}",
      "void main(){",
      " vec2 uv=gl_FragCoord.xy/R;float a=R.x/R.y;vec2 p=vec2(uv.x*a,uv.y);",
      " vec3 deep=vec3(.059,.078,.063),mid=vec3(.067,.16,.16),top=vec3(.11,.26,.25);",
      " vec3 col=mix(deep,mid,smoothstep(.0,.75,uv.y));col=mix(col,top,smoothstep(.62,1.,uv.y));",
      " vec2 q=p*vec2(1.,1.25)+vec2(0.,T*.012);",
      " float c=caus(q*7.5-250.,T*.28);",
      " float c2=caus(q*4.2-180.,T*.2+3.);",
      " float depth=smoothstep(.05,1.,uv.y);",
      " col+=vec3(.42,.78,.72)*c*.32*depth+vec3(.55,.75,.5)*c2*.12*depth;",
      " float ray=pow(.5+.5*sin(p.x*4.3+uv.y*1.7+sin(p.x*1.7+T*.15)*1.4+T*.12),7.);",
      " col+=vec3(.5,.8,.75)*ray*.07*uv.y*uv.y;",
      " col+=vec3(.35,.6,.55)*.07*exp(-length(p-M)*3.5);",
      " float px=1.6/R.y;",
      " for(int j=0;j<18;j++){float f=float(j);",
      "  float sp=.025+.05*h(f*1.7);float r=.004+.011*h(f*7.7);",
      "  float y=fract(T*sp+h(f*5.3))*1.3-.15;",
      "  float x=h(f*3.1)*a+sin(T*(.6+h(f*2.3))+f)*.018;",
      "  vec2 d=p-vec2(x,y);float l=length(d);",
      "  float disk=smoothstep(r+px,r-px,l);float inner=smoothstep(r-px,r-px*3.,l);",
      "  float hl=smoothstep(r*.45,0.,length(d-vec2(-r*.35,r*.35)));",
      "  float fade=smoothstep(-.12,.25,y)*(1.-smoothstep(.85,1.12,y));",
      "  col+=vec3(.78,.95,.92)*((disk-inner*.85)*.42+hl*.34+disk*.04)*fade;}",
      " col*=1.-.25*pow(abs(uv.x-.5)*1.6,2.);",
      " gl_FragColor=vec4(col,1.);}"
    ].join("\n");

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(s)); }
      return s;
    }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    } catch (e) { return; } /* keep CSS gradient fallback */

    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uR = gl.getUniformLocation(prog, "R"), uT = gl.getUniformLocation(prog, "T"), uM = gl.getUniformLocation(prog, "M");

    var scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
    var mouse = [0.5, 0.75], target = [0.5, 0.75];
    var visible = true, raf = 0, start = performance.now(), last = 0, slow = 0, lost = false;

    function resize() {
      var w = Math.max(1, Math.round(canvas.clientWidth * scale));
      var hh = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    function draw(t) {
      mouse[0] += (target[0] - mouse[0]) * 0.04;
      mouse[1] += (target[1] - mouse[1]) * 0.04;
      gl.uniform2f(uR, canvas.width, canvas.height);
      gl.uniform1f(uT, t);
      gl.uniform2f(uM, mouse[0] * canvas.width / canvas.height, mouse[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function frame(now) {
      raf = 0;
      if (!running()) return;
      var dt = now - last; last = now;
      /* adaptive resolution: drop render scale if frames are slow */
      if (dt > 28 && dt < 200) { if (++slow > 40 && scale > 0.4) { scale *= 0.8; slow = 0; resize(); } } else if (slow > 0) slow--;
      draw((now - start) / 1000);
      raf = requestAnimationFrame(frame);
    }
    function running() { return visible && !document.hidden && !reduce.matches && !lost; }
    function kick() { if (running() && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

    resize();
    draw(reduce.matches ? 14 : 0);
    canvas.parentNode.classList.add("is-live");

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; kick(); }, { threshold: 0 }).observe(canvas);
    }
    document.addEventListener("visibilitychange", kick);
    var onReduce = function () { if (reduce.matches) draw(14); kick(); };
    if (reduce.addEventListener) reduce.addEventListener("change", onReduce);
    var onSize = function () { resize(); if (!running()) draw(reduce.matches ? 14 : (performance.now() - start) / 1000); };
    window.addEventListener("resize", onSize, { passive: true });
    window.addEventListener("orientationchange", function () { setTimeout(onSize, 250); });
    window.addEventListener("load", onSize);
    if ("ResizeObserver" in window) new ResizeObserver(onSize).observe(canvas);
    requestAnimationFrame(onSize);
    canvas.parentNode.parentNode.addEventListener("pointermove", function (e) {
      var r = canvas.getBoundingClientRect();
      target[0] = (e.clientX - r.left) / r.width;
      target[1] = 1 - (e.clientY - r.top) / r.height;
    }, { passive: true });
    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; canvas.parentNode.classList.remove("is-live"); });
    kick();
  }

  var water = document.getElementById("water");
  if (water) initWater(water);

  /* ---------- 2. Scroll reveals ---------- */
  var sel = ".block > .eyebrow, .block > h2, .block > .body, .card, .timeline, .photo-feature, .price-card, .uses, .coin-logo, .facts, .trust";
  var els = document.querySelectorAll(sel);
  var sdt = window.CSS && CSS.supports && CSS.supports("animation-timeline: view()");
  Array.prototype.forEach.call(els, function (el) {
    el.classList.add("reveal");
    if (el.classList.contains("card")) {
      var i = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.style.setProperty("--i", i);
    }
  });
  if (!sdt && "IntersectionObserver" in window && !reduce.matches) {
    doc.classList.add("io-reveal");
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }

  /* ---------- 3. Pointer-tracked glass highlight on cards ---------- */
  document.addEventListener("pointermove", function (e) {
    var c = e.target.closest && e.target.closest(".card, .price-card, .photo-frame");
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty("--mx", (e.clientX - r.left) + "px");
    c.style.setProperty("--my", (e.clientY - r.top) + "px");
  }, { passive: true });

  /* ---------- 4. Pause SVG animations when off-screen ---------- */
  if ("IntersectionObserver" in window) {
    var anim = document.querySelectorAll(".shrimp-mark");
    var po = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("paused", !e.isIntersecting); });
    });
    Array.prototype.forEach.call(anim, function (el) { po.observe(el); });
  }
})();
