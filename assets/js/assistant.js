/* =============================================================================
   Safiery store AI assistant - floating chat widget.
   Self-contained: injects its own button, panel and styles, and talks to the
   /.netlify/functions/assistant endpoint. Keeps the conversation in memory only.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__safieryAssistant) return; window.__safieryAssistant = true;

  var BRAND = "#3E78BD";
  var messages = [];   // {role:'user'|'assistant', content:string}
  var busy = false;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  // minimal, safe markdown: links, **bold**, line breaks
  function fmt(s) {
    var t = esc(s);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/(^|[\s(])((https?:\/\/[^\s<]+))/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return t.replace(/\n/g, "<br>");
  }

  function style() {
    var css = ""
      + ".sa-btn{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;align-items:center;gap:8px;border:0;cursor:pointer;"
      + "background:" + BRAND + ";color:#fff;border-radius:999px;padding:13px 18px;font:600 14px/1 system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.18)}"
      + ".sa-btn:hover{filter:brightness(1.05)}.sa-btn svg{width:18px;height:18px}"
      + ".sa-panel{position:fixed;right:20px;bottom:20px;z-index:9999;width:370px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 40px);"
      + "background:#fff;border:1px solid #e6edf4;border-radius:16px;box-shadow:0 18px 50px rgba(20,40,70,.25);display:none;flex-direction:column;overflow:hidden}"
      + ".sa-panel.open{display:flex}"
      + ".sa-head{background:" + BRAND + ";color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}"
      + ".sa-head b{font:600 15px/1.2 system-ui,sans-serif}.sa-head small{opacity:.85;font-size:11.5px}"
      + ".sa-x{background:transparent;border:0;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px}"
      + ".sa-msgs{flex:1;overflow-y:auto;padding:14px;background:#f7fafc;display:flex;flex-direction:column;gap:10px}"
      + ".sa-m{max-width:85%;padding:9px 12px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;white-space:normal;word-wrap:break-word}"
      + ".sa-m a{color:" + BRAND + "}"
      + ".sa-u{align-self:flex-end;background:" + BRAND + ";color:#fff;border-bottom-right-radius:4px}"
      + ".sa-a{align-self:flex-start;background:#fff;color:#1b2a3f;border:1px solid #e6edf4;border-bottom-left-radius:4px}"
      + ".sa-form{display:flex;gap:8px;padding:12px;border-top:1px solid #eef2f6;background:#fff}"
      + ".sa-in{flex:1;border:1px solid #d6dee7;border-radius:10px;padding:10px 12px;font:14px system-ui,sans-serif;resize:none;max-height:90px}"
      + ".sa-send{border:0;background:" + BRAND + ";color:#fff;border-radius:10px;padding:0 16px;cursor:pointer;font:600 14px system-ui}"
      + ".sa-send:disabled{opacity:.5;cursor:default}"
      + ".sa-typing{align-self:flex-start;color:#8c9198;font:13px system-ui;padding:4px 6px}";
    var el = document.createElement("style"); el.textContent = css; document.head.appendChild(el);
  }

  var panel, msgsEl, input, sendBtn;

  function add(role, text) {
    var d = document.createElement("div");
    d.className = "sa-m " + (role === "user" ? "sa-u" : "sa-a");
    d.innerHTML = role === "user" ? esc(text) : fmt(text);
    msgsEl.appendChild(d); msgsEl.scrollTop = msgsEl.scrollHeight;
    return d;
  }

  function send() {
    var text = (input.value || "").trim();
    if (!text || busy) return;
    input.value = ""; input.style.height = "auto";
    add("user", text);
    messages.push({ role: "user", content: text });
    busy = true; sendBtn.disabled = true;
    var typing = document.createElement("div"); typing.className = "sa-typing"; typing.textContent = "Safiery is typing…";
    msgsEl.appendChild(typing); msgsEl.scrollTop = msgsEl.scrollHeight;

    fetch("/.netlify/functions/assistant", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages.slice(-16), page: location.pathname })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        typing.remove();
        var reply = (res.body && res.body.reply) || "Sorry, something went wrong. Please email sales@safiery.com.";
        add("assistant", reply);
        messages.push({ role: "assistant", content: reply });
      })
      .catch(function () { typing.remove(); add("assistant", "Sorry, I'm offline right now. Please email sales@safiery.com."); })
      .then(function () { busy = false; sendBtn.disabled = false; input.focus(); });
  }

  function mount() {
    style();
    var btn = document.createElement("button");
    btn.className = "sa-btn"; btn.type = "button"; btn.setAttribute("aria-label", "Open the Safiery assistant");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg><span>Ask Safiery</span>';
    document.body.appendChild(btn);

    panel = document.createElement("section");
    panel.className = "sa-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Safiery assistant");
    panel.innerHTML =
      '<div class="sa-head"><div><b>Safiery assistant</b><br><small>Product help &amp; quotes</small></div><button class="sa-x" aria-label="Close">&times;</button></div>' +
      '<div class="sa-msgs"></div>' +
      '<form class="sa-form"><textarea class="sa-in" rows="1" placeholder="Ask about a product, system or price…" aria-label="Message"></textarea><button class="sa-send" type="submit">Send</button></form>';
    document.body.appendChild(panel);

    msgsEl = panel.querySelector(".sa-msgs");
    input = panel.querySelector(".sa-in");
    sendBtn = panel.querySelector(".sa-send");

    function open() {
      panel.classList.add("open"); btn.style.display = "none";
      if (!messages.length) add("assistant", "Hi! I can help you pick the right Safiery power, battery, Scotty DC-DC or switching gear - or get a quote. What are you working on?");
      input.focus();
    }
    function close() { panel.classList.remove("open"); btn.style.display = "flex"; }

    btn.addEventListener("click", open);
    panel.querySelector(".sa-x").addEventListener("click", close);
    panel.querySelector(".sa-form").addEventListener("submit", function (e) { e.preventDefault(); send(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(90, input.scrollHeight) + "px"; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
