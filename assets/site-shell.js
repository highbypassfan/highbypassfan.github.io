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

  function initializeImageLightbox() {
    const mediaItems = document.querySelectorAll(".hero, .post-image img, .post-image video, .post-album-image");
    if (!mediaItems.length) {
      return;
    }

    let lightbox = document.querySelector(".image-lightbox");
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "image-lightbox";
      lightbox.innerHTML = '<button type="button" class="image-lightbox-close" aria-label="Close media viewer">x</button><img alt=""><video controls playsinline preload="metadata"></video>';
      document.body.appendChild(lightbox);
    }

    const closeButton = lightbox.querySelector(".image-lightbox-close");
    const lightboxImage = lightbox.querySelector("img");
    const lightboxVideo = lightbox.querySelector("video");

    function closeLightbox() {
      lightbox.classList.remove("open");
      document.body.style.overflow = "";
      lightboxImage.style.display = "none";
      lightboxImage.removeAttribute("src");
      lightboxImage.removeAttribute("alt");
      lightboxVideo.pause();
      lightboxVideo.style.display = "none";
      lightboxVideo.removeAttribute("src");
      lightboxVideo.removeAttribute("aria-label");
      lightboxVideo.load();
    }

    function openLightbox(media) {
      if (media.tagName === "VIDEO") {
        lightboxImage.style.display = "none";
        lightboxVideo.src = media.currentSrc || media.src;
        lightboxVideo.setAttribute("aria-label", media.getAttribute("aria-label") || media.getAttribute("title") || "");
        lightboxVideo.style.display = "block";
        const currentTime = Number(media.currentTime || 0);
        lightboxVideo.currentTime = Number.isFinite(currentTime) ? currentTime : 0;
      } else {
        lightboxVideo.pause();
        lightboxVideo.style.display = "none";
        lightboxVideo.removeAttribute("src");
        lightboxVideo.removeAttribute("aria-label");
        lightboxVideo.load();
        lightboxImage.src = media.currentSrc || media.src;
        lightboxImage.alt = media.alt || "";
        lightboxImage.style.display = "block";
      }
      lightbox.classList.add("open");
      document.body.style.overflow = "hidden";
    }

    mediaItems.forEach((media) => {
      if (media.dataset.lightboxBound === "true") {
        return;
      }
      media.dataset.lightboxBound = "true";
      media.addEventListener("click", () => openLightbox(media));
    });

    closeButton.onclick = closeLightbox;
    lightbox.onclick = (event) => {
      if (event.target === lightbox) {
        closeLightbox();
      }
    };

    if (lightbox.dataset.escapeBound !== "true") {
      lightbox.dataset.escapeBound = "true";
      document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && lightbox.classList.contains("open")) {
        closeLightbox();
      }
      });
    }
  }

  function initializeInlineVideos() {
    const videos = document.querySelectorAll(".post-image video, .post-body video");
    videos.forEach((video) => {
      video.controls = true;
      video.autoplay = false;
      video.preload = video.getAttribute("preload") || "metadata";
      if (!video.hasAttribute("playsinline")) {
        video.setAttribute("playsinline", "");
      }
    });
  }

  function initializePostAlbums() {
    const albums = document.querySelectorAll(".post-album");
    albums.forEach((album) => {
      const image = album.querySelector(".post-album-image");
      const caption = album.querySelector(".post-album-caption");
      const prevButton = album.querySelector(".album-nav.prev");
      const nextButton = album.querySelector(".album-nav.next");
      const items = Array.from(album.querySelectorAll(".album-item")).map((node) => ({
        src: node.dataset.src || "",
        alt: node.dataset.alt || "",
        blurb: node.dataset.blurb || ""
      }));

      if (!image || !caption || !prevButton || !nextButton || !items.length) {
        return;
      }

      let index = Number(album.dataset.index || "0");
      if (!Number.isFinite(index) || index < 0 || index >= items.length) {
        index = 0;
      }

      function renderAlbum() {
      const item = items[index];
      image.src = item.src;
      image.alt = item.alt;
        caption.textContent = item.blurb;
        prevButton.disabled = index === 0;
        nextButton.disabled = index === items.length - 1;
        album.dataset.index = String(index);
      }

      if (album.dataset.albumBound !== "true") {
        album.dataset.albumBound = "true";
        prevButton.addEventListener("click", () => {
          if (index > 0) {
            index -= 1;
            renderAlbum();
          }
        });
        nextButton.addEventListener("click", () => {
          if (index < items.length - 1) {
            index += 1;
            renderAlbum();
          }
        });
      }

      renderAlbum();
    });
  }

  window.renderSiteNav = renderSiteNav;
  window.initializeImageLightbox = initializeImageLightbox;
  window.initializeInlineVideos = initializeInlineVideos;
  window.initializePostAlbums = initializePostAlbums;
  document.querySelectorAll("[data-site-nav]").forEach(renderSiteNav);
  initializePostAlbums();
  initializeInlineVideos();
  initializeImageLightbox();
})();
