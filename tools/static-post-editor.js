(function () {
  const DRAFT_KEY = "static-post-editor-draft-v1";
  const LAST_REPO_NAME_KEY = "static-post-editor-last-repo-name";
  const pickRepoButton = document.getElementById("pickRepo");
  const newPostButton = document.getElementById("newPost");
  const selectPostButton = document.getElementById("selectPost");
  const deletePostButton = document.getElementById("deletePost");
  const generateButton = document.getElementById("generate");
  const imagePicker = document.getElementById("imagePicker");
  const addAlbumButton = document.getElementById("addAlbum");
  const imageList = document.getElementById("imageList");
  const editor = document.getElementById("editor");
  const status = document.getElementById("status");
  const loadedPostLabel = document.getElementById("loadedPost");
  const titleInput = document.getElementById("title");
  const slugInput = document.getElementById("slug");
  const dateInput = document.getElementById("date");
  const publishedInput = document.getElementById("published");
  const summaryInput = document.getElementById("summary");
  const tagsInput = document.getElementById("tags");
  const navSectionInput = document.getElementById("navSection");
  const dropzone = document.getElementById("dropzone");
  const toolbarButtons = document.querySelectorAll(".toolbar button[data-command]");
  const addLinkButton = document.getElementById("addLink");
  const clearBodyButton = document.getElementById("clearBody");
  const previewDrawer = document.getElementById("previewDrawer");
  const previewToggle = document.getElementById("previewToggle");
  const previewFrame = document.getElementById("previewFrame");
  const postPickerModal = document.getElementById("postPickerModal");
  const closePostPickerButton = document.getElementById("closePostPicker");
  const postSearchInput = document.getElementById("postSearch");
  const postSearchResults = document.getElementById("postSearchResults");
  const restoreBanner = document.getElementById("restoreBanner");
  const restoreDraftButton = document.getElementById("restoreDraft");
  const dismissDraftButton = document.getElementById("dismissDraft");

  let repoHandle = null;
  let pendingImages = [];
  let existingImages = [];
  let loadedPostRef = null;
  let contentIndexCache = null;
  let heroImagePath = "";
  let autosaveTimer = null;
  let previewTimer = null;
  let previewScrollY = 0;
  let previewRenderVersion = 0;
  let previewHeroObjectUrl = "";
  const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".jfif", ".bmp", ".svg", ".avif"];
  const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

  initializeSavedRepoHandle();
  updateDraftBanner();

  dateInput.value = new Date().toISOString().slice(0, 10);
  renderPreview();
  loadLastRepoName();

  titleInput.addEventListener("input", () => {
    if (!slugInput.dataset.touched) {
      slugInput.value = slugify(titleInput.value);
    }
    refreshPendingImagePaths();
    queuePersistAndPreview();
  });

  slugInput.addEventListener("input", () => {
    slugInput.dataset.touched = "true";
    refreshPendingImagePaths();
    queuePersistAndPreview();
  });

  [dateInput, publishedInput, summaryInput, tagsInput, navSectionInput].forEach((element) => {
    element.addEventListener("input", queuePersistAndPreview);
    element.addEventListener("change", queuePersistAndPreview);
  });

  toolbarButtons.forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      if (button.dataset.command === "justifyCenter") {
        applyBlockAlignment("center");
      }
      else if (button.dataset.command === "justifyLeft") {
        applyBlockAlignment("left");
      }
      else {
        document.execCommand(button.dataset.command, false, button.dataset.value || null);
      }
      cleanupEditorMarkup();
      editor.focus();
      queuePersistAndPreview();
    });
  });

  addLinkButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  addLinkButton.addEventListener("click", () => {
    const url = normalizeExternalUrl(window.prompt("Enter URL"));
    if (!url) {
      return;
    }
    document.execCommand("createLink", false, url);
    editor.focus();
    queuePersistAndPreview();
  });

  clearBodyButton.addEventListener("click", () => {
    editor.innerHTML = "<p></p>";
    editor.focus();
    queuePersistAndPreview();
  });

  editor.addEventListener("input", () => {
    cleanupEditorMarkup();
    queuePersistAndPreview();
  });

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      const mediaFigure = getSelectedMediaFigure();
      if (mediaFigure) {
        event.preventDefault();
        insertParagraphAfterFigure(mediaFigure);
        cleanupEditorMarkup();
        queuePersistAndPreview();
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      generateButton.click();
    }
  });

  imagePicker.addEventListener("change", () => {
    appendImages(Array.from(imagePicker.files || []));
    imagePicker.value = "";
  });

  addAlbumButton.addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      setStatus("Your browser does not support folder picking here. Use current Chrome and open this tool locally.", true);
      return;
    }

    try {
      const folderHandle = await window.showDirectoryPicker();
      await appendAlbumFromDirectory(folderHandle);
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      setStatus(error.message || String(error), true);
    }
  });

  document.addEventListener("paste", (event) => {
    if (!dropzone.contains(event.target) && !editor.contains(event.target)) {
      return;
    }

    const files = Array.from(event.clipboardData.files || []).filter(isSupportedMediaFile);
    if (!files.length) {
      return;
    }

    event.preventDefault();
    appendImages(files);
  });

  closePostPickerButton.addEventListener("click", closePostPicker);
  postPickerModal.addEventListener("click", (event) => {
    if (event.target === postPickerModal) {
      closePostPicker();
    }
  });
  postSearchInput.addEventListener("input", () => {
    renderSearchResults(buildSearchResults(postSearchInput.value));
  });

  restoreDraftButton.addEventListener("click", async () => {
    await restoreDraft();
  });
  dismissDraftButton.addEventListener("click", () => {
    clearSavedDraft();
    updateDraftBanner();
    setStatus("Saved local draft discarded.");
  });

  previewToggle.addEventListener("click", () => {
    previewDrawer.classList.toggle("open");
    if (previewDrawer.classList.contains("open")) {
      renderPreview();
    }
  });

  previewFrame.addEventListener("load", () => {
    try {
      if (previewFrame.contentWindow) {
        previewFrame.dataset.ready = "true";
        previewFrame.contentWindow.scrollTo(0, previewScrollY);
      }
    } catch {
    }
  });

  pickRepoButton.addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      setStatus("Your browser does not support the File System Access API here. Use current Chrome and open this tool locally.", true);
      return;
    }

    try {
      repoHandle = await window.showDirectoryPicker();
      await repoHandle.getFileHandle("index.html");
      contentIndexCache = await readJson("data/content-index.json");
      await saveRepoHandle(repoHandle);
      saveLastRepoName(repoHandle.name);
      updateRepoButtonLabel(repoHandle.name);
      setStatus("Repo folder selected. Ready to create or edit posts.");
      if (loadedPostRef) {
        existingImages = await loadExistingImages(loadedPostRef.item);
        renderImageList();
      }
    } catch (error) {
      setStatus("Repo folder selection canceled or invalid.", true);
    }
  });

  newPostButton.addEventListener("click", () => {
    resetEditorForNewPost();
    setStatus("Started a new post draft.");
  });

  selectPostButton.addEventListener("click", async () => {
    try {
      if (!repoHandle) {
        throw new Error("Pick the website folder first.");
      }

      contentIndexCache = contentIndexCache || await readJson("data/content-index.json");
      const allPosts = buildSearchResults("");
      if (!allPosts.length) {
        throw new Error("No posts found in data/content-index.json.");
      }
      openPostPicker(allPosts);
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });

  generateButton.addEventListener("click", async () => {
    try {
      if (!repoHandle) {
        throw new Error("Pick the website folder first.");
      }

      const title = titleInput.value.trim();
      const slug = slugify(slugInput.value.trim() || title);
      const date = dateInput.value;
      const published = publishedInput.checked;
      const summary = summaryInput.value.trim();
      const tags = tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
      const navSection = navSectionInput.value.trim() || "posts";
      const bodyHtml = normalizeBodyHtml(editor.innerHTML);

      if (!title || !slug || !date || !summary) {
        throw new Error("Title, slug, date, and summary are required.");
      }

      const pagePath = `posts/${slug}.html`;
      const imagesFolder = `images/${slug}`;
      const savedImages = await saveImages(imagesFolder, pendingImages);
      const existingHero = loadedPostRef && loadedPostRef.item.slug === slug ? loadedPostRef.item.image : null;
      const heroAsset = await resolveHeroAsset({ slug, folderPath: imagesFolder });
      const heroImage = heroAsset.image || "";
      const heroBlurb = getHeroImageBlurb(heroAsset.heroSource || heroImage);

      const item = {
        slug,
        title,
        date,
        published,
        summary,
        tags,
        image: heroImage,
        heroSource: heroAsset.heroSource,
        heroBlurb,
        path: pagePath,
        navSection,
        bodyHtml
      };

      const contentIndex = contentIndexCache || await readJson("data/content-index.json");

      if (loadedPostRef) {
        contentIndex.posts = (contentIndex.posts || []).filter((entry) => entry.slug !== loadedPostRef.item.slug);
      }

      contentIndex.posts = (contentIndex.posts || []).filter((entry) => entry.slug !== slug);
      contentIndex.posts.push(item);
      contentIndex.posts.sort((a, b) => new Date(b.date) - new Date(a.date));
      contentIndexCache = contentIndex;

      await writeTextFile("data/content-index.json", JSON.stringify(contentIndex, null, 2) + "\n");
      await writeTextFile(pagePath, renderPostPage(item));
      await writeTextFile("posts.html", renderIndexPage(contentIndex.posts || []));
      await writeTextFile("index.html", await renderHomePageFromLocal(contentIndex.posts || []));

      loadedPostRef = { item };
      loadedPostLabel.textContent = `loaded: ${item.slug}`;
      pendingImages = await loadAlbumsFromEditorBody();
      pendingImages.filter((entry) => entry.kind === "album").forEach(updateAlbumInDocument);
      existingImages = await loadExistingImages(item);
      clearSavedDraft();
      updateDraftBanner();
      renderImageList();
      renderPreview();
      const savedAt = new Date().toLocaleString();
      const visibilityLine = published
        ? "Published on posts.html"
        : "Unpublished from posts.html";
      setStatus(`Saved ${pagePath}\nSaved at ${savedAt}\n${visibilityLine}\nUpdated data/content-index.json\nUpdated posts.html and index.html\nSaved ${savedImages.length} new media file(s) in ${imagesFolder}/`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });

  deletePostButton.addEventListener("click", async () => {
    try {
      if (!repoHandle) {
        throw new Error("Pick the website folder first.");
      }
      if (!loadedPostRef || !loadedPostRef.item) {
        throw new Error("Load a post first, then you can delete it.");
      }

      await deleteLoadedPost();
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });

  function getFileExtension(name) {
    const match = /\.([^.]+)$/.exec(name || "");
    return match ? `.${match[1].toLowerCase()}` : "";
  }

  function getMediaKindFromFile(file) {
    if (!file) {
      return "";
    }

    const type = (file.type || "").toLowerCase();
    const extension = getFileExtension(file.name || "");
    if (type.startsWith("image/") || SUPPORTED_IMAGE_EXTENSIONS.includes(extension)) {
      return "image";
    }
    if (type.startsWith("video/") || SUPPORTED_VIDEO_EXTENSIONS.includes(extension)) {
      return "video";
    }
    return "";
  }

  function getMediaKindFromPath(path) {
    const extension = getFileExtension(path || "");
    if (SUPPORTED_IMAGE_EXTENSIONS.includes(extension)) {
      return "image";
    }
    if (SUPPORTED_VIDEO_EXTENSIONS.includes(extension)) {
      return "video";
    }
    return "";
  }

  function isSupportedMediaFile(file) {
    return Boolean(getMediaKindFromFile(file));
  }

  function isSupportedAlbumFile(file) {
    return getMediaKindFromFile(file) === "image";
  }

  function renderMediaMarkup({ path, alt, mediaKind, className = "", id = "", controls, muted = false, playsinline = true, loop = false, autoplay = false }) {
    const classAttribute = className ? ` class="${escapeAttribute(className)}"` : "";
    const idAttribute = id ? ` id="${escapeAttribute(id)}"` : "";
    if (mediaKind === "video") {
      const showControls = controls === undefined ? true : controls;
      return `<video${classAttribute}${idAttribute} src="${escapeAttribute(path)}" aria-label="${escapeAttribute(alt)}" preload="metadata"${showControls ? " controls" : ""}${muted ? " muted" : ""}${playsinline ? " playsinline" : ""}${loop ? " loop" : ""}${autoplay ? " autoplay" : ""}></video>`;
    }
    return `<img${classAttribute}${idAttribute} src="${escapeAttribute(path)}" alt="${escapeAttribute(alt)}" />`;
  }

  function normalizeMediaPath(path) {
    return (path || "").replace(/^\.?\.\//, "");
  }

  function findMediaEntryByPath(path) {
    const normalizedPath = normalizeMediaPath(path);
    if (!normalizedPath) {
      return null;
    }

    return getAllImageEntries().find((entry) => normalizeMediaPath(entry.relativePath) === normalizedPath) || null;
  }

  async function getMediaFileForEntry(entry) {
    if (!entry) {
      return null;
    }
    if (entry.file) {
      return entry.file;
    }
    if (!repoHandle || !entry.relativePath) {
      return null;
    }

    try {
      return getFileHandle(normalizeMediaPath(entry.relativePath), false).then((handle) => handle.getFile());
    } catch {
      return null;
    }
  }

  function getPosterFileName(fileName) {
    const baseName = sanitizeFileName((fileName || "hero").replace(/\.[^.]+$/, ""));
    return `${baseName}-hero-poster.png`;
  }

  async function captureVideoPosterBlob(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);

      function cleanup() {
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute("src");
        video.load();
      }

      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      video.addEventListener("loadeddata", () => {
        try {
          const width = video.videoWidth || 1280;
          const height = video.videoHeight || 720;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) {
            cleanup();
            reject(new Error("Could not create a canvas context for the hero frame."));
            return;
          }

          context.drawImage(video, 0, 0, width, height);
          canvas.toBlob((blob) => {
            cleanup();
            if (!blob) {
              reject(new Error("Could not capture the first frame from that video."));
              return;
            }
            resolve(blob);
          }, "image/png");
        } catch (error) {
          cleanup();
          reject(error);
        }
      }, { once: true });

      video.addEventListener("error", () => {
        cleanup();
        reject(new Error(`Could not read the first frame of ${file.name || "that video"}.`));
      }, { once: true });

      video.src = objectUrl;
    });
  }

  async function writeBlobFile(path, blob) {
    const handle = await getFileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function resolveHeroAsset({ slug, folderPath, forPreview = false }) {
    const resolvedHero = resolveHeroImagePath(slug);
    const heroEntry = findMediaEntryByPath(resolvedHero || heroImagePath);

    if (!heroEntry) {
      if (previewHeroObjectUrl) {
        URL.revokeObjectURL(previewHeroObjectUrl);
        previewHeroObjectUrl = "";
      }
      return {
        image: resolvedHero || "",
        heroSource: ""
      };
    }

    const heroSource = normalizeMediaPath(heroEntry.relativePath);
    if (heroEntry.mediaKind !== "video") {
      if (previewHeroObjectUrl) {
        URL.revokeObjectURL(previewHeroObjectUrl);
        previewHeroObjectUrl = "";
      }
      return {
        image: heroSource,
        heroSource: ""
      };
    }

    if (previewHeroObjectUrl) {
      URL.revokeObjectURL(previewHeroObjectUrl);
      previewHeroObjectUrl = "";
    }
    return {
      image: "",
      heroSource: ""
    };
  }

  function appendImages(files) {
    const supportedFiles = files.filter(isSupportedMediaFile);
    if (!supportedFiles.length) {
      setStatus("No supported media files found. GIF, mp4, webm, and mov are supported.", true);
      return;
    }

    pendingImages = pendingImages.concat(
      supportedFiles.map((file) => ({
        kind: "image",
        id: makeEntryId("image"),
        file,
        mediaKind: getMediaKindFromFile(file),
        name: sanitizeFileName(file.name || `image-${pendingImages.length + 1}.png`),
        blurb: "",
        relativePath: getPendingImagePath(sanitizeFileName(file.name || `image-${pendingImages.length + 1}.png`))
      }))
    );
    if (!heroImagePath && pendingImages.length) {
      chooseFallbackHero();
    }
    renderImageList();
    queuePersistAndPreview();
  }

  async function appendAlbumFromDirectory(folderHandle) {
    const files = [];
    for await (const [name, handle] of folderHandle.entries()) {
      if (handle.kind !== "file") {
        continue;
      }
      const file = await handle.getFile();
      if (!isSupportedAlbumFile(file)) {
        continue;
      }
      files.push({ file, name: sanitizeFileName(name) });
    }

    if (!files.length) {
      throw new Error("No supported image files found in that folder.");
    }

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const slug = slugify(slugInput.value.trim() || titleInput.value.trim());
    const album = {
      kind: "album",
      id: makeEntryId("album"),
      name: sanitizeFileName(folderHandle.name || `album-${pendingImages.length + 1}`),
      currentIndex: 0,
      images: files.map(({ file, name }) => ({
        file,
        name,
        blurb: "",
        relativePath: getPendingImagePath(name, sanitizeFileName(folderHandle.name || `album-${pendingImages.length + 1}`))
      }))
    };

    pendingImages.push(album);
    renderImageList();
    queuePersistAndPreview();
  }

  function renderImageList() {
    imageList.innerHTML = "";

    existingImages.forEach((entry) => {
      imageList.appendChild(buildImageRow({
        entry,
        canBeHero: entry.mediaKind !== "video",
        onHero: () => {
          heroImagePath = isHeroPath(entry.relativePath) ? "" : entry.relativePath.slice(3);
          renderImageList();
          queuePersistAndPreview();
        },
        onInsert: () => insertMediaFigure(entry.name, entry.blurb, entry.relativePath, entry.mediaKind),
        onCaption: (value) => {
          entry.blurb = value;
          updateDocumentImageCaptions(entry.relativePath, value);
          queuePersistAndPreview();
        },
        onRemove: async () => {
          await deleteExistingImage(entry);
        }
      }));
    });

    pendingImages.forEach((entry, index) => {
      if (entry.kind === "album") {
        const currentImage = entry.images[entry.currentIndex] || entry.images[0];
        imageList.appendChild(buildImageRow({
          entry: {
            ...entry,
            displayName: `${entry.name}/ (${entry.currentIndex + 1}/${entry.images.length})`,
            blurb: currentImage ? currentImage.blurb : "",
            relativePath: currentImage ? currentImage.relativePath : "",
            isAlbum: true,
            canBeHero: true,
            canGoPrev: entry.currentIndex > 0,
            canGoNext: entry.currentIndex < entry.images.length - 1
          },
          onHero: () => {
            if (!currentImage) {
              return;
            }
            heroImagePath = isHeroPath(currentImage.relativePath) ? "" : currentImage.relativePath;
            renderImageList();
            queuePersistAndPreview();
          },
          onInsert: () => insertAlbumFigure(entry),
          onCaption: (value) => {
            if (!currentImage) {
              return;
            }
            currentImage.blurb = value;
            updateAlbumInDocument(entry);
            queuePersistAndPreview();
          },
          onRemove: () => {
            removeAlbumFromDocument(entry.id);
            pendingImages.splice(index, 1);
            if (currentImage && heroImagePath === currentImage.relativePath) {
              chooseFallbackHero();
            }
            renderImageList();
            queuePersistAndPreview();
          },
          onPrev: () => {
            if (entry.currentIndex > 0) {
              entry.currentIndex -= 1;
              renderImageList();
            }
          },
          onNext: () => {
            if (entry.currentIndex < entry.images.length - 1) {
              entry.currentIndex += 1;
              renderImageList();
            }
          }
        }));
        return;
      }

      imageList.appendChild(buildImageRow({
        entry,
        canBeHero: entry.mediaKind !== "video",
        onHero: () => {
          heroImagePath = isHeroPath(entry.relativePath) ? "" : entry.relativePath;
          renderImageList();
          queuePersistAndPreview();
        },
        onInsert: () => insertMediaFigure(entry.name, entry.blurb, `../${entry.relativePath}`, entry.mediaKind),
        onCaption: (value) => {
          entry.blurb = value;
          updateDocumentImageCaptions(`../${entry.relativePath}`, value);
          queuePersistAndPreview();
        },
        onRemove: () => {
          removeImageFromDocument(`../${entry.relativePath}`);
          pendingImages.splice(index, 1);
          if (heroImagePath === entry.relativePath) {
            chooseFallbackHero();
          }
          renderImageList();
          queuePersistAndPreview();
        }
      }));
    });
  }

  function buildImageRow({ entry, onHero, onInsert, onCaption, onRemove, onPrev, onNext }) {
    const row = document.createElement("div");
    row.className = "image-item";

    const details = document.createElement("div");
    details.className = "image-item-main";

    const name = document.createElement("div");
    name.textContent = entry.displayName || entry.name;

    const blurbInput = document.createElement("input");
    blurbInput.type = "text";
    blurbInput.placeholder = "optional blurb below image";
    blurbInput.value = entry.blurb || "";
    blurbInput.title = entry.isAlbum
      ? "Optional blurb shown below the current album image"
      : "Optional caption or blurb shown below inserted images";
    blurbInput.addEventListener("input", () => {
      onCaption(blurbInput.value);
    });

    details.append(name, blurbInput);

    const actions = document.createElement("div");
    actions.className = "image-item-actions";

    const hero = document.createElement("button");
    hero.type = "button";
    hero.textContent = "H";
    hero.title = entry.canBeHero === false
      ? "Videos can be inserted in the post body, but only images and GIFs can be hero media"
      : "Set this media as the page hero image";
    hero.className = `hero-toggle${isHeroPath(entry.relativePath) ? " active" : ""}`;
    hero.disabled = entry.canBeHero === false;
    if (entry.canBeHero !== false) {
      hero.addEventListener("click", onHero);
    }

    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = entry.isAlbum ? "insert album" : "insert";
    insert.title = entry.isAlbum
      ? "Insert this album into the document body"
      : "Insert this media into the document body as a centered figure";
    insert.addEventListener("click", onInsert);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "remove";
    remove.title = "Remove this image from the editor and delete it from the post folder if it already exists";
    remove.addEventListener("click", onRemove);

    if (entry.isAlbum) {
      const prev = document.createElement("button");
      prev.type = "button";
      prev.textContent = "<";
      prev.title = "Show the previous image in this album";
      prev.disabled = !entry.canGoPrev;
      prev.addEventListener("click", onPrev);

      const next = document.createElement("button");
      next.type = "button";
      next.textContent = ">";
      next.title = "Show the next image in this album";
      next.disabled = !entry.canGoNext;
      next.addEventListener("click", onNext);

      actions.append(hero, prev, next, insert, remove);
    } else {
      actions.append(hero, insert, remove);
    }
    row.append(details, actions);
    return row;
  }

  async function deleteExistingImage(entry) {
    if (!repoHandle) {
      setStatus("Pick the website folder before deleting images.", true);
      return;
    }

    const confirmed = window.confirm(`Delete ${entry.name} from this post's image folder?`);
    if (!confirmed) {
      return;
    }

    const pathWithoutPrefix = entry.relativePath.slice(3);
    const folderPath = pathWithoutPrefix.split("/").slice(0, -1).join("/");
    const fileName = pathWithoutPrefix.split("/").pop();

    try {
      const folderHandle = await ensureDirectory(folderPath, false);
      await folderHandle.removeEntry(fileName);
      removeImageFromDocument(entry.relativePath);
      existingImages = existingImages.filter((image) => image.relativePath !== entry.relativePath);
      if (heroImagePath === pathWithoutPrefix) {
        chooseFallbackHero();
      }
      renderImageList();
      queuePersistAndPreview();
    } catch (error) {
      setStatus(`Could not delete ${entry.name} from ${folderPath}.`, true);
    }
  }

  function insertMediaFigure(fileName, blurb, relativePath, mediaKind) {
    const slug = slugify(slugInput.value.trim() || titleInput.value.trim());
    if (!slug && !relativePath) {
      setStatus("Set the title or slug before inserting media.", true);
      return;
    }

    const alt = blurb || titleInput.value.trim() || fileName;
    const path = relativePath || `../images/${slug}/${fileName}`;
    const kind = mediaKind || getMediaKindFromPath(path) || "image";
    const figureHtml = `<p></p><figure class="post-image" data-media-kind="${escapeAttribute(kind)}">${renderMediaMarkup({ path, alt, mediaKind: kind, className: kind === "video" ? "post-media-video" : "" })}${blurb ? `<figcaption>${escapeHtml(blurb)}</figcaption>` : ""}</figure><p></p>`;
    editor.focus();
    document.execCommand("insertHTML", false, figureHtml);
    cleanupEditorMarkup();
    editor.focus();
    queuePersistAndPreview();
  }

  function insertAlbumFigure(album) {
    const items = album.images.map((image) => ({
      src: `../${image.relativePath}`,
      alt: image.blurb || titleInput.value.trim() || image.name,
      blurb: image.blurb || ""
    }));

    if (!items.length) {
      setStatus("Add at least one image before inserting an album.", true);
      return;
    }

    const initial = items[Math.min(album.currentIndex, items.length - 1)];
    const itemsMarkup = items.map((item) => `<span class="album-item" data-src="${escapeAttribute(item.src)}" data-alt="${escapeAttribute(item.alt)}" data-blurb="${escapeAttribute(item.blurb)}"></span>`).join("");
    const figureHtml = `<p></p><figure class="post-album" data-album-id="${escapeAttribute(album.id)}" data-album-name="${escapeAttribute(album.name)}" data-index="${Math.min(album.currentIndex, items.length - 1)}"><img class="post-album-image" src="${escapeAttribute(initial.src)}" alt="${escapeAttribute(initial.alt)}" /><div class="post-album-meta"><button class="album-nav prev" type="button"${items.length <= 1 ? " disabled" : ""}>&lt;</button><figcaption class="post-album-caption">${escapeHtml(initial.blurb)}</figcaption><button class="album-nav next" type="button"${items.length <= 1 ? " disabled" : ""}>&gt;</button></div><div class="album-data" hidden>${itemsMarkup}</div></figure><p></p>`;
    editor.focus();
    document.execCommand("insertHTML", false, figureHtml);
    cleanupEditorMarkup();
    editor.focus();
    queuePersistAndPreview();
  }

  async function loadAlbumsFromEditorBody() {
    const albums = [];

    for (const [index, figure] of Array.from(editor.querySelectorAll("figure.post-album")).entries()) {
      const itemNodes = Array.from(figure.querySelectorAll(".album-item"));
      if (!itemNodes.length) {
        continue;
      }

      const albumName = sanitizeFileName(figure.dataset.albumName || `album-${index + 1}`);
      const images = [];
      for (const [itemIndex, node] of itemNodes.entries()) {
        const src = node.dataset.src || "";
        const sourceRelativePath = normalizeMediaPath(src);
        const name = sourceRelativePath.split("/").pop() || `album-image-${itemIndex + 1}`;
        const relativePath = getPendingImagePath(name, albumName);
        const image = {
          name,
          blurb: node.dataset.blurb || "",
          relativePath,
          sourceRelativePath
        };

        if (image.sourceRelativePath && repoHandle) {
          try {
            image.file = await getFileHandle(image.sourceRelativePath, false).then((handle) => handle.getFile());
          } catch {
          }
        }

        if (image.relativePath) {
          images.push(image);
        }
      }

      if (!images.length) {
        continue;
      }

      let currentIndex = Number(figure.dataset.index || "0");
      if (!Number.isFinite(currentIndex) || currentIndex < 0 || currentIndex >= images.length) {
        currentIndex = 0;
      }

      albums.push({
        kind: "album",
        id: figure.dataset.albumId || makeEntryId(`album-loaded-${index + 1}`),
        name: albumName,
        currentIndex,
        images
      });
    }

    return albums;
  }

  async function loadPostIntoEditor(item) {
    titleInput.value = item.title;
    slugInput.value = item.slug;
    slugInput.dataset.touched = "true";
    dateInput.value = item.date;
    publishedInput.checked = item.published !== false;
    summaryInput.value = item.summary;
    tagsInput.value = (item.tags || []).join(", ");
    navSectionInput.value = item.navSection || "posts";
    editor.innerHTML = sanitizeEditorHtml(item.bodyHtml || "<p></p>");
    loadedPostRef = { item };
    loadedPostLabel.textContent = `loaded: ${item.slug}`;
    pendingImages = await loadAlbumsFromEditorBody();
    pendingImages.filter((entry) => entry.kind === "album").forEach(updateAlbumInDocument);
    existingImages = await loadExistingImages(item);
    heroImagePath = item.heroSource || item.image || "";
    if (getMediaKindFromPath(heroImagePath) === "video") {
      chooseFallbackHero();
    }
    cleanupEditorMarkup();
    renderImageList();
    renderPreview();
    queueDraftSave();
  }

  async function loadExistingImages(item) {
    if (!repoHandle || !item.slug) {
      return [];
    }

    const folderPath = item.image
      ? item.image.split("/").slice(0, -1).join("/")
      : `images/${item.slug}`;
    if (!folderPath.startsWith("images/")) {
      return [];
    }

    const captionMap = getExistingImageCaptions();
    const albumPaths = new Set(
      pendingImages
        .filter((entry) => entry.kind === "album")
        .flatMap((entry) => entry.images.flatMap((image) => [image.relativePath, image.sourceRelativePath].filter(Boolean)))
    );
    try {
      const folderHandle = await ensureDirectory(folderPath, false);
      const items = [];
      for await (const [name, handle] of folderHandle.entries()) {
        if (handle.kind !== "file") {
          continue;
        }
        const imagePath = `${folderPath}/${name}`;
        const file = await handle.getFile();
        const mediaKind = getMediaKindFromFile(file);
        if (!mediaKind) {
          continue;
        }
        if (item.heroSource && item.image && imagePath === item.image) {
          continue;
        }
        if (albumPaths.has(imagePath)) {
          continue;
        }
        items.push({
          name,
          relativePath: `../${imagePath}`,
          mediaKind,
          isHero: imagePath === item.image,
          blurb: captionMap[`../${imagePath}`] || (imagePath === item.image ? (item.heroBlurb || "") : "")
        });
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      return items;
    } catch {
      return [];
    }
  }

  async function saveImages(folderPath, images) {
    if (!images.length) {
      return [];
    }

    const savedPaths = [];

    for (const entry of images) {
      if (entry.kind === "album") {
        const albumFolderPath = `${folderPath}/${sanitizeFileName(entry.name || "album")}`;
        const albumFolderHandle = await ensureDirectory(albumFolderPath, true);
        for (const image of entry.images) {
          if (!image.file) {
            continue;
          }
          const fileHandle = await albumFolderHandle.getFileHandle(image.name, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(await image.file.arrayBuffer());
          await writable.close();
          savedPaths.push(`${albumFolderPath}/${image.name}`);
        }
        continue;
      }

      const folderHandle = await ensureDirectory(folderPath, true);
      for (const image of [entry]) {
        if (!image.file) {
          continue;
        }
        const fileHandle = await folderHandle.getFileHandle(image.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(await image.file.arrayBuffer());
        await writable.close();
        savedPaths.push(`${folderPath}/${image.name}`);
      }
    }

    return savedPaths;
  }

  function resetEditorForNewPost() {
    titleInput.value = "";
    slugInput.value = "";
    slugInput.dataset.touched = "";
    dateInput.value = new Date().toISOString().slice(0, 10);
    publishedInput.checked = true;
    summaryInput.value = "";
    tagsInput.value = "";
    navSectionInput.value = "posts";
    editor.innerHTML = "<p></p>";
    pendingImages = [];
    existingImages = [];
    loadedPostRef = null;
    heroImagePath = "";
    loadedPostLabel.textContent = "loaded: new post";
    clearSavedDraft();
    updateDraftBanner();
    cleanupEditorMarkup();
    renderImageList();
    renderPreview();
  }

  async function removeFileIfExists(path) {
    try {
      const parts = path.split("/").filter(Boolean);
      const fileName = parts.pop();
      const directory = await ensureDirectory(parts.join("/"), false);
      await directory.removeEntry(fileName);
    } catch {
    }
  }

  async function removeDirectoryIfExists(path) {
    try {
      const parts = path.split("/").filter(Boolean);
      const dirName = parts.pop();
      const parent = await ensureDirectory(parts.join("/"), false);
      await parent.removeEntry(dirName, { recursive: true });
    } catch {
    }
  }

  async function deleteLoadedPost() {
    const item = loadedPostRef && loadedPostRef.item;
    if (!item) {
      throw new Error("No post is currently loaded.");
    }

    const confirmed = window.confirm(`Delete ${item.title} and its saved media? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    contentIndexCache = contentIndexCache || await readJson("data/content-index.json");
    contentIndexCache.posts = (contentIndexCache.posts || []).filter((entry) => entry.slug !== item.slug);

    await removeFileIfExists(item.path || `posts/${item.slug}.html`);
    await removeDirectoryIfExists(`images/${item.slug}`);
    await writeTextFile("data/content-index.json", JSON.stringify(contentIndexCache, null, 2) + "\n");
    await writeTextFile("posts.html", renderIndexPage(contentIndexCache.posts || []));
    await writeTextFile("index.html", await renderHomePageFromLocal(contentIndexCache.posts || []));

    resetEditorForNewPost();
    setStatus(`Deleted posts/${item.slug}.html, removed images/${item.slug}/, and updated the site index.`);
  }

  async function readJson(path) {
    const file = await getFileHandle(path, false).then((handle) => handle.getFile());
    const parsed = JSON.parse(await file.text());
    return path === "data/content-index.json" ? normalizeContentIndex(parsed) : parsed;
  }

  async function readTextFile(path) {
    const file = await getFileHandle(path, false).then((handle) => handle.getFile());
    return file.text();
  }

  async function writeTextFile(path, contents) {
    const handle = await getFileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  async function getFileHandle(path, create) {
    const parts = path.split("/");
    const fileName = parts.pop();
    const directory = await ensureDirectory(parts.join("/"), create);
    return directory.getFileHandle(fileName, { create: Boolean(create) });
  }

  async function ensureDirectory(path, create) {
    const parts = path ? path.split("/").filter(Boolean) : [];
    let current = repoHandle;

    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: Boolean(create) });
    }

    return current;
  }

  async function buildCurrentItem() {
    const title = titleInput.value.trim();
    const slug = slugify(slugInput.value.trim() || title);
    const date = dateInput.value;
    const published = publishedInput.checked;
    const summary = summaryInput.value.trim();
    const tags = tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
    const navSection = navSectionInput.value.trim() || "posts";
    const bodyHtml = safeBodyHtml();
    const heroAsset = await resolveHeroAsset({ slug, forPreview: true });
    const image = heroAsset.image || "";

    return {
      slug,
      title: title || "Untitled Post",
      date: date || new Date().toISOString().slice(0, 10),
      published,
      summary: summary || "Preview summary.",
      tags,
      image,
      heroSource: heroAsset.heroSource,
      heroBlurb: getHeroImageBlurb(heroAsset.heroSource || image),
      path: `posts/${slug || "untitled_post"}.html`,
      navSection,
      bodyHtml
    };
  }

  function safeBodyHtml() {
    const cleaned = sanitizeEditorHtml(editor.innerHTML || "<p></p>");
    return cleaned.trim() || "<p></p>";
  }

  async function renderPreview() {
    if (!previewDrawer.classList.contains("open")) {
      return;
    }
    try {
      previewScrollY = previewFrame.contentWindow ? previewFrame.contentWindow.scrollY : previewScrollY;
    } catch {
    }

    const renderVersion = ++previewRenderVersion;
    const item = await buildCurrentItem();
    const templatePath = await resolvePreviewTemplatePath(item);
    if (renderVersion !== previewRenderVersion) {
      return;
    }

    if (!templatePath) {
      previewFrame.dataset.ready = "false";
      previewFrame.dataset.templatePath = "";
      previewFrame.srcdoc = "<!DOCTYPE html><html lang=\"en\"><body style=\"margin:0;background:#000;color:#fff;font-family:Consolas,monospace;padding:1rem;\">Pick the website folder and make sure there is at least one post page in <code>posts/</code> to use the local preview shell.</body></html>";
      return;
    }

    const previewDocument = previewFrame.contentDocument;
    if (previewFrame.dataset.ready === "true" &&
        previewFrame.dataset.templatePath === templatePath &&
        previewDocument &&
        previewDocument.getElementById("previewBody")) {
      updatePreviewDocument(previewDocument, item);
      try {
        previewFrame.contentWindow.scrollTo(0, previewScrollY);
      } catch {
      }
      return;
    }

    const templateHtml = await readTextFile(templatePath);
    if (renderVersion !== previewRenderVersion) {
      return;
    }

    const templateDocument = new DOMParser().parseFromString(templateHtml, "text/html");
    updatePreviewDocument(templateDocument, item);

    previewFrame.dataset.ready = "false";
    previewFrame.dataset.templatePath = templatePath;
    previewFrame.srcdoc = serializeDocument(templateDocument);
  }

  function queuePersistAndPreview() {
    queueDraftSave();
    queuePreviewRender();
  }

  function queueDraftSave() {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraftState()));
      updateDraftBanner();
    }, 350);
  }

  function queuePreviewRender() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      renderPreview();
    }, 150);
  }

  function collectDraftState() {
    return {
      title: titleInput.value,
      slug: slugInput.value,
      date: dateInput.value,
      published: publishedInput.checked,
      summary: summaryInput.value,
      tags: tagsInput.value,
      navSection: navSectionInput.value,
      bodyHtml: sanitizeEditorHtml(editor.innerHTML),
      heroImagePath,
      loadedPostSlug: loadedPostRef ? loadedPostRef.item.slug : ""
    };
  }

  function updateDraftBanner() {
    restoreBanner.classList.toggle("visible", Boolean(loadSavedDraft()));
  }

  async function restoreDraft() {
    const draft = loadSavedDraft();
    if (!draft) {
      return;
    }

    titleInput.value = draft.title || "";
    slugInput.value = draft.slug || "";
    slugInput.dataset.touched = draft.slug ? "true" : "";
    dateInput.value = draft.date || new Date().toISOString().slice(0, 10);
    publishedInput.checked = draft.published !== false;
    summaryInput.value = draft.summary || "";
    tagsInput.value = draft.tags || "";
    navSectionInput.value = draft.navSection || "posts";
    editor.innerHTML = sanitizeEditorHtml(draft.bodyHtml || "<p></p>");
    heroImagePath = draft.heroImagePath || "";
    pendingImages = await loadAlbumsFromEditorBody();
    pendingImages.filter((entry) => entry.kind === "album").forEach(updateAlbumInDocument);

    if (repoHandle && draft.loadedPostSlug) {
      contentIndexCache = contentIndexCache || await readJson("data/content-index.json");
      const match = (contentIndexCache.posts || []).find((item) => item.slug === draft.loadedPostSlug);
      if (match) {
        loadedPostRef = { item: match };
        existingImages = await loadExistingImages(match);
        loadedPostLabel.textContent = `loaded: ${match.slug}`;
      }
    } else {
      loadedPostRef = null;
      existingImages = [];
      loadedPostLabel.textContent = "loaded: draft";
    }

    cleanupEditorMarkup();
    renderImageList();
    renderPreview();
    restoreBanner.classList.remove("visible");
    setStatus("Draft restored. Unsaved image files need to be re-added manually.");
  }

  function clearSavedDraft() {
    window.localStorage.removeItem(DRAFT_KEY);
  }

  function loadSavedDraft() {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function openPostPicker(results) {
    postPickerModal.classList.add("open");
    postPickerModal.setAttribute("aria-hidden", "false");
    postSearchInput.value = "";
    renderSearchResults(results);
    window.setTimeout(() => postSearchInput.focus(), 0);
  }

  function closePostPicker() {
    postPickerModal.classList.remove("open");
    postPickerModal.setAttribute("aria-hidden", "true");
  }

  function buildSearchResults(query) {
    const normalized = query.trim().toLowerCase();
    const allPosts = (contentIndexCache.posts || [])
      .map((item) => ({ item }))
      .sort((a, b) => new Date(b.item.date) - new Date(a.item.date));

    return allPosts.filter(({ item }) => {
      if (!normalized) {
        return true;
      }
      return `${item.title} ${item.slug} ${item.date}`.toLowerCase().includes(normalized);
    });
  }

  function renderSearchResults(results) {
    postSearchResults.innerHTML = "";

    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No matching posts.";
      postSearchResults.appendChild(empty);
      return;
    }

    results.forEach(({ item }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "modal-item";
      button.title = `Load ${item.title}`;
      const visibility = item.published === false ? "unpublished" : "published";
      button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><small>post | ${escapeHtml(item.slug)} | ${escapeHtml(item.date)} | ${escapeHtml(visibility)}</small>`;
      button.addEventListener("click", async () => {
        await loadPostIntoEditor(item);
        closePostPicker();
        setStatus(`Loaded ${item.path} for editing.`);
      });
      postSearchResults.appendChild(button);
    });
  }

  function updateDocumentImageCaptions(relativePath, blurb) {
    editor.querySelectorAll(`figure.post-image img[src="${cssEscape(relativePath)}"], figure.post-image video[src="${cssEscape(relativePath)}"]`).forEach((media) => {
      const figure = media.closest("figure");
      let caption = figure.querySelector("figcaption");
      if (blurb) {
        if (!caption) {
          caption = document.createElement("figcaption");
          figure.appendChild(caption);
        }
        caption.textContent = blurb;
      } else if (caption) {
        caption.remove();
      }
    });
  }

  function removeImageFromDocument(relativePath) {
    editor.querySelectorAll(`figure.post-image img[src="${cssEscape(relativePath)}"], figure.post-image video[src="${cssEscape(relativePath)}"]`).forEach((media) => {
      const figure = media.closest("figure");
      if (figure) {
        figure.remove();
      }
    });
  }

  function removeAlbumFromDocument(albumId) {
    if (!albumId) {
      return;
    }
    editor.querySelectorAll(`figure.post-album[data-album-id="${cssEscape(albumId)}"]`).forEach((figure) => {
      figure.remove();
    });
  }

  function updateAlbumInDocument(album) {
    if (!album || !album.id || !album.images.length) {
      return;
    }

    const currentIndex = Math.min(album.currentIndex, album.images.length - 1);
    const currentImage = album.images[currentIndex];
    const items = album.images.map((image) => ({
      src: `../${image.relativePath}`,
      alt: image.blurb || titleInput.value.trim() || image.name,
      blurb: image.blurb || ""
    }));

    editor.querySelectorAll(`figure.post-album[data-album-id="${cssEscape(album.id)}"]`).forEach((figure) => {
      figure.setAttribute("data-album-name", album.name || "album");
      figure.setAttribute("data-index", String(currentIndex));

      const displayImage = figure.querySelector(".post-album-image");
      if (displayImage) {
        displayImage.setAttribute("src", `../${currentImage.relativePath}`);
        displayImage.setAttribute("alt", currentImage.blurb || titleInput.value.trim() || currentImage.name);
      }

      const caption = figure.querySelector(".post-album-caption");
      if (caption) {
        caption.textContent = currentImage.blurb || "";
      }

      const prev = figure.querySelector(".album-nav.prev");
      const next = figure.querySelector(".album-nav.next");
      if (prev) {
        prev.disabled = currentIndex === 0;
      }
      if (next) {
        next.disabled = currentIndex === album.images.length - 1;
      }

      const dataContainer = figure.querySelector(".album-data");
      if (dataContainer) {
        dataContainer.innerHTML = items.map((item) => `<span class="album-item" data-src="${escapeAttribute(item.src)}" data-alt="${escapeAttribute(item.alt)}" data-blurb="${escapeAttribute(item.blurb)}"></span>`).join("");
      }
    });
  }

  function chooseFallbackHero() {
    heroImagePath = getFirstHeroCandidatePath() || "";
  }

  function getFirstPendingImage() {
    for (const entry of pendingImages) {
      if (entry.kind === "album") {
        if (entry.images && entry.images.length) {
          return entry.images[0];
        }
        continue;
      }
      if (entry.relativePath) {
        return entry;
      }
    }
    return null;
  }

  function getFirstHeroCandidatePath() {
    const firstExistingHero = existingImages.find((entry) => entry.mediaKind !== "video" && entry.relativePath);
    if (firstExistingHero) {
      return firstExistingHero.relativePath.slice(3);
    }

    for (const entry of pendingImages) {
      if (entry.kind === "album") {
        if (entry.images && entry.images.length) {
          return entry.images[0].relativePath;
        }
        continue;
      }
      if (entry.mediaKind !== "video" && entry.relativePath) {
        return entry.relativePath;
      }
    }

    return "";
  }

  function getAllImageEntries() {
    const flattenedPending = pendingImages.flatMap((entry) => entry.kind === "album" ? entry.images : [entry]);
    return existingImages.concat(flattenedPending);
  }

  function makeEntryId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function applyBlockAlignment(alignment) {
    const blocks = getSelectedBlocks();
    blocks.forEach((block) => {
      block.classList.remove("align-left", "align-center");
      block.classList.add(alignment === "center" ? "align-center" : "align-left");
    });
  }

  function getSelectedBlocks() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return [getBlockAncestor(editor)];
    }

    const range = selection.getRangeAt(0);
    const blocks = new Set();
    const candidates = editor.querySelectorAll("p, h1, h2, h3, li, blockquote");

    candidates.forEach((node) => {
      if (range.intersectsNode(node)) {
        blocks.add(node);
      }
    });

    if (!blocks.size) {
      blocks.add(getBlockAncestor(range.startContainer));
    }

    return Array.from(blocks).filter(Boolean);
  }

  function getBlockAncestor(node) {
    let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && current !== editor) {
      if (/^(P|H1|H2|H3|LI|BLOCKQUOTE)$/.test(current.tagName)) {
        return current;
      }
      current = current.parentElement;
    }
    return editor.querySelector("p") || editor;
  }

  function getSelectedMediaFigure() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    let current = selection.getRangeAt(0).startContainer;
    current = current && current.nodeType === Node.TEXT_NODE ? current.parentElement : current;
    while (current && current !== editor) {
      if (current.matches && current.matches("figure.post-image, figure.post-album")) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function insertParagraphAfterFigure(figure) {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";
    figure.insertAdjacentElement("afterend", paragraph);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  }

  function renderIndexPage(items) {
    const visibleItems = items.filter((item) => item.published !== false);
    const title = "Posts | highbypassfan";
    const listId = "postList";
    const cardClass = "post-card";
    const listClass = "post-list";
    const dateClass = "post-date";
    const metaClass = "post-meta";
    const cards = visibleItems.map((item) => {
      const meta = (item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
      const mediaMarkup = item.image
        ? renderMediaMarkup({ path: item.image, alt: item.title, mediaKind: getMediaKindFromPath(item.image) || "image", className: "post-card-media", muted: true })
        : '<div class="post-card-media post-card-media-empty" aria-hidden="true"></div>';
      return `      <a class="${cardClass}" href="${escapeAttribute(item.path)}" data-date="${escapeAttribute(item.date)}">
        ${mediaMarkup}
        <div>
          <div class="${dateClass}">${escapeHtml(item.date)}</div>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.summary)}</p>
          <div class="${metaClass}">
            ${meta}
          </div>
        </div>
      </a>`;
    }).join("\n\n");
    const emptyState = cards ? "" : "      <p class=\"hint\">No posts published yet.</p>";

return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${title}</title>
  <link rel="icon" type="image/jpeg" href="pfp.jpg" />
  <link rel="stylesheet" href="assets/site-shell.css" />
  <script defer src="assets/site-shell.js"></script>
</head>
<body class="site-posts">
  <div data-site-nav data-nav-prefix="" data-nav-section="posts"></div>

  <main class="page">
    <div class="list-header">
      <button class="sort-toggle" id="sortToggle" type="button" aria-label="Toggle post order">^</button>
    </div>

    <section class="${listClass}" id="${listId}">
${cards || emptyState}
    </section>
  </main>

  <script>
    const list = document.getElementById("${listId}");
    const sortToggle = document.getElementById("sortToggle");
    let newestFirst = true;

    function sortItems() {
      const cards = Array.from(list.children);
      cards.sort((a, b) => {
        const aDate = new Date(a.dataset.date);
        const bDate = new Date(b.dataset.date);
        return newestFirst ? bDate - aDate : aDate - bDate;
      });
      cards.forEach((card) => list.appendChild(card));
      sortToggle.textContent = newestFirst ? "^" : "v";
    }

    sortToggle.addEventListener("click", () => {
      newestFirst = !newestFirst;
      sortItems();
    });

    sortItems();
  </script>
</body>
</html>
`;
  }

  function renderPostPage(item) {
    const metaLine = [item.date].concat(item.tags || []).join(" | ");
    const heroPath = item.image ? (item.image.startsWith("../") ? item.image : `../${item.image}`) : "";
    const navSection = getNavSection(item);
    const heroBlurb = (item.heroBlurb || "").trim();
    const heroKind = heroPath ? (getMediaKindFromPath(heroPath) || "image") : "";

return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${escapeHtml(item.title)}</title>
  <link rel="icon" type="image/jpeg" href="../pfp.jpg" />
  <link rel="stylesheet" href="../assets/site-shell.css" />
  <script defer src="../assets/site-shell.js"></script>
</head>
<body class="site-post-page">
  <div data-site-nav data-nav-prefix="../" data-nav-section="${navSection}"></div>
  <main class="page">
    <div class="eyebrow" id="previewMeta">${escapeHtml(metaLine)}</div>
    <h1 id="previewTitle">${escapeHtml(item.title)}</h1>
    <p class="deck" id="previewDeck">${escapeHtml(item.summary)}</p>
    ${heroPath ? `<figure class="hero-figure" id="previewHeroFigure">
      ${renderMediaMarkup({ path: heroPath, alt: item.title, mediaKind: heroKind, className: heroKind === "video" ? "hero hero-video" : "hero", id: "previewHero", muted: heroKind === "video" })}${heroBlurb ? `
      <figcaption class="hero-caption" id="previewHeroCaption">${escapeHtml(heroBlurb)}</figcaption>` : ""}
    </figure>` : ""}
    <div class="post-body" id="previewBody">
      ${item.bodyHtml}
    </div>
  </main>
</body>
</html>
`;
  }

  function updatePreviewDocument(previewDocument, item) {
    const metaLine = [item.date].concat(item.tags || []).join(" | ");
    const heroPath = item.image ? (item.image.startsWith("../") ? item.image : `../${item.image}`) : "";
    const navSection = getNavSection(item);
    const heroKind = heroPath ? (getMediaKindFromPath(heroPath) || "image") : "";

    const meta = previewDocument.getElementById("previewMeta") || previewDocument.querySelector(".eyebrow");
    const title = previewDocument.getElementById("previewTitle") || previewDocument.querySelector("h1");
    const deck = previewDocument.getElementById("previewDeck") || previewDocument.querySelector(".deck");
    const heroFigure = previewDocument.getElementById("previewHeroFigure") || previewDocument.querySelector(".hero-figure");
    const body = previewDocument.getElementById("previewBody") || previewDocument.querySelector(".post-body");
    const navRoot = previewDocument.querySelector("[data-site-nav]");

    previewDocument.title = `${item.title}`;

    if (meta) {
      meta.id = "previewMeta";
      meta.textContent = metaLine;
    }
    if (title) {
      title.id = "previewTitle";
      title.textContent = item.title;
    }
    if (deck) {
      deck.id = "previewDeck";
      deck.textContent = item.summary;
    }
    if (heroFigure) {
      heroFigure.id = "previewHeroFigure";
      const heroBlurb = (item.heroBlurb || "").trim();
      if (heroPath) {
        heroFigure.innerHTML = `${renderMediaMarkup({ path: heroPath, alt: item.title, mediaKind: heroKind, className: heroKind === "video" ? "hero hero-video" : "hero", id: "previewHero", muted: heroKind === "video" })}${heroBlurb ? `<figcaption class="hero-caption" id="previewHeroCaption">${escapeHtml(heroBlurb)}</figcaption>` : ""}`;
      } else {
        heroFigure.remove();
      }
    }
    if (body) {
      body.id = "previewBody";
      body.innerHTML = item.bodyHtml;
    }
    if (navRoot) {
      navRoot.dataset.navSection = navSection;
      if (previewDocument.defaultView && typeof previewDocument.defaultView.renderSiteNav === "function") {
        previewDocument.defaultView.renderSiteNav(navRoot);
      }
    }
    if (previewDocument.defaultView && typeof previewDocument.defaultView.initializePostAlbums === "function") {
      previewDocument.defaultView.initializePostAlbums();
    }
    if (previewDocument.defaultView && typeof previewDocument.defaultView.initializeImageLightbox === "function") {
      previewDocument.defaultView.initializeImageLightbox();
    }
  }

  function getNavSection(item) {
    if (!item) {
      return "posts";
    }
    if (item.navSection === "reading list" || item.slug === "reading_list") {
      return "reading-list";
    }
    return item.navSection === "engineering tips" || item.slug === "engineering_tips"
      ? "engineering-tips"
      : "posts";
  }

  function getHeroImageBlurb(heroPath) {
    if (!heroPath) {
      return "";
    }

    const normalizedHeroPath = heroPath.replace(/^\.?\.\//, "");
    const heroFileName = normalizedHeroPath.split("/").pop();
    const entries = getAllImageEntries();

    for (const entry of entries) {
      const entryPath = entry.relativePath.replace(/^\.?\.\//, "");
      if (entryPath === normalizedHeroPath || entryPath.replace(/^\.\.\//, "") === normalizedHeroPath) {
        return (entry.blurb || "").trim();
      }
      if (heroFileName && entry.name === heroFileName) {
        return (entry.blurb || "").trim();
      }
    }

    return loadedPostRef && loadedPostRef.item && loadedPostRef.item.image === normalizedHeroPath
      ? ((loadedPostRef.item.heroBlurb || "").trim())
      : "";
  }

  async function resolvePreviewTemplatePath(item) {
    if (!repoHandle) {
      return null;
    }

    const candidates = [];
    if (loadedPostRef && loadedPostRef.item && loadedPostRef.item.path) {
      candidates.push(loadedPostRef.item.path);
    }
    if (item && item.path) {
      candidates.push(item.path);
    }
    if (contentIndexCache && Array.isArray(contentIndexCache.posts)) {
      contentIndexCache.posts.forEach((entry) => {
        if (entry && entry.path) {
          candidates.push(entry.path);
        }
      });
    }

    for (const candidate of [...new Set(candidates)]) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  async function fileExists(path) {
    try {
      await getFileHandle(path, false);
      return true;
    } catch {
      return false;
    }
  }

  function serializeDocument(doc) {
    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
    return `${doctype}\n${doc.documentElement.outerHTML}`;
  }

  async function renderHomePageFromLocal(items) {
    const templateHtml = await readTextFile("index.html");
    const templateDocument = new DOMParser().parseFromString(templateHtml, "text/html");
    updateHomePageDocument(templateDocument, items);
    return serializeDocument(templateDocument);
  }

  function updateHomePageDocument(doc, items) {
    const visibleItems = items
      .filter((item) => item.published !== false)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const existingGrid = doc.querySelector(".grid");
    const existingEmptyState = doc.querySelector(".empty-state");
    const introSection = doc.querySelector(".intro");
    const insertionPoint = existingGrid || existingEmptyState;

    if (existingGrid) {
      existingGrid.innerHTML = "";
    }
    if (existingEmptyState) {
      existingEmptyState.remove();
    }

    if (visibleItems.length) {
      const grid = existingGrid || doc.createElement("div");
      grid.className = "grid";
      grid.innerHTML = visibleItems.map((item) => `    <div class="cell img-cell">
      ${item.image
        ? renderMediaMarkup({ path: item.image, alt: item.title, mediaKind: getMediaKindFromPath(item.image) || "image", className: "home-card-media", muted: true })
        : '<div class="home-card-media home-card-media-empty" aria-hidden="true"></div>'}
      <div class="overlay-title">${escapeHtml(item.title)}</div>
      <div class="overlay-desc">${escapeHtml(item.summary)}</div>
      <a href="${escapeAttribute(item.path)}" aria-label="${escapeAttribute(item.title)}"></a>
    </div>`).join("\n\n");

      if (!existingGrid) {
        if (insertionPoint) {
          insertionPoint.replaceWith(grid);
        } else if (introSection) {
          introSection.insertAdjacentElement("afterend", grid);
        } else if (doc.body) {
          doc.body.appendChild(grid);
        }
      }
      return;
    }

    if (existingGrid) {
      existingGrid.remove();
    }

    const emptyState = doc.createElement("section");
    emptyState.className = "empty-state";
    emptyState.innerHTML = `
    <div class="empty-card">
      <h2>No Posts Live Right Now</h2>
      <p>The published post archive has been cleared for now.</p>
      <p>You can still use the editor to make new ones, and they will show up on <a href="posts.html">the posts page</a> when you publish them.</p>
    </div>`;

    if (insertionPoint) {
      insertionPoint.replaceWith(emptyState);
    } else if (introSection) {
      introSection.insertAdjacentElement("afterend", emptyState);
    } else if (doc.body) {
      doc.body.appendChild(emptyState);
    }
  }

  function normalizeBodyHtml(html) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();

    if (!wrapper.innerHTML.trim()) {
      throw new Error("Body content is empty.");
    }

    wrapper.querySelectorAll("script, style").forEach((node) => node.remove());
    wrapper.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
    wrapper.querySelectorAll("a[href]").forEach((node) => {
      const normalizedHref = normalizeExternalUrl(node.getAttribute("href"));
      if (normalizedHref) {
        node.setAttribute("href", normalizedHref);
      }
    });
    wrapper.querySelectorAll("span").forEach((node) => {
      if (!node.attributes.length) {
        node.replaceWith(...node.childNodes);
      }
    });
    wrapper.querySelectorAll("div").forEach((node) => {
      if (node.closest("figure")) {
        return;
      }
      const paragraph = document.createElement("p");
      paragraph.innerHTML = node.innerHTML;
      node.replaceWith(paragraph);
    });

    wrapper.querySelectorAll("p figure.post-image").forEach((figure) => {
      const paragraph = figure.parentElement;
      paragraph.replaceWith(figure);
    });

    return wrapper.innerHTML;
  }

  function sanitizeEditorHtml(html) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    wrapper.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
    wrapper.querySelectorAll("a[href]").forEach((node) => {
      const normalizedHref = normalizeExternalUrl(node.getAttribute("href"));
      if (normalizedHref) {
        node.setAttribute("href", normalizedHref);
      }
    });
    wrapper.querySelectorAll(".align-left").forEach((node) => {
      if (node.tagName === "P" && !node.textContent.trim()) {
        node.classList.remove("align-left");
      }
    });
    wrapper.querySelectorAll("span").forEach((node) => {
      if (!node.attributes.length) {
        node.replaceWith(...node.childNodes);
      }
    });
    return wrapper.innerHTML;
  }

  function cleanupEditorMarkup() {
    editor.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
    editor.querySelectorAll("span").forEach((node) => {
      if (!node.attributes.length) {
        node.replaceWith(...node.childNodes);
      }
    });
    editor.querySelectorAll("p figure.post-image").forEach((figure) => {
      const paragraph = figure.parentElement;
      paragraph.replaceWith(figure);
    });
    editor.querySelectorAll("p figure.post-album").forEach((figure) => {
      const paragraph = figure.parentElement;
      paragraph.replaceWith(figure);
    });
  }

  function getPendingImagePath(fileName, albumName = "") {
    const slug = slugify(slugInput.value.trim() || titleInput.value.trim());
    const baseFolder = slug ? `images/${slug}` : "images/untitled_post";
    const albumSegment = albumName ? `/${sanitizeFileName(albumName)}` : "";
    return `${baseFolder}${albumSegment}/${fileName}`;
  }

  function refreshPendingImagePaths() {
    pendingImages = pendingImages.map((entry) => {
      if (entry.kind === "album") {
        return {
          ...entry,
          images: entry.images.map((image) => {
            const nextPath = getPendingImagePath(image.name, entry.name);
            if (heroImagePath === image.relativePath) {
              heroImagePath = nextPath;
            }
            return {
              ...image,
              relativePath: nextPath
            };
          })
        };
      }

      const nextPath = getPendingImagePath(entry.name);
      if (heroImagePath === entry.relativePath) {
        heroImagePath = nextPath;
      }
      return {
        ...entry,
        relativePath: nextPath
      };
    });
    renderImageList();
  }

  function resolveHeroImagePath(slug) {
    if (!heroImagePath) {
      return "";
    }

    if (heroImagePath.startsWith("images/")) {
      const parts = heroImagePath.split("/");
      if (parts.length >= 3) {
        return heroImagePath.includes("/temp/") ? heroImagePath : heroImagePath.replace(/^images\/[^/]+\//, `images/${slug}/`);
      }
    }

    return heroImagePath;
  }

  function isHeroPath(path) {
    return Boolean(path) && (path === heroImagePath || path.slice(3) === heroImagePath);
  }

  function getExistingImageCaptions() {
    const captions = {};
    editor.querySelectorAll("figure.post-image").forEach((figure) => {
      const media = figure.querySelector("img, video");
      if (!media) {
        return;
      }
      const caption = figure.querySelector("figcaption");
      captions[media.getAttribute("src")] = caption ? caption.textContent.trim() : "";
    });
    return captions;
  }

  async function initializeSavedRepoHandle() {
    try {
      const savedHandle = await loadRepoHandle();
      if (!savedHandle) {
        return;
      }

      const permission = await savedHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        setStatus("Saved website folder found. Click pick website folder if Chrome asks for access again.");
        return;
      }

      await savedHandle.getFileHandle("index.html");
      repoHandle = savedHandle;
      contentIndexCache = await readJson("data/content-index.json");
      saveLastRepoName(savedHandle.name);
      updateRepoButtonLabel(savedHandle.name);
      setStatus("Reconnected to the last website folder automatically.");
    } catch {
      setStatus("Saved website folder could not be reopened automatically. Click pick website folder to reconnect.");
    }
  }

  function saveLastRepoName(name) {
    window.localStorage.setItem(LAST_REPO_NAME_KEY, name);
  }

  function loadLastRepoName() {
    const name = window.localStorage.getItem(LAST_REPO_NAME_KEY);
    if (name) {
      updateRepoButtonLabel(name);
    }
  }

  function updateRepoButtonLabel(name) {
    pickRepoButton.textContent = name ? `website folder: ${name}` : "pick website folder";
  }

  function openHandleDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("static-post-editor", 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("handles");
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function saveRepoHandle(handle) {
    const db = await openHandleDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore("handles").put(handle, "repo");
    });
    db.close();
  }

  async function loadRepoHandle() {
    const db = await openHandleDatabase();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readonly");
      const request = tx.objectStore("handles").get("repo");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function cssEscape(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function normalizeExternalUrl(value) {
    if (!value) {
      return "";
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return "";
    }

    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("../") ||
      trimmed.startsWith("./")
    ) {
      return trimmed;
    }

    return `https://${trimmed}`;
  }

  function normalizeContentIndex(contentIndex) {
    const merged = [
      ...(contentIndex.posts || []),
      ...(contentIndex.articles || []),
      ...(contentIndex.projects || [])
    ].map((item) => ({
      ...item,
      published: item.published !== false,
      path: normalizePostPath(item.path, item.slug),
      navSection: item.navSection === "reading list" || item.slug === "reading_list"
        ? "reading list"
        : item.navSection === "engineering tips" || item.slug === "engineering_tips"
          ? "engineering tips"
          : "posts"
    }));

    const seen = new Set();
    const posts = merged.filter((item) => {
      const key = item.slug || item.path;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    return { posts };
  }

  function normalizePostPath(path, slug) {
    const fileName = path ? path.split("/").pop() : `${slug || "untitled_post"}.html`;
    return `posts/${fileName}`;
  }

  function setStatus(message, isError) {
    status.innerHTML = isError ? `<strong>${escapeHtml(message)}</strong>` : escapeHtml(message);
  }
})();
