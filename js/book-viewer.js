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
  book.id = "book";
  stage.appendChild(book);
  var prevBtn = button("prev", "‹", "Previous page");
  var nextBtn = button("next", "›", "Next page");
  root.appendChild(statusEl);
  root.appendChild(top);
  root.appendChild(stage);
  root.appendChild(prevBtn);
  root.appendChild(nextBtn);
  top.querySelector("strong").textContent = title;

  var flip = null;
  var pageCount = 0;
  var urls = [];

  function button(kind, label, name) {
    var el = document.createElement("button");
    el.className = "nav " + kind;
    el.type = "button";
    el.textContent = label;
    el.setAttribute("aria-label", name);
    return el;
  }

  function setStatus(text) {
    statusEl.hidden = !text;
    if (text) statusEl.querySelector("p").textContent = text;
  }

  function labelFor(index) {
    var page = index + 1;
    var single = !flip || flip.getOrientation() === "portrait" || index === 0 || page >= pageCount;
    if (single) return page + " / " + pageCount;
    return page + "–" + (page + 1) + " / " + pageCount;
  }

  function updateChrome(index) {
    if (!flip) return;
    var current = typeof index === "number" ? index : flip.getCurrentPageIndex();
    top.querySelector("span").textContent = labelFor(current);
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= pageCount - 1;
  }

  function renderPage(pdf, num, width) {
    return pdf.getPage(num).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: width / base.width });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      var context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: context, viewport: viewport }).promise.then(function () {
        var url = canvas.toDataURL("image/jpeg", 0.86);
        canvas.width = 1;
        canvas.height = 1;
        return url;
      });
    });
  }

  function placeholder() {
    var canvas = document.createElement("canvas");
    canvas.width = 60;
    canvas.height = 90;
    var context = canvas.getContext("2d");
    context.fillStyle = "#f7f4ee";
    context.fillRect(0, 0, 60, 90);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  function coverWidth() {
    var height = Math.max(520, window.innerHeight - 88);
    return Math.min(680, Math.floor(height * 600 / 900), window.innerWidth - 24);
  }

  function applyFrame(index) {
    var closed = window.innerWidth > 860 && index === 0;
    var nextWidth = closed ? coverWidth() + "px" : "100%";
    var nextMax = closed ? nextWidth : "1280px";
    if (book.style.width === nextWidth && book.style.maxWidth === nextMax) return;
    book.style.width = nextWidth;
    book.style.maxWidth = nextMax;
    window.dispatchEvent(new Event("resize"));
  }

  function mount(list) {
    if (!flip) {
      flip = new St.PageFlip(book, {
        width: 600,
        height: 900,
        size: "stretch",
        minWidth: 340,
        maxWidth: 1600,
        minHeight: 480,
        maxHeight: 2200,
        drawShadow: true,
        flippingTime: 700,
        usePortrait: true,
        startPage: 0,
        autoSize: true,
        maxShadowOpacity: 0.55,
        showCover: true,
        mobileScrollSupport: false,
        swipeDistance: 18,
        showPageCorners: true,
        disableFlipByClick: false,
        useMouseEvents: true
      });
      flip.loadFromImages(list);
      applyFrame(0);
      flip.on("flip", function (event) {
        applyFrame(event.data);
        updateChrome(event.data);
      });
      flip.on("changeOrientation", function () { updateChrome(); });
      updateChrome(0);
      return;
    }
    flip.updateFromImages(list);
    updateChrome();
  }

  prevBtn.addEventListener("click", function () {
    if (flip) flip.flipPrev("bottom");
  });
  nextBtn.addEventListener("click", function () {
    if (flip) flip.flipNext("bottom");
  });
  window.addEventListener("keydown", function (event) {
    if (!flip) return;
    if (event.key === "ArrowRight") flip.flipNext("bottom");
    if (event.key === "ArrowLeft") flip.flipPrev("bottom");
  });

  var blank = placeholder();
  var task = pdfjsLib.getDocument({ url: pdfUrl });
  task.onProgress = function (progress) {
    if (!progress.total) return;
    var pct = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
    setStatus("Loading " + title + "… " + pct + "%");
  };

  task.promise.then(function (pdf) {
    pageCount = pdf.numPages;
    var width = Math.max(1000, Math.min(1400, Math.floor(window.innerWidth * (window.devicePixelRatio || 1) / 2)));
    urls = new Array(pageCount);
    var next = 1;

    function step() {
      if (next > pageCount) {
        setStatus("");
        mount(urls);
        return;
      }
      var num = next;
      next += 1;
      top.querySelector("span").textContent = "Preparing " + num + " / " + pageCount;
      renderPage(pdf, num, width).then(function (url) {
        urls[num - 1] = url;
        if (num === 1) {
          var first = urls.slice();
          for (var i = 1; i < pageCount; i++) first[i] = blank;
          setStatus("");
          mount(first);
        }
        step();
      }).catch(function () {
        urls[num - 1] = blank;
        step();
      });
    }

    setStatus("Opening " + title + "…");
    step();
  }).catch(function (error) {
    setStatus(error && error.message ? error.message : "Could not open this PDF.");
  });
})();
