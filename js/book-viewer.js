(function () {
  var root = document.getElementById("app");
  var pdfUrl = new URL(root.getAttribute("data-pdf"), window.location.href).href;
  var title = root.getAttribute("data-title") || "Book";

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../js/pdfjs/pdf.worker.min.js", window.location.href).href;

  var statusEl = document.createElement("div");
  statusEl.className = "status";
  statusEl.innerHTML = "<p>Loading " + title + "…</p>";
  var top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = "<strong></strong><span></span>";
  var stage = document.createElement("div");
  stage.className = "stage";
  var book = document.createElement("div");
  book.className = "book";
  var leftSheet = sheet();
  var rightSheet = sheet();
  var leaf = document.createElement("div");
  leaf.className = "leaf";
  var front = document.createElement("div");
  front.className = "face front";
  var back = document.createElement("div");
  back.className = "face back";
  leaf.appendChild(front);
  leaf.appendChild(back);
  book.appendChild(leftSheet);
  book.appendChild(rightSheet);
  book.appendChild(leaf);
  stage.appendChild(book);
  var prevBtn = button("prev", "‹", "Previous page");
  var nextBtn = button("next", "›", "Next page");
  root.appendChild(statusEl);
  root.appendChild(top);
  root.appendChild(stage);
  root.appendChild(prevBtn);
  root.appendChild(nextBtn);

  var pdfDoc = null;
  var pageCount = 0;
  var view = 0;
  var anchor = 1;
  var busy = false;
  var cache = new Map();
  var portraitQuery = window.matchMedia("(max-width: 800px)");

  function sheet() {
    var el = document.createElement("div");
    el.className = "sheet";
    return el;
  }

  function button(kind, label, name) {
    var el = document.createElement("button");
    el.className = "nav " + kind;
    el.type = "button";
    el.textContent = label;
    el.setAttribute("aria-label", name);
    return el;
  }

  function portrait() {
    return portraitQuery.matches;
  }

  function maxView() {
    if (portrait()) return Math.max(0, pageCount - 1);
    return Math.max(0, Math.ceil((pageCount - 1) / 2));
  }

  function pagesFor(index) {
    if (portrait()) {
      var page = index + 1;
      return { left: null, right: page <= pageCount ? page : null, single: true };
    }
    if (index <= 0) return { left: null, right: pageCount ? 1 : null, single: false };
    var left = index * 2;
    var right = left + 1;
    return {
      left: left <= pageCount ? left : null,
      right: right <= pageCount ? right : null,
      single: false
    };
  }

  function layout() {
    var single = portrait();
    var maxH = window.innerHeight - (single ? 86 : 96);
    var maxW = single ? window.innerWidth - 16 : (window.innerWidth - 112) / 2;
    var aspect = 432 / 648;
    var height = maxH;
    var width = height * aspect;
    if (width > maxW) {
      width = maxW;
      height = width / aspect;
    }
    book.style.setProperty("--page-w", Math.floor(width) + "px");
    book.style.setProperty("--page-h", Math.floor(height) + "px");
    book.classList.toggle("single", single);
    leftSheet.hidden = single;
  }

  function setStatus(text) {
    statusEl.hidden = !text;
    if (text) statusEl.querySelector("p").textContent = text;
  }

  function labelFor(pages) {
    var nums = [pages.left, pages.right].filter(Boolean);
    if (!nums.length) return "";
    var shown = nums.length === 2 ? nums[0] + "–" + nums[1] : String(nums[0]);
    return shown + " / " + pageCount;
  }

  function updateChrome() {
    var pages = pagesFor(view);
    top.querySelector("strong").textContent = title;
    top.querySelector("span").textContent = labelFor(pages);
    prevBtn.disabled = view <= 0 || busy;
    nextBtn.disabled = view >= maxView() || busy;
  }

  function renderPage(num) {
    if (cache.has(num)) return Promise.resolve(cache.get(num));
    return pdfDoc.getPage(num).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: 1100 / base.width });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      return page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport: viewport
      }).promise.then(function () {
        cache.set(num, canvas);
        trimCache();
        return canvas;
      });
    });
  }

  function trimCache() {
    var keep = new Set();
    for (var i = view - 2; i <= view + 2; i++) {
      var pages = pagesFor(Math.max(0, i));
      if (pages.left) keep.add(pages.left);
      if (pages.right) keep.add(pages.right);
    }
    cache.forEach(function (canvas, num) {
      if (!keep.has(num) && !canvas.isConnected) cache.delete(num);
    });
  }

  function place(slot, canvas) {
    slot.replaceChildren();
    if (canvas) slot.appendChild(canvas);
  }

  function cloneCanvas(canvas) {
    if (!canvas) return null;
    var copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);
    return copy;
  }

  function show(index) {
    view = index;
    var pages = pagesFor(view);
    var jobs = [];
    if (pages.left) jobs.push(renderPage(pages.left));
    if (pages.right) jobs.push(renderPage(pages.right));
    return Promise.all(jobs).then(function () {
      anchor = pages.right || pages.left || 1;
      place(leftSheet, pages.left ? cache.get(pages.left) : null);
      place(rightSheet, pages.right ? cache.get(pages.right) : null);
      updateChrome();
      prefetch();
    });
  }

  function prefetch() {
    var ahead = pagesFor(Math.min(maxView(), view + 1));
    var behind = pagesFor(Math.max(0, view - 1));
    [ahead.left, ahead.right, behind.left, behind.right].forEach(function (num) {
      if (num) renderPage(num).catch(function () {});
    });
  }

  function turn(dir) {
    if (busy) return;
    var target = view + dir;
    if (target < 0 || target > maxView()) return;
    busy = true;
    updateChrome();
    var current = pagesFor(view);
    var upcoming = pagesFor(target);
    var needed = [current.left, current.right, upcoming.left, upcoming.right].filter(Boolean);
    Promise.all(needed.map(renderPage)).then(function () {
      var fromPage;
      var toPage;
      if (portrait()) {
        fromPage = current.right;
        toPage = upcoming.right;
      } else {
        fromPage = dir > 0 ? current.right : current.left;
        toPage = dir > 0 ? upcoming.left : upcoming.right;
      }
      place(front, cloneCanvas(fromPage ? cache.get(fromPage) : null));
      place(back, cloneCanvas(toPage ? cache.get(toPage) : null));
      leaf.className = "leaf " + (dir > 0 ? "next" : "prev");
      void leaf.offsetWidth;
      if (!portrait() && dir < 0) {
        place(leftSheet, upcoming.left ? cache.get(upcoming.left) : null);
      }
      if (!portrait() && dir > 0) {
        place(rightSheet, upcoming.right ? cache.get(upcoming.right) : null);
      }
      if (portrait()) {
        place(rightSheet, toPage ? cache.get(toPage) : null);
      }
      return new Promise(function (resolve) {
        var finished = false;
        function finish() {
          if (finished) return;
          finished = true;
          leaf.removeEventListener("transitionend", done);
          resolve();
        }
        function done(event) {
          if (event.propertyName !== "transform") return;
          finish();
        }
        leaf.addEventListener("transitionend", done);
        window.setTimeout(finish, 900);
        leaf.classList.add("turning");
      });
    }).then(function () {
      view = target;
      leaf.className = "leaf";
      front.replaceChildren();
      back.replaceChildren();
      return show(view);
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : "Could not turn the page.");
    }).then(function () {
      busy = false;
      updateChrome();
    });
  }

  prevBtn.addEventListener("click", function () { turn(-1); });
  nextBtn.addEventListener("click", function () { turn(1); });
  window.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight") turn(1);
    if (event.key === "ArrowLeft") turn(-1);
  });

  var touchX = null;
  stage.addEventListener("touchstart", function (event) {
    touchX = event.changedTouches[0].clientX;
  }, { passive: true });
  stage.addEventListener("touchend", function (event) {
    if (touchX == null) return;
    var delta = event.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(delta) < 40) return;
    turn(delta < 0 ? 1 : -1);
  }, { passive: true });

  portraitQuery.addEventListener("change", function () {
    layout();
    var next = portrait() ? anchor - 1 : (anchor <= 1 ? 0 : Math.ceil((anchor - 1) / 2));
    show(Math.max(0, Math.min(next, maxView())));
  });
  window.addEventListener("resize", layout);

  layout();
  var task = pdfjsLib.getDocument({ url: pdfUrl });
  task.onProgress = function (progress) {
    if (!progress.total) return;
    var pct = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
    setStatus("Loading " + title + "… " + pct + "%");
  };
  task.promise.then(function (doc) {
    pdfDoc = doc;
    pageCount = doc.numPages;
    setStatus("Opening " + title + "…");
    return show(0);
  }).then(function () {
    setStatus("");
  }).catch(function (error) {
    setStatus(error && error.message ? error.message : "Could not open this PDF.");
  });
})();
