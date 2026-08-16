// Copy-to-clipboard for code blocks. Loaded by the docs template and by the
// marketing page, so the behaviour cannot drift between them.
//
// Delegated, so a page holds any number of blocks with no per-block wiring. The
// clipboard gets pre.innerText, and the button is a SIBLING of the <pre> rather
// than a child, so the button's own label can never land in the copied text.
(function () {
  var HELD = 1400;

  function done(btn) {
    btn.classList.add("ok");
    btn.setAttribute("aria-label", "Copied");
    setTimeout(function () {
      btn.classList.remove("ok");
      btn.setAttribute("aria-label", "Copy code to clipboard");
    }, HELD);
  }

  function legacy(text, btn) {
    // execCommand is deprecated, and it is still the only path when the page is
    // opened over http:// or from a file.
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done(btn);
    } catch (e) {}
    document.body.removeChild(ta);
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".copy");
    if (!btn) return;
    var pre = btn.parentNode.querySelector("pre");
    if (!pre) return;
    var text = pre.innerText;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(btn);
        },
        function () {
          legacy(text, btn);
        },
      );
    } else {
      legacy(text, btn);
    }
  });
})();
