/* Farm stats widget — public Adafruit IO read only. No API key is used. */
(function () {
  "use strict";

  var USER = "PuaNow";
  var FEED = "nursery-sump-level";
  var LAST_URL = "https://io.adafruit.com/api/v2/" + USER + "/feeds/" + FEED + "/data/last";
  var CHART_URL = "https://io.adafruit.com/api/v2/" + USER + "/feeds/" + FEED + "/data/chart?hours=24";
  var DATA_URL = "https://io.adafruit.com/api/v2/" + USER + "/feeds/" + FEED + "/data?limit=240";
  var REFRESH_MS = 60000;
  var TZ = "America/Los_Angeles";
  var TIMEOUT_MS = 12000;

  /* Stray 0 test value posted 20:43 PT on Nov 14, 2026. */
  var IGNORE_ZERO_AT = Date.parse("2026-11-15T04:43:35Z");
  var IGNORE_WINDOW_MS = 3 * 60 * 1000;

  var BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

  function $(id) {
    return document.getElementById(id);
  }

  function isIgnored(ts, value) {
    var t = typeof ts === "number" ? ts : Date.parse(ts);
    var v = Number(value);
    if (!isFinite(t) || !isFinite(v)) return false;
    return Math.abs(v) < 1e-9 && Math.abs(t - IGNORE_ZERO_AT) <= IGNORE_WINDOW_MS;
  }

  function statusFor(inches) {
    if (inches < 2) return { key: "below", label: "Below normal", hint: "under 2 in" };
    if (inches <= 4) return { key: "normal", label: "Normal", hint: "target 2\u20134 in" };
    if (inches <= 8) return { key: "above", label: "Above normal", hint: "4\u20138 in" };
    return { key: "alert", label: "ALERT", hint: "over 8 in" };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "unknown";
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).formatToParts(d);
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return map.hour + ":" + map.minute + ":" + map.second + " " + map.dayPeriod + " PT";
  }

  function formatSpan(ms) {
    if (!isFinite(ms) || ms <= 0) return "history";
    var min = Math.round(ms / 60000);
    if (min < 60) return min + "m";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + "h";
    return "24h";
  }

  function promptLine() {
    return (
      '<span class="term-prompt">' +
        '<span class="term-user">paul</span>' +
        '<span class="term-at">@</span>' +
        '<span class="term-host">norcalprawn</span>' +
        '<span class="term-colon">:</span>' +
        '<span class="term-path">~</span>' +
        '<span class="term-dollar">$</span>' +
      "</span> farmstats"
    );
  }

  function cursor() {
    return '<span class="term-cursor" aria-hidden="true"></span>';
  }

  function renderOffline(body, live, reason) {
    body.innerHTML =
      promptLine() + "\n" +
      '<span class="term-dim">connect: nursery-sump-level</span>\n' +
      '<span class="term-off">[offline] feed not public yet</span>\n' +
      '<span class="term-dim">waiting for a public, read-only feed\u2026</span>\n' +
      promptLine() + " " + cursor();
    live.textContent = "Nursery sump level is offline. The live feed is not public yet.";
    var term = body.closest(".term");
    if (term) {
      term.setAttribute("data-status", "offline");
      var title = term.querySelector(".term-title");
      if (title) title.textContent = "farmstats \u2014 offline";
    }
  }

  function renderLoading(body, live) {
    body.innerHTML =
      promptLine() + "\n" +
      '<span class="term-dim">fetching nursery-sump-level\u2026</span>\n' +
      promptLine() + " " + cursor();
    live.textContent = "Loading nursery sump water level.";
  }

  function sparkline(points, cols) {
    cols = cols || 32;
    if (!points.length) return { line: "", label: "history" };
    var t0 = points[0].t;
    var t1 = points[points.length - 1].t;
    var span = Math.max(t1 - t0, 1);
    var buckets = [];
    var i;
    for (i = 0; i < cols; i++) buckets.push([]);
    points.forEach(function (p) {
      var idx = Math.round(((p.t - t0) / span) * (cols - 1));
      if (idx < 0) idx = 0;
      if (idx > cols - 1) idx = cols - 1;
      buckets[idx].push(p.v);
    });
    var avgs = buckets.map(function (b) {
      if (!b.length) return null;
      return b.reduce(function (a, c) { return a + c; }, 0) / b.length;
    });
    var lastAvg = null;
    for (i = 0; i < cols; i++) {
      if (avgs[i] != null) lastAvg = avgs[i];
      else if (lastAvg != null) avgs[i] = lastAvg;
    }
    var firstAvg = null;
    for (i = 0; i < cols; i++) {
      if (avgs[i] != null) { firstAvg = avgs[i]; break; }
    }
    if (firstAvg != null) {
      for (i = 0; i < cols; i++) {
        if (avgs[i] == null) avgs[i] = firstAvg;
        else break;
      }
    }
    var nums = avgs.filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, nums);
    var hi = Math.max.apply(null, nums);
    if (hi - lo < 0.08) {
      var mid = (lo + hi) / 2;
      lo = mid - 0.04;
      hi = mid + 0.04;
    }
    var chars = avgs.map(function (v) {
      if (v == null) return " ";
      var n = (v - lo) / (hi - lo);
      if (n < 0) n = 0;
      if (n > 1) n = 1;
      return BLOCKS[Math.round(n * (BLOCKS.length - 1))];
    }).join("");
    return { line: chars, label: formatSpan(span) };
  }

  function gaugeHtml(inches, statusKey) {
    var cols = 32;
    var max = 8;
    var clamped = Math.max(0, Math.min(inches, max));
    var pos = Math.round((clamped / max) * cols);
    if (inches > 0 && pos < 1) pos = 1;
    if (inches > max) pos = cols;
    var mark2 = Math.round((2 / max) * cols);
    var mark4 = Math.round((4 / max) * cols);
    var fills = [];
    var i;
    for (i = 0; i < cols; i++) {
      var inNormal = i >= mark2 && i < mark4;
      var filled = i < pos;
      var cls = "g-cell" + (inNormal ? " g-normal" : "") + (filled ? " g-fill" : "");
      fills.push('<span class="' + cls + '">' + (filled ? "\u2588" : (inNormal ? "\u2591" : "\u00b7")) + "</span>");
    }
    var overflow = inches > max ? '<span class="term-alert"> \u203a8</span>' : "";
    var scaleChars = [];
    for (i = 0; i < cols; i++) scaleChars[i] = " ";
    scaleChars[0] = "0";
    scaleChars[cols - 1] = "8";
    for (i = mark2; i <= mark4; i++) scaleChars[i] = "=";
    scaleChars[mark2] = "2";
    scaleChars[mark4] = "4";
    var scale =
      "    " +
      '<span class="term-scale">' + scaleChars.slice(0, mark2).join("") + "</span>" +
      '<span class="term-band">' + scaleChars.slice(mark2, mark4 + 1).join("") + "</span>" +
      '<span class="term-scale">' + scaleChars.slice(mark4 + 1).join("") + "</span>";
    var caretPad = Math.max(0, pos - 1);
    var caret =
      "    " +
      new Array(caretPad + 1).join(" ") +
      '<span class="term-caret">^ ' + inches.toFixed(2) + "</span>";
    return (
      scale + "\n" +
      '   <span class="term-track">[' + fills.join("") + "]</span>" + overflow + "\n" +
      caret
    );
  }

  function renderLive(body, live, reading) {
    var st = statusFor(reading.value);
    var spark = sparkline(reading.history, 32);
    var term = body.closest(".term");
    if (term) {
      term.setAttribute("data-status", st.key);
      var title = term.querySelector(".term-title");
      if (title) title.textContent = "farmstats \u2014 " + st.label.toLowerCase();
    }
    body.innerHTML =
      promptLine() + "\n" +
      '<span class="term-k">  tank      </span><span class="term-v">nursery sump</span>\n' +
      '<span class="term-k">  depth     </span><span class="term-depth">' + reading.value.toFixed(2) + " in</span>\n" +
      '<span class="term-k">  status    </span><span class="term-status is-' + st.key + '">' + escapeHtml(st.label.toUpperCase()) + "</span>" +
        '  <span class="term-hint">' + escapeHtml(st.hint) + "</span>\n" +
      '<span class="term-k">  updated   </span><span class="term-v">' + escapeHtml(formatTime(reading.createdAt)) + "</span>\n\n" +
      gaugeHtml(reading.value, st.key) + "\n\n" +
      '<span class="term-sparkrow"><span class="term-k">  ' + padRight(spark.label, 8) + "</span>" +
        '<span class="term-spark">' + (spark.line || "\u2014") + "</span></span>\n" +
      promptLine() + " " + cursor();

    live.textContent =
      "Nursery sump water level is " + reading.value.toFixed(2) +
      " inches, " + st.label + ", last updated " + formatTime(reading.createdAt) + ".";
  }

  function padRight(s, n) {
    s = String(s);
    while (s.length < n) s += " ";
    return s;
  }

  function parseLast(json) {
    if (!json || json.value == null) return null;
    var v = Number(json.value);
    var t = json.created_at || json.createdAt;
    if (!isFinite(v) || !t || isIgnored(t, v)) return null;
    return { value: v, createdAt: t, t: Date.parse(t) };
  }

  function parseHistory(chart, rawList) {
    var pts = [];
    function add(t, v) {
      var ts = Date.parse(t);
      var n = Number(v);
      if (!isFinite(ts) || !isFinite(n) || isIgnored(ts, n)) return;
      pts.push({ t: ts, v: n, createdAt: t });
    }
    if (chart && Array.isArray(chart.data)) {
      chart.data.forEach(function (row) {
        if (row && row.length >= 2) add(row[0], row[1]);
      });
    }
    if (pts.length < 2 && Array.isArray(rawList)) {
      pts = [];
      rawList.forEach(function (row) {
        if (row && row.value != null) add(row.created_at || row.createdAt, row.value);
      });
    }
    pts.sort(function (a, b) { return a.t - b.t; });
    var deduped = [];
    pts.forEach(function (p) {
      var prev = deduped[deduped.length - 1];
      if (!prev || prev.t !== p.t) deduped.push(p);
    });
    return deduped;
  }

  function fetchJson(url, signal) {
    return fetch(url, { method: "GET", mode: "cors", credentials: "omit", signal: signal })
      .then(function (res) {
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          var err = new Error("private");
          err.code = "private";
          err.status = res.status;
          throw err;
        }
        if (!res.ok) {
          var e2 = new Error("http");
          e2.code = "http";
          e2.status = res.status;
          throw e2;
        }
        return res.json();
      });
  }

  function withTimeout(promise, ms, controller) {
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return promise.finally(function () { clearTimeout(timer); });
  }

  function load() {
    var controller = new AbortController();
    var lastP = withTimeout(fetchJson(LAST_URL, controller.signal), TIMEOUT_MS, controller);
    var chartP = withTimeout(fetchJson(CHART_URL, controller.signal), TIMEOUT_MS, controller).catch(function () { return null; });
    var dataP = withTimeout(fetchJson(DATA_URL, controller.signal), TIMEOUT_MS, controller).catch(function () { return null; });
    return Promise.all([lastP, chartP, dataP]).then(function (parts) {
      var last = parseLast(parts[0]);
      var history = parseHistory(parts[1], parts[2]);
      if (!last && history.length) {
        var newest = history[history.length - 1];
        last = { value: newest.v, createdAt: newest.createdAt, t: newest.t };
      }
      if (!last) {
        var err = new Error("empty");
        err.code = "private";
        throw err;
      }
      return { value: last.value, createdAt: last.createdAt, history: history };
    });
  }

  function boot() {
    var body = $("farmstats-body");
    var live = $("farmstats-live");
    if (!body || !live) return;

    var timer = null;

    function tick() {
      load().then(function (reading) {
        renderLive(body, live, reading);
      }).catch(function (err) {
        renderOffline(body, live, (err && err.code) || "offline");
      });
    }

    renderLoading(body, live);
    tick();
    timer = setInterval(tick, REFRESH_MS);

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) tick();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
