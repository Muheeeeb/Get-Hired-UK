/* Shared renderer for the public blog / stories / insights pages + post detail.
   Reads published content from our own API — drafts are never exposed. */
(function () {
  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:4000'
    : 'https://api.gethired.world';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }
  function card(p) {
    var href = 'post.html?slug=' + encodeURIComponent(p.slug);
    var thumb = p.coverUrl
      ? '<div class="thumb" style="background-image:url(\'' + encodeURI(p.coverUrl) + '\')"></div>'
      : '<div class="grad"></div>';
    var cat = p.category ? '<div class="cat">' + esc(p.category) + '</div>' : '';
    var summary = p.summary ? '<p>' + esc(p.summary) + '</p>' : '';
    return '<a class="card" href="' + href + '">' + thumb + '<div class="body">' + cat +
      '<h3>' + esc(p.title) + '</h3>' + summary + '<div class="meta">' + fmtDate(p.publishedAt) + '</div></div></a>';
  }

  // ---- listing pages ----
  var listEl = document.getElementById('post-list');
  if (listEl) {
    var type = listEl.getAttribute('data-type');
    fetch(API + '/public/posts?type=' + encodeURIComponent(type) + '&limit=100')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var posts = (d && d.posts) || [];
        listEl.innerHTML = posts.length
          ? posts.map(card).join('')
          : '<div class="empty"><div class="cs">Coming soon</div><div class="css">Fresh content is on the way.</div></div>';
      })
      .catch(function () {
        listEl.innerHTML = '<div class="empty"><div class="cs">Coming soon</div><div class="css">Fresh content is on the way.</div></div>';
      });
  }

  // ---- single post ----
  var artEl = document.getElementById('post-article');
  if (artEl) {
    var slug = new URLSearchParams(location.search).get('slug');
    if (!slug) { artEl.innerHTML = notFound(); return; }
    fetch(API + '/public/posts/' + encodeURIComponent(slug))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        var p = d.post;
        document.title = p.title + ' · Get Hired Global';
        var cover = p.coverUrl ? '<div class="art-cover" style="background-image:url(\'' + encodeURI(p.coverUrl) + '\')"></div>' : '';
        var cat = p.category ? '<div class="art-cat">' + esc(p.category) + '</div>' : '';
        var meta = (p.authorName ? esc(p.authorName) + ' · ' : '') + fmtDate(p.publishedAt);
        // p.body is sanitised server-side before storage, so it is safe to inject.
        artEl.innerHTML =
          '<a class="art-back" href="' + backLink(p.type) + '">&larr; Back</a>' +
          cover + '<div class="art-cat-wrap">' + cat + '<h1>' + esc(p.title) + '</h1>' +
          '<div class="art-meta">' + meta + '</div></div><div class="art-body">' + p.body + '</div>';
      })
      .catch(function () { artEl.innerHTML = notFound(); });
  }

  function backLink(type) {
    return type === 'story' ? 'success-stories.html' : type === 'insight' ? 'insights.html' : 'blog.html';
  }
  function notFound() {
    return '<div class="empty"><div class="cs">Not found</div><div class="css">This post may have been unpublished. <a href="/">Back to home</a></div></div>';
  }
})();
