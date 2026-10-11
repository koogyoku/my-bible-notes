/* 圣经 · 读经笔记 — SPA
   经文/笔记数据为 gzip+base64 分卷存储，按需加载解压。 */
(function () {
  "use strict";
  var app = document.getElementById("app");
  var crumb = document.getElementById("crumb");
  var BOOKS = null;
  var BOOKMAP = {};
  var bookCache = {};    // id -> chapters array
  var notesCache = {};   // id -> notes obj (or null)
  var searchRows = null; // built on first search

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function md(src) {
    var html = "";
    String(src).split(/\n\s*\n/).forEach(function (p) {
      p = p.trim();
      if (!p) return;
      var lines = p.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length && lines.every(function (l) { return l.charAt(0) === ">"; })) {
        html += "<blockquote>" + lines.map(function (l) {
          return inlineMd(esc(l.replace(/^>\s?/, "")));
        }).join("<br>") + "</blockquote>";
      } else {
        html += "<p>" + lines.map(function (l) { return inlineMd(esc(l)); }).join("<br>") + "</p>";
      }
    });
    return html;
  }
  function inlineMd(s) { return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }

  function b64ToBytes(b64) {
    var bin = atob(b64.replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function gunzipJSON(bytes) {
    var ds = new DecompressionStream("gzip");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return JSON.parse(new TextDecoder().decode(buf));
    });
  }
  function fetchText(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }
  function tidy(s) {
    // drop spaces after CJK punctuation (source-data artifact)
    return String(s).replace(/([，；：。、）”】」])\s+/g, "$1");
  }
  function loadBookBlob(bid) {
    if (bookCache[bid]) return Promise.resolve(bookCache[bid]);
    return fetchText("data/cuvz/" + bid + ".b64").then(b64ToBytes).then(gunzipJSON)
      .then(function (chapters) {
        chapters = chapters.map(function (vs) { return vs.map(tidy); });
        bookCache[bid] = chapters; return chapters;
      });
  }
  function parseNotesMD(text, ch) {
    var notes = {}, cur = null, buf = [];
    text.split(/\r?\n/).forEach(function (line) {
      var m = /^##(?!#)\s*(.+?)\s*$/.exec(line);
      if (m) {
        if (cur) notes[cur] = buf.join("\n").trim();
        cur = (m[1] === "本章") ? (ch + ":0") : m[1];
        buf = [];
      } else if (cur) {
        buf.push(line);
      }
    });
    if (cur) notes[cur] = buf.join("\n").trim();
    return notes;
  }
  function loadChapterNotes(bid, ch) {
    var key = bid + ":" + ch;
    if (key in notesCache) return Promise.resolve(notesCache[key]);
    var path = "notes/" + bid + "-" + String(ch).padStart(3, "0") + ".md";
    return fetchText(path).then(function (t) {
      var n = parseNotesMD(t, ch);
      notesCache[key] = n; return n;
    }).catch(function () { notesCache[key] = null; return null; });
  }

  function bookById(id) { return BOOKMAP[id]; }

  function poetryLines(text) {
    var parts = text.split(/([，；：。])/), lines = [];
    for (var i = 0; i < parts.length; i += 2) {
      var seg = (parts[i] || "") + (parts[i + 1] || "");
      if (seg) lines.push(seg);
    }
    return lines.length ? lines : [text];
  }

  function renderVerseHTML(bid, ch, vnum, text, poetic, noteHTML, noteLabel) {
    var id = bid + "-" + ch + "-" + vnum;
    var cls = "verse" + (poetic ? " poetry" : "");
    var body = poetic
      ? poetryLines(text).map(function (ln, i) {
          return '<span class="pline' + (i ? " cont" : "") + '">' + esc(ln) + "</span>";
        }).join("")
      : esc(text);
    var toggle = noteHTML ? '<button class="note-toggle" data-v="' + vnum + '">注</button>' : "";
    var note = noteHTML
      ? '<div class="note open" id="note-' + id + '"><span class="note-ref">' + esc(noteLabel) + "</span>" + noteHTML + "</div>"
      : "";
    return '<p class="' + cls + '" id="' + id + '"><span class="vnum">' + vnum + "</span>" +
      body + toggle + "</p>" + note;
  }

  function noteFor(notes, bname, ch, v) {
    if (!notes) return null;
    var exact = notes[ch + ":" + v];
    if (exact) return { label: bname + " " + ch + ":" + v, html: md(exact) };
    for (var k in notes) {
      var m = /^(\d+):(\d+)-(\d+)$/.exec(k);
      if (m && +m[1] === ch && v >= +m[2] && v <= +m[3]) {
        return { label: bname + " " + ch + ":" + m[2] + "-" + m[3], html: md(notes[k]) };
      }
    }
    return null;
  }

  /* ---------- views ---------- */
  function vHome() {
    crumb.innerHTML = "";
    function grid(list) {
      return '<div class="book-grid">' + list.map(function (b) {
        return '<a href="#/book/' + b.id + '">' + esc(b.name) + "</a>";
      }).join("") + "</div>";
    }
    app.innerHTML =
      '<div class="testament"><h2>旧约</h2>' + grid(BOOKS.filter(function (b) { return b.testament === "ot"; })) + "</div>" +
      '<div class="testament"><h2>新约</h2>' + grid(BOOKS.filter(function (b) { return b.testament === "nt"; })) + "</div>";
  }

  function vBook(bid) {
    var b = bookById(bid);
    if (!b) return vNotFound();
    crumb.innerHTML = '<a href="#/">全部书卷</a> / ' + esc(b.name);
    var cells = [];
    for (var c = 1; c <= b.chapters; c++) cells.push('<a href="#/read/' + bid + "/" + c + '">' + c + "</a>");
    app.innerHTML = "<h1 class='chapter-title'>" + esc(b.name) + "</h1>" +
      '<p class="chapter-sub">共 ' + b.chapters + " 章 · 点击进入章节</p>" +
      '<div class="chapter-grid">' + cells.join("") + "</div>";
  }

  function vRead(bid, ch, vfocus) {
    var b = bookById(bid);
    ch = parseInt(ch, 10);
    if (!b || !ch || ch < 1 || ch > b.chapters) return vNotFound();
    crumb.innerHTML = '<a href="#/">全部书卷</a> / <a href="#/book/' + bid + '">' + esc(b.name) + "</a> / 第" + ch + "章";
    app.innerHTML = '<p class="loading">加载' + esc(b.name) + "第" + ch + "章…</p>";
    Promise.all([loadBookBlob(bid), loadChapterNotes(bid, ch)]).then(function (res) {
      var chapters = res[0], notes = res[1], verses = chapters[ch - 1];
      var html = "<h1 class='chapter-title'>" + esc(b.name) + " 第" + ch + "章</h1>" +
        '<p class="chapter-sub">和合本 · 简体</p>';
      if (notes && notes[ch + ":0"]) {
        html += '<div class="chapter-note"><h4>本章笔记</h4>' + md(notes[ch + ":0"]) + "</div>";
      }
      verses.forEach(function (t, i) {
        var v = i + 1, n = noteFor(notes, b.name, ch, v);
        html += renderVerseHTML(bid, ch, v, t, b.poetic, n ? n.html : null, n ? n.label : null);
      });
      var prev = ch > 1 ? '<a href="#/read/' + bid + "/" + (ch - 1) + '">← 上一章</a>' : '<a class="disabled">← 上一章</a>';
      var next = ch < b.chapters ? '<a href="#/read/' + bid + "/" + (ch + 1) + '">下一章 →</a>' : '<a class="disabled">下一章 →</a>';
      html += '<div class="pagenav">' + prev + next + "</div>";
      app.innerHTML = html;
      app.querySelectorAll(".note-toggle").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var el = document.getElementById("note-" + bid + "-" + ch + "-" + btn.getAttribute("data-v"));
          if (el) el.classList.toggle("open");
        });
      });
      if (vfocus) {
        var target = document.getElementById(bid + "-" + ch + "-" + vfocus);
        if (target) target.scrollIntoView();
      } else window.scrollTo(0, 0);
    }).catch(function () {
      app.innerHTML = '<p class="loading">加载失败，请重试。</p>';
    });
  }

  function vSearch(q) {
    crumb.innerHTML = '<a href="#/">全部书卷</a> / 搜索';
    q = (q || "").trim();
    if (!q) { app.innerHTML = '<p class="loading">请输入关键词搜索。</p>'; return; }
    app.innerHTML = '<p class="loading">首次搜索需加载全部经文索引，请稍候…</p>';
    function run() {
      var hits = [];
      for (var i = 0; i < searchRows.length && hits.length < 50; i++) {
        if (searchRows[i][3].indexOf(q) !== -1) hits.push(searchRows[i]);
      }
      var html = '<p class="search-meta">找到 ' + hits.length + (hits.length >= 50 ? "+" : "") +
        ' 处含“' + esc(q) + "”的经文</p>";
      hits.forEach(function (r) {
        var b = bookById(r[0]);
        var ref = b ? b.name + " " + r[1] + ":" + r[2] : r[0] + " " + r[1] + ":" + r[2];
        var idx = r[3].indexOf(q);
        var s = Math.max(0, idx - 12), e = Math.min(r[3].length, idx + q.length + 24);
        var snip = (s > 0 ? "…" : "") + esc(r[3].slice(0, s)) + "<mark>" +
          esc(r[3].slice(idx, idx + q.length)) + "</mark>" + esc(r[3].slice(idx + q.length, e)) +
          (e < r[3].length ? "…" : "");
        html += '<div class="result"><a href="#/read/' + r[0] + "/" + r[1] + "/" + r[2] + '">' +
          '<div class="ref">' + esc(ref) + '</div><div class="snippet">' + snip + "</div></a></div>";
      });
      app.innerHTML = html || '<p class="loading">没有找到。</p>';
      window.scrollTo(0, 0);
    }
    if (searchRows) { run(); return; }
    // build index: load all book blobs
    var ids = BOOKS.map(function (b) { return b.id; });
    app.innerHTML = '<p class="loading">正在加载经文数据（' + ids.length + ' 卷）…</p>';
    Promise.all(ids.map(loadBookBlob)).then(function (all) {
      searchRows = [];
      all.forEach(function (chapters, bi) {
        var bid = ids[bi];
        chapters.forEach(function (verses, ci) {
          verses.forEach(function (t, vi) { searchRows.push([bid, ci + 1, vi + 1, t]); });
        });
      });
      run();
    }).catch(function () { app.innerHTML = '<p class="loading">搜索数据加载失败。</p>'; });
  }

  function vNotFound() {
    crumb.innerHTML = "";
    app.innerHTML = '<p class="loading">没有找到。<a href="#/">回首页</a></p>';
  }

  function route() {
    var h = location.hash || "#/", m;
    if ((m = /^#\/book\/([a-z0-9]+)$/.exec(h))) return vBook(m[1]);
    if ((m = /^#\/read\/([a-z0-9]+)\/(\d+)(?:\/(\d+))?$/.exec(h))) return vRead(m[1], m[2], m[3]);
    if ((m = /^#\/search\?(.*)$/.exec(h))) {
      var q = "";
      m[1].split("&").forEach(function (kv) {
        var p = kv.split("=");
        if (p[0] === "q") q = decodeURIComponent(p[1] || "");
      });
      return vSearch(q);
    }
    return vHome();
  }

  document.getElementById("search-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = document.getElementById("search-input").value.trim();
    if (q) location.hash = "#/search?q=" + encodeURIComponent(q);
  });
  window.addEventListener("hashchange", route);

  fetch("data/books.json").then(function (r) {
    if (!r.ok) throw 0;
    return r.json();
  }).then(function (j) {
    BOOKS = j;
    j.forEach(function (b) { BOOKMAP[b.id] = b; });
    route();
  }).catch(function () {
    app.innerHTML = '<p class="loading">数据加载失败，请检查网络后刷新。</p>';
  });
})();
