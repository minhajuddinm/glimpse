/** Static companion page. It holds no data: it reads the access token from its own URL and opens /events. */
export const COMPANION_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0b12" />
<meta name="referrer" content="no-referrer" />
<title>Glimpse</title>
<link rel="icon" href="/logo.png" />
<link rel="stylesheet" href="/app.css" />
</head>
<body>
<header>
  <img src="/logo.png" alt="" />
  <span class="name">Glimpse</span>
  <span id="status" class="status">connecting…</span>
</header>
<main>
  <section class="answers">
    <h2>Answers</h2>
    <p class="muted" id="answers">Answers will appear here once question detection is switched on.</p>
  </section>
  <section>
    <h2>Live transcript</h2>
    <ol id="transcript"></ol>
    <p id="partial-them" class="partial them"></p>
    <p id="partial-you" class="partial you"></p>
  </section>
</main>
<script src="/app.js"></script>
</body>
</html>`

export const COMPANION_CSS = `:root{color-scheme:dark;--bg:#0b0b12;--panel:#14141f;--line:rgb(255 255 255 / .08);--text:#e7e7f0;--muted:rgb(231 231 240 / .5);--violet:#8b5cf6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
header{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:12px 16px;padding-top:max(12px,env(safe-area-inset-top));background:rgb(11 11 18 / .92);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
header img{width:28px;height:28px;border-radius:7px}
.name{font-weight:600;letter-spacing:.02em}
.status{margin-left:auto;font-size:12px;padding:3px 10px;border-radius:999px;background:rgb(255 255 255 / .08);color:var(--muted)}
.status.live{background:rgb(52 211 153 / .15);color:#6ee7b7}
.status.down{background:rgb(239 68 68 / .15);color:#fca5a5}
main{max-width:720px;margin:0 auto;padding:16px}
section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:14px}
h2{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.muted{color:var(--muted);margin:0}
ol{list-style:none;margin:0;padding:0}
li{padding:6px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
li:last-child{border-bottom:0}
.who{display:inline-block;min-width:44px;margin-right:6px;font-size:12px;font-weight:600;color:var(--muted)}
.them .who{color:#c4b5fd}
.you{text-align:right}
.you .who{color:#6ee7b7}
.partial{margin:6px 0 0;color:var(--muted);font-style:italic;min-height:0}
.partial:empty{display:none}`

export const COMPANION_JS = `(function () {
  var token = new URLSearchParams(location.search).get('t') || ''
  var list = document.getElementById('transcript')
  var status = document.getElementById('status')
  var partialThem = document.getElementById('partial-them')
  var partialYou = document.getElementById('partial-you')
  function setStatus(text, kind) { status.textContent = text; status.className = 'status ' + (kind || '') }
  function line(segment) {
    var li = document.createElement('li')
    li.className = segment.source
    var who = document.createElement('span')
    who.className = 'who'
    who.textContent = segment.source === 'them' ? 'Them' : 'You'
    li.appendChild(who)
    li.appendChild(document.createTextNode(segment.text))
    return li
  }
  function render(snapshot) {
    var nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80
    list.replaceChildren.apply(list, snapshot.segments.slice(-60).map(line))
    partialThem.textContent = snapshot.partials.them ? 'Them: ' + snapshot.partials.them + '…' : ''
    partialYou.textContent = snapshot.partials.you ? 'You: ' + snapshot.partials.you + '…' : ''
    if (nearBottom) window.scrollTo(0, document.body.scrollHeight)
  }
  if (!token) { setStatus('missing access code', 'down'); return }
  var source = new EventSource('/events?t=' + encodeURIComponent(token))
  source.addEventListener('transcript', function (event) { render(JSON.parse(event.data)); setStatus('live', 'live') })
  source.onopen = function () { setStatus('live', 'live') }
  source.onerror = function () { setStatus('reconnecting…', 'down') }
})()`
