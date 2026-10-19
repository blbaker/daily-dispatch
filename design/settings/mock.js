// Mockup behaviour only: theme/frame params, toggles, text size, the picker
// sheet, the connection test and the desktop section index. Plain browser JS
// so the files open straight from disk with no build step. Not app code.
//
// URL params: scheme=light|dark  eink=1  chrome=phone|eink
//             scroll=<px>|end     sheet=<writer|voice|tz|time|host1|licenses>
(function () {
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const eink = q.get("eink") === "1";
  const chrome = q.get("chrome") || "";
  root.dataset.scheme = q.get("scheme") === "dark" ? "dark" : "light";
  if (eink) root.dataset.eink = "";
  if (chrome) {
    root.dataset.chrome = chrome;
    root.style.setProperty("--inset-top", chrome === "eink" ? "24px" : "28px");
    root.style.setProperty("--inset-bottom", chrome === "eink" ? "0px" : "16px");
  }
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const motion = !eink;

  // build label + e-ink lock, per frame type
  const build = $("[data-build]");
  if (build) build.textContent = eink ? "Boox e-ink build 209" : chrome ? "Phone build 209" : "Desktop build 209";
  const einkRow = $('[data-toggle="eink"]');
  if (einkRow && eink) { einkRow.setAttribute("aria-pressed", "true"); einkRow.dataset.locked = "1"; }

  // tab links keep the frame params
  $$("[data-href]").forEach((a) => { a.href = a.dataset.href + location.search.replace(/[&?]scroll=[^&]*/, ""); });

  // local-first save, then sync: the header line shows both steps
  const sync = $("#sync");
  let syncTimer = 0;
  function saved() {
    if (!sync) return;
    sync.innerHTML = '<span class="dot"></span>Saved on this device · syncing';
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      sync.innerHTML = '<span class="dot good"></span>Saved · synced with your server just now';
    }, 700);
  }

  // toggles; a parent toggle dims the rows it controls
  function applyParent(name, on) {
    const kids = $(`[data-parent="${name}"]`);
    if (kids) kids.setAttribute("aria-disabled", on ? "false" : "true");
  }
  $$("[data-toggle]").forEach((b) => {
    applyParent(b.dataset.toggle, b.getAttribute("aria-pressed") === "true");
    b.addEventListener("click", () => {
      if (b.dataset.locked) return;
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      applyParent(b.dataset.toggle, on);
      saved();
    });
  });
  $$(".toggle.child").forEach((b) => b.addEventListener("click", () => {
    b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    saved();
  }));

  // text size atoms drive the preview row
  $$(".atom").forEach((a) => a.addEventListener("click", () => {
    $$(".atom").forEach((x) => x.setAttribute("aria-checked", String(x === a)));
    $("#size-name").textContent = a.dataset.name;
    $("#preview").style.setProperty("--s", a.dataset.size);
    saved();
  }));

  // picker sheet
  const PAID = "Paid · uses the key on your server";
  const OPTIONS = {
    writer: ["Script writer", [
      ["Command", "Runs a CLI you choose, such as claude -p. The default"],
      ["Anthropic", "Claude through the API · paid"],
      ["OpenAI", "GPT through the API · paid"],
      ["Ollama", "A model on your own machine · free"]]],
    voice: ["Voice provider", [
      ["ElevenLabs", "Text to Dialogue, both hosts in one pass · paid"],
      ["OpenAI", "Text to speech, one host at a time · paid"],
      ["Google Gemini", "Multi-speaker text to speech · paid"],
      ["Amazon Polly", "Neural voices · paid"],
      ["Azure AI Speech", "Neural voices · paid"],
      ["Local server", "Any OpenAI-compatible TTS, such as Kokoro · free"]]],
    time: ["Episode time", ["5:00 AM", "5:30 AM", "6:00 AM", "6:30 AM", "7:00 AM", "7:30 AM"].map((t) => [t, ""])],
    tz: ["Time zone", ["America/New_York", "America/Chicago", "America/Denver",
      "America/Los_Angeles", "Europe/London", "UTC"].map((t) => [t, ""])],
    host1: ["Host 1 voice", ["Aria", "Roger", "Sarah", "George"].map((v) => [v, "ElevenLabs premade voice"])],
    host2: ["Host 2 voice", ["Aria", "Roger", "Sarah", "George"].map((v) => [v, "ElevenLabs premade voice"])],
    licenses: ["Open-source licenses", [["Daily Dispatch", "MIT"], ["React Native", "MIT"],
      ["Expo", "MIT"], ["Roboto typeface", "SIL Open Font License 1.1"]]],
  };
  const sheet = $("#sheet"), scrim = $("#scrim");
  function current(key) {
    const btn = $(`[data-sheet="${key}"]`);
    if (!btn) return "";
    const t = btn.querySelector(".time");
    if (t) return t.textContent.replace(/(AM|PM)$/, " $1");
    const v = btn.querySelector(".value");
    return v ? v.textContent : "";
  }
  function choose(key, label, sub) {
    const btn = $(`[data-sheet="${key}"]`);
    const t = btn.querySelector(".time");
    if (t) {
      const [hm, ap] = label.split(" ");
      t.innerHTML = `${hm}<span class="ampm">${ap}</span>`;
    } else {
      btn.querySelector(".value").textContent = label;
    }
    if (key === "voice") $('[data-sub="voice"]').textContent = sub.endsWith("free") ? "Free · runs on your network" : PAID;
    saved();
  }
  function openSheet(key) {
    const spec = OPTIONS[key];
    if (!spec || !sheet) return;
    const [title, opts] = spec;
    const pick = key !== "licenses";
    $("#sheet-title").textContent = title;
    const list = $("#sheet-list");
    list.innerHTML = "";
    const cur = current(key);
    opts.forEach(([label, sub]) => {
      const el = document.createElement(pick ? "button" : "div");
      el.className = "row";
      if (pick) { el.setAttribute("role", "radio"); el.setAttribute("aria-checked", String(label === cur)); }
      el.innerHTML = `<span class="row-main"><span class="row-label">${label}</span>` +
        (sub ? `<span class="row-sub">${sub}</span>` : "") + "</span>" + (pick ? '<span class="ring"></span>' : "");
      if (pick) el.addEventListener("click", () => { choose(key, label, sub); closeSheet(); });
      list.appendChild(el);
    });
    sheet.hidden = false;
    scrim.hidden = false;
  }
  function closeSheet() { if (sheet) { sheet.hidden = true; scrim.hidden = true; } }
  $$("[data-sheet]").forEach((b) => b.addEventListener("click", () => openSheet(b.dataset.sheet)));
  if (scrim) scrim.addEventListener("click", closeSheet);
  const done = $('[data-act="close"]');
  if (done) done.addEventListener("click", closeSheet);

  // API key reveal
  const reveal = $('[data-act="reveal"]');
  if (reveal) reveal.addEventListener("click", () => {
    const k = $("#key");
    const show = k.type === "password";
    k.type = show ? "text" : "password";
    reveal.textContent = show ? "Hide" : "Show";
  });

  // connection test against /health
  const test = $("#test");
  const testBtn = $('[data-act="test"]');
  if (testBtn) testBtn.addEventListener("click", () => {
    test.dataset.state = "testing";
    $("#test-label").textContent = "Testing";
    $("#test-detail").textContent = "Calling /health";
    setTimeout(() => {
      test.dataset.state = "ok";
      $("#test-label").textContent = "Connected";
      $("#test-detail").textContent = "/health answered in 138 ms";
    }, 1100);
  });

  // update check
  const upd = $('[data-act="update"]');
  if (upd) upd.addEventListener("click", () => {
    $("#upd").textContent = "Checking for a newer build";
    setTimeout(() => { $("#upd").textContent = "You're on the latest version · checked just now"; }, 900);
  });

  // desktop section index follows the scroll position
  const jump = $$(".jump a");
  function spy() {
    if (!jump.length) return;
    const secs = $$(".sec");
    const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    let idx = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= 140) idx = i; });
    if (atEnd) idx = secs.length - 1;
    jump.forEach((a, i) => a.classList.toggle("on", i === idx));
  }
  jump.forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    $(a.getAttribute("href")).scrollIntoView({ behavior: motion ? "smooth" : "auto" });
  }));
  addEventListener("scroll", spy, { passive: true });

  // frame setup for the capture script: scroll, open a sheet, report metrics
  document.fonts.ready.then(() => {
    const s = q.get("scroll");
    if (s) scrollTo(0, s === "end" ? document.documentElement.scrollHeight : Number(s));
    if (q.get("sheet")) openSheet(q.get("sheet"));
    spy();
    const de = document.documentElement;
    window.__metrics = {
      width: innerWidth, height: innerHeight, scrollHeight: de.scrollHeight,
      scrollWidth: de.scrollWidth, scrollY: scrollY,
      font: document.fonts.check("700 16px Roboto"), title: document.title,
    };
    root.dataset.ready = "1";
  });
})();
