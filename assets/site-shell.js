(function () {
  function renderSiteNav(root) {
    const prefix = root.dataset.navPrefix || "";
    const activeSection = root.dataset.navSection || "";
    const items = [
      { id: "home", label: "home", href: `${prefix}index.html` },
      { id: "posts", label: "posts", href: `${prefix}posts.html` },
      { id: "engineering-tips", label: "engineering tips", href: `${prefix}posts/engineering_tips.html` },
      { id: "datastream", label: "datastream", href: "#" }
    ];

    root.classList.add("top-nav");
    root.innerHTML = items.map((item) => {
      const activeClass = item.id === activeSection ? ' class="active"' : "";
      return `<a href="${item.href}"${activeClass}>${item.label}</a>`;
    }).join("\n");
  }

  window.renderSiteNav = renderSiteNav;
  document.querySelectorAll("[data-site-nav]").forEach(renderSiteNav);
})();
