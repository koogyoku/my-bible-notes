/* 圣经 · 读经笔记 — SPA */
(function () {
  "use strict";
  var app = document.getElementById("app");
  var crumb = document.getElementById("crumb");
  var BOOKS = null;          // books.json
  var BOOKMAP = {};
  var bookCache = {};        // id -> book json
  var notesCache = {};       // id -> notes json (or null)
  var searchIndex = null;    // lazy

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // tiny markdown: paragraphs, blockquote(> ), bold(**)
  function md(src) {
    var html = "";
    var paras = String(src).split(/\n\s*\n/);
    paras.forEach(function (p) {
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
  function inlineMd(s) {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function getJSON(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function bookById(id) { return BOOKMAP[id]; }

  /* ---------- poetry: split verse at ，；：。 ---------- */
  function poetryLines(text) {
    var parts = text.split(/([，；：。])/);
    var lines = [];
    for (var i = 0; i < parts.length; i += 2) {
      var seg = (parts[i] || "") + (parts[i + 1] || "");
      if (seg) lines.push(seg);
    }
    return lines.length ? lines : [text];
  }

  function renderVerseHTML(bid, ch, vnum, text, poetic, noteHTML, noteRef) {
    var id = bid + "-" + ch + "-" + vnum;
    var cls = "verse" + (poetic ? " poetry" : "");
    var body;
    if (poetic) {
      var lines = poetryLines(text);
      body = lines.map(function (ln, i) {
        return '<span class="pline' + (i ? " cont" : "") + '">' + esc(ln) + "</span>";
      }).join("");
    } else {
      body = esc(text);
    }
    var toggle = noteHTML ? '<button class="note-toggle" data-v="' + vnum + '">注</button>' : "";
    var note = noteHTML
      ? '<div class="note" id="note-' + id + '"><span class="note-ref">' + esc(noteRef) + "</span>" + noteHTML + "</div>"
      : "";
    return '<p class="' + cls + '" id="' + id + '"><span class="vnum">' + vnum + "</span>" +
      body + toggle + "</p>" + note;
  }

  function noteFor(notes, ch, v) {
    if (!notes) return null;
    var exact = notes[ch + ":" + v];
    if (exact) return { ref: "注 · " + v + "节", html: md(exact) };
    for (var k in notes) {
      var m = /^(\d+):(\d+)-(\d+)$/.exec(k);
      if (m && +m[1] === ch && v >= +m[2] && v <= +m[3]) {
        return { ref: "注 · " + m[2] + "-" + m[3] + "节", html: md(notes[k]) };
      }
    }
    return null;
  }

  /* ---------- views ---------- */
  function vHome() {
    crumb.innerHTML = "";
    var ot = BOOKS.filter(function (b) { return b.testament === "ot"; });
    var nt = BOOKS.filter(function (b) { return b.testament === "nt"; });
    function grid(list) {
      return '<div class="book-grid">' + list.map(function (b) {
        return '<a href="#/book/' + b.id + '">' + esc(b.name) + "</a>";
      }).join("") + "</div>";
    }
    app.innerHTML =
      '<div class="testament"><h2>旧约</h2>' + grid(ot) + "</div>" +
      '<div class="testament"><h2>新约</h2>' + grid(nt) + "</div>";
  }

  function vBook(bid) {
    var b = bookById(bid);
    if (!b) return vNotFound();
    crumb.innerHTML = '<a href="#/">全部书卷</a> / ' + esc(b.name);
    var cells = [];
    for (var c = 1; c <= b.chapters; c++) {
      cells.push('<a href="#/read/' + bid + "/" + c + '">' + c + "</a>");
    }
    app.innerHTML = "<h1 class='chapter-title'>" + esc(b.name) + "</h1>" +
      '<p class="chapter-sub">共 ' + b.chapters + " 章 · 点击进入章节</p>" +
      '<div class="chapter-grid">' + cells.join("") + "</div>";
  }

  function vRead(bid, ch, vfocus) {
    var b = bookById(bid);
    ch = parseInt(ch, 10);
    if (!b || !ch || ch < 1 || ch > b.chapters) return vNotFound();
    crumb.innerHTML = '<a href="#/">全部书卷</a> / <a href="#/book/' + bid + '">' +
      esc(b.name) + "</a> / 第" + ch + "章";
    app.innerHTML = '<p class="loading">加载' + esc(b.name) + "第" + ch + "章…</p>";
    var bp = bookCache[bid] ? Promise.resolve(bookCache[bid])
      : getJSON("data/cuv/" + bid + ".json").then(function (j) { bookCache[bid] = j; return j; });
    var np = (bid in notesCache) ? Promise.resolve(notesCache[bid])
      : getJSON("notes/" + bid + ".json").then(function (j) { notesCache[bid] = j; return j; })
        .catch(function () { notesCache[bid] = null; return null; });
    Promise.all([bp, np]).then(function (res) {
      var book = res[0], notes = res[1];
      var verses = book.chapters[ch - 1];
      var html = "<h1 class='chapter-title'>" + esc(b.name) + " 第" + ch + "章</h1>" +
        '<p class="chapter-sub">和合本 · 简体</p>';
      if (notes && notes[ch + ":0"]) {
        html += '<div class="chapter-note"><h4>本章笔记</h4>' + md(notes[ch + ":0"]) + "</div>";
      }
      verses.forEach(function (t, i) {
        var v = i + 1;
        var n = noteFor(notes, ch, v);
        html += renderVerseHTML(bid, ch, v, t, b.poetic,
          n ? n.html : null, n ? (b.name + " " + ch + ":" + n.ref.replace("注 · ", "")) : null);
      });
      var prev = ch > 1 ? '<a href="#/read/' + bid + "/" + (ch - 1) + '">← 上一章</a>' : '<a class="disabled">← 上一章</a>';
      var next = ch < b.chapters ? '<a href="#/read/' + bid + "/" + (ch + 1) + '">下一章 →</a>' : '<a class="disabled">下一章 →</a>';
      html += '<div class="pagenav">' + prev + next + "</div>";
      app.innerHTML = html;
      // note toggles
      app.querySelectorAll(".note-toggle").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = "note-" + bid + "-" + ch + "-" + btn.getAttribute("data-v");
          var el = document.getElementById(id);
          if (el) el.classList.toggle("open");
        });
      });
      if (vfocus) {
        var target = document.getElementById(bid + "-" + ch + "-" + vfocus);
        if (target) target.scrollIntoView();
      } else {
        window.scrollTo(0, 0);
      }
    }).catch(function () {
      app.innerHTML = '<p class="loading">加载失败，请重试。</p>';
    });
  }

  function vSearch(q) {
    crumb.innerHTML = '<a href="#/">全部书卷</a> / 搜索';
    q = (q || "").trim();
    if (!q) { app.innerHTML = '<p class="loading">请输入关键词搜索。</p>'; return; }
    app.innerHTML = '<p class="loading">搜索中…</p>';
    function run() {
      var hits = [];
      for (var i = 0; i < searchIndex.length && hits.length < 50; i++) {
        var row = searchIndex[i];
        if (row[3].indexOf(q) !== -1) hits.push(row);
      }
      var html = '<p class="search-meta">找到 ' + hits.length +
        (hits.length >= 50 ? "+" : "") + ' 处含“" + esc(q) + "”的经文</p>';
      hits.forEach(function (r) {
        var b = bookById(r[0]);
        var ref = b ? b.name + " " + r[1] + ":" + r[2] : r[0] + " " + r[1] + ":" + r[2];
        var snip = esc(r[3]);
        var idx = r[3].indexOf(q);
        var start = Math.max(0, idx - 12), end = Math.min(r[3].length, idx + q.length + 24);
        var marked = esc(r[3].slice(0, start)) + "<mark>" + esc(r[3].slice(idx, idx + q.length)) +
          "</mark>" + esc(r[3].slice(idx + q.length, end));
        if (start > 0) marked = "…" + marked;
        if (end < r[3].length) marked += "…";
        html += '<div class="result"><a href="#/read/' + r[0] + "/" + r[1] + "/" + r[2] + '">' +
          '<div class="ref">' + esc(ref) + '</div><div class="snippet">' + marked + "</div></a></div>";
      });
      app.innerHTML = html || '<p class="loading">没有找到。</p>';
      window.scrollTo(0, 0);
    }
    if (searchIndex) { run(); return; }
    var parts = ["search_a", "search_b", "search_c", "search_d"];
    Promise.all(parts.map(function (p) { return getJSON("data/" + p + ".json"); }))
      .then(function (chunks) {
        searchIndex = [];
        chunks.forEach(function (c) { searchIndex = searchIndex.concat(c); });
        run();
      })
      .catch(function () { app.innerHTML = '<p class="loading">搜索数据加载失败。</p>'; });
  }

  function vNotFound() {
    crumb.innerHTML = "";
    app.innerHTML = '<p class="loading">没有找到。<a href="#/">回首页</a></p>';
  }

  /* ---------- router ---------- */
  function route() {
    var h = location.hash || "#/";
    var m;
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

  getJSON("data/books.json").then(function (j) {
    BOOKS = j;
    j.forEach(function (b) { BOOKMAP[b.id] = b; });
    route();
  }).catch(function () {
    app.innerHTML = '<p class="loading">数据加载失败，请检查网络后刷新。</p>';
  });
})();
