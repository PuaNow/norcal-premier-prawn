/* Farm stats widget — public Adafruit IO read only. No API key is used.
 *
 * To add a live reading later: set that stat's status to "live" and
 * fill in feed: { user: "PuaNow", key: "your-feed-key" }. Leave
 * target in place as the normal range. Do not invent values.
 */
(function () {
  "use strict";

  var REFRESH_MS = 60000;
  var TZ = "America/Los_Angeles";
  var TIMEOUT_MS = 12000;

  /* Stray 0 test value posted 20:43 PT on Nov 14, 2026. */
  var IGNORE_ZERO_AT = Date.parse("2026-11-15T04:43:35Z");
  var IGNORE_WINDOW_MS = 3 * 60 * 1000;

  var BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
  var LABEL_W = 11;

  /*
   * Per-stat config. status is "live", "target", or "info".
   * Live rows need a feed and are fetched client-side with no key.
   * Target rows show a published range only — never a fake reading.
   * Ranges: NCRAC FS 124 (2021) Table 1 Ideal, except alkalinity
   * from Virginia Tech AREC-314P (2026) Table 1.
   */
  var STATS = [
    {
      id: "sump",
      label: "depth",
      unit: "in",
      status: "live",
      value: null,
      target: "2\u20135 in",
      feed: { user: "PuaNow", key: "nursery-sump-level" },
      title: "nursery sump water level"
    },
    {
      id: "do",
      label: "DO",
      unit: "mg/L",
      status: "target",
      value: null,
      target: "\u2265 5.0 mg/L",
      feed: null,
      title: "dissolved oxygen"
    },
    {
      id: "temp",
      label: "temp",
      unit: "\u00b0C",
      status: "target",
      value: null,
      target: "28.5 \u00b0C (82\u201384 \u00b0F)",
      feed: null,
      title: "water temperature"
    },
    {
      id: "ph",
      label: "pH",
      unit: "",
      status: "target",
      value: null,
      target: "7.5\u20138.0",
      feed: null,
      title: "pH"
    },
    {
      id: "salinity",
      label: "salinity",
      unit: "ppt",
      status: "target",
      value: null,
      target: "10\u201320 ppt",
      feed: null,
      title: "salinity"
    },
    {
      id: "tan",
      label: "TAN",
      unit: "mg/L",
      status: "target",
      value: null,
      target: "< 0.2 mg/L",
      feed: null,
      title: "total ammonia nitrogen"
    },
    {
      id: "nitrite",
      label: "nitrite",
      unit: "mg/L",
      status: "target",
      value: null,
      target: "< 1.0 mg/L",
      feed: null,
      title: "nitrite"
    },
    {
      id: "alkalinity",
      label: "alkalinity",
      unit: "mg/L",
      status: "target",
      value: null,
      target: "140\u2013180 mg/L CaCO3",
      feed: null,
      title: "alkalinity"
    },
    {
      id: "system",
      label: "system",
      status: "info",
      value: "RAS (recirculating)",
      target: null,
      feed: null,
      title: "system type"
    },
    {
      id: "species",
      label: "species",
      status: "info",
      value: "Pacific whiteleg shrimp",
      detail: "L. vannamei",
      target: null,
      feed: null,
      title: "species"
    }
  ];

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
    if (inches <= 5) return { key: "normal", label: "Normal", hint: "target 2\u20135 in" };
    if (inches <= 8) return { key: "above", label: "Above normal", hint: "5\u20138 in" };
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

  function padRight(s, n) {
    s = String(s);
    while (s.length < n) s += " ";
    return s;
  }

  function feedUrls(feed) {
    var base = "https://io.adafruit.com/api/v2/" +
      encodeURIComponent(feed.user) + "/feeds/" + encodeURIComponent(feed.key);
    return {
      last: base + "/data/last",
      chart: base + "/data/chart?hours=24",
      data: base + "/data?limit=240"
    };
  }

  var printed = false;

  function prefersReduce() {
    return window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function rule() {
    return "========================================";
  }

  function statusWord(key) {
    if (key === "normal") return "NOMINAL";
    if (key === "below") return "BELOW NOMINAL";
    if (key === "above") return "ABOVE NOMINAL";
    if (key === "alert") return "ALERT";
    return "NO DATA";
  }

  function headerHtml(stKey) {
    return (
      '<span class="term-head">NORCAL PREMIER PRAWN // NURSERY SYSTEMS</span>\n' +
      '<span class="term-rule">' + rule() + "</span>\n" +
      '<span class="term-head">INTERFACE READY</span>\n' +
      '<span class="term-statusline is-' + stKey + '">STATUS :: ' +
        statusWord(stKey) + "</span>"
    );
  }

  function setBody(body, html, animate) {
    if (!animate || printed || prefersReduce()) {
      body.innerHTML = html;
      printed = true;
      return;
    }
    printed = true;
    var parts = html.split("\n");
    body.innerHTML = "";
    var i = 0;
    function step() {
      if (i >= parts.length) return;
      body.insertAdjacentHTML("beforeend", (i ? "\n" : "") + parts[i]);
      i += 1;
      setTimeout(step, 28);
    }
    step();
  }

  function kv(label, valueHtml, flagHtml) {
    return (
      '<span class="term-k">  ' + padRight(label, LABEL_W) + "</span>" +
      valueHtml +
      (flagHtml ? flagHtml : "")
    );
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

  function gaugeHtml(inches) {
    var cols = 32;
    var max = 8;
    var clamped = Math.max(0, Math.min(inches, max));
    var pos = Math.round((clamped / max) * cols);
    if (inches > 0 && pos < 1) pos = 1;
    if (inches > max) pos = cols;
    var mark2 = Math.round((2 / max) * cols);
    var mark5 = Math.round((5 / max) * cols);
    var fills = [];
    var i;
    for (i = 0; i < cols; i++) {
      var inNormal = i >= mark2 && i < mark5;
      var filled = i < pos;
      var cls = "g-cell" + (inNormal ? " g-normal" : "") + (filled ? " g-fill" : "");
      fills.push('<span class="' + cls + '">' + (filled ? "\u2588" : (inNormal ? "\u2591" : "\u00b7")) + "</span>");
    }
    var overflow = inches > max ? '<span class="term-alert"> \u203a8</span>' : "";
    var scaleChars = [];
    for (i = 0; i < cols; i++) scaleChars[i] = " ";
    scaleChars[0] = "0";
    scaleChars[cols - 1] = "8";
    for (i = mark2; i <= mark5; i++) scaleChars[i] = "=";
    scaleChars[mark2] = "2";
    scaleChars[mark5] = "5";
    var scale =
      "    " +
      '<span class="term-scale">' + scaleChars.slice(0, mark2).join("") + "</span>" +
      '<span class="term-band">' + scaleChars.slice(mark2, mark5 + 1).join("") + "</span>" +
      '<span class="term-scale">' + scaleChars.slice(mark5 + 1).join("") + "</span>";
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

  function renderTargets() {
    var sawInfo = false;
    var lines = [
      '<span class="term-rule">' + rule() + "</span>",
      '<span class="term-comment">  TARGET PARAMETERS</span>',
      '<span class="term-comment">  SENSORS PENDING</span>',
      ""
    ];
    STATS.forEach(function (stat) {
      if (stat.status === "target") {
        lines.push(
          kv(
            stat.label,
            '<span class="term-flag">target</span>  <span class="term-target">' + escapeHtml(stat.target) + "</span>"
          )
        );
      } else if (stat.status === "info") {
        if (!sawInfo) {
          lines.push("");
          sawInfo = true;
        }
        lines.push(kv(stat.label, '<span class="term-v">' + escapeHtml(stat.value) + "</span>"));
        if (stat.detail) {
          lines.push(
            '<span class="term-k">  ' + padRight("", LABEL_W) + "</span>" +
            '<span class="term-dim">(' + escapeHtml(stat.detail) + ")</span>"
          );
        }
      }
    });
    return lines.join("\n");
  }

  function renderSumpLive(reading) {
    var st = statusFor(reading.value);
    var spark = sparkline(reading.history, 32);
    return (
      '<span class="term-v">  NURSERY SUMP</span>  <span class="term-flag is-live">LIVE</span>\n' +
      kv(
        "depth",
        '<span class="term-depth">' + reading.value.toFixed(2) + " in</span>"
      ) + "\n" +
      kv(
        "status",
        '<span class="term-status is-' + st.key + '">' + escapeHtml(st.label.toUpperCase()) + "</span>",
        '  <span class="term-hint">' + escapeHtml(st.hint) + "</span>"
      ) + "\n" +
      kv("updated", '<span class="term-v">' + escapeHtml(formatTime(reading.createdAt)) + "</span>") + "\n\n" +
      gaugeHtml(reading.value) + "\n\n" +
      '<span class="term-sparkrow"><span class="term-k">  ' + padRight(spark.label, LABEL_W) + "</span>" +
        '<span class="term-spark">' + (spark.line || "\u2014") + "</span></span>"
    );
  }

  function renderSumpOffline() {
    return (
      '<span class="term-v">  NURSERY SUMP</span>\n' +
      '<span class="term-dim">  CHANNEL: NURSERY-SUMP-LEVEL</span>\n' +
      '  <span class="term-off">LINK FAILED // FEED NOT AVAILABLE</span>\n' +
      '<span class="term-dim">  AWAITING PUBLIC READOUT</span>'
    );
  }

  function render(body, live, reading, offline, animate) {
    var stKey = "offline";
    var sr = "Nursery sump level is offline. The live feed is not available.";
    var sumpHtml;
    if (reading && !offline) {
      var st = statusFor(reading.value);
      stKey = st.key;
      sr =
        "Nursery sump water level is " + reading.value.toFixed(2) +
        " inches, " + st.label + ", last updated " + formatTime(reading.createdAt) +
        ". Other water-quality stats are shown as target ranges until live sensors are added.";
      sumpHtml = renderSumpLive(reading);
    } else {
      sumpHtml = renderSumpOffline();
    }

    var term = body.closest(".term");
    if (term) term.setAttribute("data-status", stKey);

    setBody(
      body,
      headerHtml(stKey) + "\n\n" + sumpHtml + "\n\n" + renderTargets(),
      !!animate
    );
    live.textContent = sr;
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

  function loadLive(stat) {
    if (stat.status !== "live" || !stat.feed) {
      return Promise.resolve(null);
    }
    var urls = feedUrls(stat.feed);
    var controller = new AbortController();
    var lastP = withTimeout(fetchJson(urls.last, controller.signal), TIMEOUT_MS, controller);
    var chartP = withTimeout(fetchJson(urls.chart, controller.signal), TIMEOUT_MS, controller).catch(function () { return null; });
    var dataP = withTimeout(fetchJson(urls.data, controller.signal), TIMEOUT_MS, controller).catch(function () { return null; });
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
      stat.value = last.value;
      stat.createdAt = last.createdAt;
      return { value: last.value, createdAt: last.createdAt, history: history };
    });
  }

  function boot() {
    var body = $("farmstats-body");
    var live = $("farmstats-live");
    if (!body || !live) return;

    var sump = STATS.filter(function (s) { return s.id === "sump"; })[0];

    function tick(animate) {
      loadLive(sump).then(function (reading) {
        render(body, live, reading, false, animate);
      }).catch(function () {
        render(body, live, null, true, animate);
      });
    }

    body.innerHTML =
      headerHtml("offline") + "\n\n" +
      '<span class="term-dim">  STANDBY // FETCHING SUMP LEVEL</span>\n\n' +
      renderTargets();
    live.textContent = "Loading nursery sump water level.";
    tick(true);
    setInterval(tick, REFRESH_MS);
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
