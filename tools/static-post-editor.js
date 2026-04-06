(function () {
  const DRAFT_KEY = "static-post-editor-draft-v1";
  const LAST_REPO_NAME_KEY = "static-post-editor-last-repo-name";
  const pickRepoButton = document.getElementById("pickRepo");
  const selectPostButton = document.getElementById("selectPost");
  const generateButton = document.getElementById("generate");
  const imagePicker = document.getElementById("imagePicker");
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      generateButton.click();
    }
  });

  imagePicker.addEventListener("change", () => {
    appendImages(Array.from(imagePicker.files || []));
    imagePicker.value = "";
  });

  document.addEventListener("paste", (event) => {
    if (!dropzone.contains(event.target) && !editor.contains(event.target)) {
      return;
    }

    const files = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith("image/"));
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
      const resolvedHero = resolveHeroImagePath(slug);
      const heroImage = resolvedHero || savedImages[0] || existingHero || "temp/Bend_Lines.jfif";

      const item = {
        slug,
        title,
        date,
        published,
        summary,
        tags,
        image: heroImage,
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
      pendingImages = [];
      existingImages = await loadExistingImages(item);
      clearSavedDraft();
      updateDraftBanner();
      renderImageList();
      renderPreview();
      const savedAt = new Date().toLocaleString();
      const visibilityLine = published
        ? "Published on posts.html"
        : "Unpublished from posts.html";
      setStatus(`Saved ${pagePath}\nSaved at ${savedAt}\n${visibilityLine}\nUpdated data/content-index.json\nUpdated posts.html and index.html\nSaved ${savedImages.length} new image(s) in ${imagesFolder}/`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });

  function appendImages(files) {
    pendingImages = pendingImages.concat(
      files.map((file) => ({
        file,
        name: sanitizeFileName(file.name || `image-${pendingImages.length + 1}.png`),
        blurb: "",
        relativePath: getPendingImagePath(sanitizeFileName(file.name || `image-${pendingImages.length + 1}.png`))
      }))
    );
    if (!heroImagePath && pendingImages.length) {
      heroImagePath = pendingImages[0].relativePath;
    }
    renderImageList();
    queuePersistAndPreview();
  }

  function renderImageList() {
    imageList.innerHTML = "";

    existingImages.forEach((entry) => {
      imageList.appendChild(buildImageRow({
        entry,
        onHero: () => {
          heroImagePath = entry.relativePath.slice(3);
          renderImageList();
          queuePersistAndPreview();
        },
        onInsert: () => insertImageFigure(entry.name, entry.blurb, entry.relativePath),
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
      imageList.appendChild(buildImageRow({
        entry,
        onHero: () => {
          heroImagePath = entry.relativePath;
          renderImageList();
          queuePersistAndPreview();
        },
        onInsert: () => insertImageFigure(entry.name, entry.blurb, `../${entry.relativePath}`),
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

  function buildImageRow({ entry, onHero, onInsert, onCaption, onRemove }) {
    const row = document.createElement("div");
    row.className = "image-item";

    const details = document.createElement("div");
    details.className = "image-item-main";

    const name = document.createElement("div");
    name.textContent = entry.name;

    const blurbInput = document.createElement("input");
    blurbInput.type = "text";
    blurbInput.placeholder = "optional blurb below image";
    blurbInput.value = entry.blurb || "";
    blurbInput.title = "Optional caption or blurb shown below inserted images";
    blurbInput.addEventListener("input", () => {
      onCaption(blurbInput.value);
    });

    details.append(name, blurbInput);

    const actions = document.createElement("div");
    actions.className = "image-item-actions";

    const hero = document.createElement("button");
    hero.type = "button";
    hero.textContent = "H";
    hero.title = "Set this image as the page hero image";
    hero.className = `hero-toggle${isHeroPath(entry.relativePath) ? " active" : ""}`;
    hero.addEventListener("click", onHero);

    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = "insert";
    insert.title = "Insert this image into the document body as a centered figure";
    insert.addEventListener("click", onInsert);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "remove";
    remove.title = "Remove this image from the editor and delete it from the post folder if it already exists";
    remove.addEventListener("click", onRemove);

    actions.append(hero, insert, remove);
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

  function insertImageFigure(fileName, blurb, relativePath) {
    const slug = slugify(slugInput.value.trim() || titleInput.value.trim());
    if (!slug && !relativePath) {
      setStatus("Set the title or slug before inserting an image.", true);
      return;
    }

    const alt = blurb || titleInput.value.trim() || fileName;
    const path = relativePath || `../images/${slug}/${fileName}`;
    const figureHtml = `<p></p><figure class="post-image"><img src="${escapeAttribute(path)}" alt="${escapeAttribute(alt)}" />${blurb ? `<figcaption>${escapeHtml(blurb)}</figcaption>` : ""}</figure><p></p>`;
    editor.focus();
    document.execCommand("insertHTML", false, figureHtml);
    cleanupEditorMarkup();
    editor.focus();
    queuePersistAndPreview();
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
    pendingImages = [];
    existingImages = await loadExistingImages(item);
    heroImagePath = item.image || "";
    cleanupEditorMarkup();
    renderImageList();
    renderPreview();
    queueDraftSave();
  }

  async function loadExistingImages(item) {
    if (!repoHandle || !item.image) {
      return [];
    }

    const folderPath = item.image.split("/").slice(0, -1).join("/");
    if (!folderPath.startsWith("images/")) {
      return [];
    }

    const captionMap = getExistingImageCaptions();
    try {
      const folderHandle = await ensureDirectory(folderPath, false);
      const items = [];
      for await (const [name, handle] of folderHandle.entries()) {
        if (handle.kind !== "file") {
          continue;
        }
        items.push({
          name,
          relativePath: `../${folderPath}/${name}`,
          isHero: `${folderPath}/${name}` === item.image,
          blurb: captionMap[`../${folderPath}/${name}`] || ""
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

    const folderHandle = await ensureDirectory(folderPath, true);
    const savedPaths = [];

    for (const image of images) {
      const fileHandle = await folderHandle.getFileHandle(image.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(await image.file.arrayBuffer());
      await writable.close();
      savedPaths.push(`${folderPath}/${image.name}`);
    }

    return savedPaths;
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

  function buildCurrentItem() {
    const title = titleInput.value.trim();
    const slug = slugify(slugInput.value.trim() || title);
    const date = dateInput.value;
    const published = publishedInput.checked;
    const summary = summaryInput.value.trim();
    const tags = tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
    const navSection = navSectionInput.value.trim() || "posts";
    const fallbackImage = loadedPostRef ? loadedPostRef.item.image : "temp/Bend_Lines.jfif";
    const bodyHtml = safeBodyHtml();

    return {
      slug,
      title: title || "Untitled Post",
      date: date || new Date().toISOString().slice(0, 10),
      published,
      summary: summary || "Preview summary.",
      tags,
      image: fallbackImage,
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
    const item = buildCurrentItem();
    const resolvedHero = resolveHeroImagePath(item.slug);
    if (resolvedHero) {
      item.image = resolvedHero;
    }
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
    pendingImages = [];

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
    editor.querySelectorAll(`figure.post-image img[src="${cssEscape(relativePath)}"]`).forEach((image) => {
      const figure = image.closest("figure");
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
    editor.querySelectorAll(`figure.post-image img[src="${cssEscape(relativePath)}"]`).forEach((image) => {
      const figure = image.closest("figure");
      if (figure) {
        figure.remove();
      }
    });
  }

  function chooseFallbackHero() {
    if (existingImages.length) {
      heroImagePath = existingImages[0].relativePath.slice(3);
      return;
    }
    if (pendingImages.length) {
      heroImagePath = pendingImages[0].relativePath;
      return;
    }
    heroImagePath = "";
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

  function renderIndexPage(items) {
    const visibleItems = items.filter((item) => item.published !== false);
    const title = "Posts";
    const listId = "postList";
    const cardClass = "post-card";
    const listClass = "post-list";
    const dateClass = "post-date";
    const metaClass = "post-meta";
    const cards = visibleItems.map((item) => {
      const meta = (item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
      return `      <a class="${cardClass}" href="${escapeAttribute(item.path)}" data-date="${escapeAttribute(item.date)}">
        <img src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.title)}" />
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
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="assets/site-shell.css" />
  <script defer src="assets/site-shell.js"></script>
  <title>${title}</title>
  <style>
    :root {
      --bg: #000;
      --fg: #fff;
      --line: #252525;
      --accent: #ff3b30;
      --muted: #b8b8b8;
    }
    .page { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
    .list-header { display: flex; align-items: center; justify-content: flex-end; margin-bottom: 0.5rem; }
    .sort-toggle {
      appearance: none;
      border: 1px solid var(--line);
      background: #050505;
      color: var(--fg);
      font: inherit;
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .sort-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .${listClass} { display: flex; flex-direction: column; gap: 1rem; }
    .${cardClass} {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 1.25rem;
      padding: 1rem 0;
      border-bottom: 1px solid var(--line);
      align-items: start;
    }
    .${cardClass} img {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      display: block;
      border: 1px solid var(--line);
    }
    .${dateClass} { color: var(--accent); font-size: 0.95rem; margin-bottom: 0.5rem; }
    .${cardClass} h2 { margin: 0 0 0.5rem 0; font-size: 1.4rem; font-weight: normal; }
    .${cardClass} p { margin: 0 0 0.75rem 0; color: var(--muted); line-height: 1.5; }
    .${metaClass} { display: flex; flex-wrap: wrap; gap: 1rem; color: var(--muted); font-size: 0.95rem; }
    .${cardClass}:hover h2 { color: var(--accent); }
    .hint { color: var(--muted); line-height: 1.6; }
    @media (max-width: 700px) {
      .${cardClass} { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
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
    const heroPath = item.image.startsWith("../") ? item.image : `../${item.image}`;
    const navSection = getNavSection(item);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="../assets/site-shell.css" />
  <script defer src="../assets/site-shell.js"></script>
  <title>${escapeHtml(item.title)}</title>
  <style>
    :root { --bg: #000; --fg: #fff; --line: #252525; --accent: #ff3b30; --muted: #b8b8b8; }
    .page { max-width: 900px; margin: 0 auto; padding: 2rem 1rem 4rem; }
    .eyebrow { color: var(--accent); margin-bottom: 0.75rem; font-size: 0.95rem; }
    h1 { margin: 0 0 0.75rem 0; font-size: 2.2rem; font-weight: normal; letter-spacing: 0.04em; }
    .deck { margin: 0 0 1.5rem 0; color: var(--muted); line-height: 1.6; max-width: 70ch; }
    .hero { width: 100%; display: block; border: 1px solid var(--line); margin-bottom: 2rem; background: #050505; }
    .section { padding-top: 1rem; border-top: 1px solid var(--line); margin-top: 1rem; }
    .section h2 { margin: 0 0 0.75rem 0; font-size: 1.25rem; font-weight: normal; color: var(--accent); }
    .post-body p,
    .post-body li { line-height: 1.6; }
    .post-body ul,
    .post-body ol { margin: 0.75rem 0 0 1.25rem; padding: 0; }
    .align-center { text-align: center; }
    .align-left { text-align: left; }
    .post-image {
      width: 100%;
      margin: 2rem auto;
      text-align: center;
    }
    .post-image img {
      display: block;
      max-width: 100%;
      margin: 0 auto;
      border: 1px solid var(--line);
    }
    .post-image figcaption {
      margin-top: 0.65rem;
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div data-site-nav data-nav-prefix="../" data-nav-section="${navSection}"></div>
  <main class="page">
    <div class="eyebrow" id="previewMeta">${escapeHtml(metaLine)}</div>
    <h1 id="previewTitle">${escapeHtml(item.title)}</h1>
    <p class="deck" id="previewDeck">${escapeHtml(item.summary)}</p>
    <img class="hero" id="previewHero" src="${escapeAttribute(heroPath)}" alt="${escapeAttribute(item.title)}" />
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
    const heroPath = item.image.startsWith("../") ? item.image : `../${item.image}`;
    const navSection = getNavSection(item);

    const meta = previewDocument.getElementById("previewMeta") || previewDocument.querySelector(".eyebrow");
    const title = previewDocument.getElementById("previewTitle") || previewDocument.querySelector("h1");
    const deck = previewDocument.getElementById("previewDeck") || previewDocument.querySelector(".deck");
    const hero = previewDocument.getElementById("previewHero") || previewDocument.querySelector(".hero");
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
    if (hero) {
      hero.id = "previewHero";
      hero.setAttribute("src", heroPath);
      hero.setAttribute("alt", item.title);
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
  }

  function getNavSection(item) {
    if (!item) {
      return "posts";
    }
    return item.navSection === "engineering tips" || item.slug === "engineering_tips"
      ? "engineering-tips"
      : "posts";
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
      <img src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.title)}">
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
  }

  function getPendingImagePath(fileName) {
    const slug = slugify(slugInput.value.trim() || titleInput.value.trim());
    return slug ? `images/${slug}/${fileName}` : `images/untitled_post/${fileName}`;
  }

  function refreshPendingImagePaths() {
    pendingImages = pendingImages.map((entry) => {
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
      const image = figure.querySelector("img");
      if (!image) {
        return;
      }
      const caption = figure.querySelector("figcaption");
      captions[image.getAttribute("src")] = caption ? caption.textContent.trim() : "";
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
      navSection: item.navSection === "engineering tips" || item.slug === "engineering_tips"
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
