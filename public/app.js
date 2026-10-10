const categories = ["All", "Productivity", "Development", "Design", "Utilities", "Security", "Other"];
const allowedExtensions = new Set([".exe", ".msi", ".msix", ".dmg", ".pkg", ".zip", ".7z", ".rar", ".tar", ".gz", ".deb", ".rpm", ".appimage", ".apk", ".jar", ".iso"]);
const softwareGrid = document.querySelector("#software-grid");
const emptyState = document.querySelector("#empty-state");
const uploadModal = document.querySelector("#upload-modal");
const uploadForm = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file-input");
const fileDrop = document.querySelector("#file-drop");
const filePrompt = document.querySelector("#file-prompt");
const fileHint = document.querySelector("#file-hint");
const feedback = document.querySelector("#upload-feedback");
let items = [];
let activeCategory = "All";
let searchQuery = "";
let selectedFile = null;
let toastTimeout = 0;

const iconSvgs = {
  Productivity: '<svg viewBox="0 0 24 24"><path d="M6 4h12v16H6zM9 8h6M9 12h6m-6 4h3"/></svg>',
  Development: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14"/></svg>',
  Design: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v8l5.6 5.6M7 12h5"/></svg>',
  Utilities: '<svg viewBox="0 0 24 24"><path d="m14 6 4 4m-9.5 9.5L4 20l.5-4.5L16 4l4 4-11.5 11.5ZM4 4l2 2m12 12 2 2"/></svg>',
  Security: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  Other: '<svg viewBox="0 0 24 24"><path d="M12 3 14.8 9.2 21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z"/></svg>',
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatBytes(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDate(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}

function cardMarkup(item, index) {
  const category = categories.includes(item.category) && item.category !== "All" ? item.category : "Other";
  const title = escapeHtml(item.title || "Untitled software");
  const initials = title.replace(/&amp;/g, "&").split(/\s+/).slice(0, 2).map((word) => word[0] || "").join("").slice(0, 2).toUpperCase();
  const platform = escapeHtml(item.platform || "All platforms");
  const version = escapeHtml(item.version || "1.0");
  const description = escapeHtml(item.description || "A useful tool shared with the community.");
  return `<article class="software-card" style="animation-delay:${Math.min(index * 45, 240)}ms">
    <div class="card-topline"><div class="software-icon tone-${index % 6}">${iconSvgs[category] || initials}</div><span class="card-platform">${platform}</span></div>
    <h3 class="card-title">${title}</h3><p class="card-description">${description}</p>
    <div class="card-footer"><div class="card-meta"><span class="category-label">${escapeHtml(category)}</span><span class="meta-dot">·</span><span>v${version}</span><span class="meta-dot">·</span><span>${formatBytes(item.size)}</span></div>
    <a class="download-button" href="/api/software/${encodeURIComponent(item.id)}/download" download><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7m-2 6h10"/></svg>Download</a></div>
    <div class="card-meta" style="padding-top:10px"><span>${escapeHtml(item.author || "Community")}</span><span class="meta-dot">·</span><span>${Number(item.downloads || 0).toLocaleString()} downloads</span><span class="meta-dot">·</span><span>${formatDate(item.createdAt)}</span></div>
  </article>`;
}

function getVisibleItems() {
  const query = searchQuery.trim().toLocaleLowerCase();
  const filtered = items.filter((item) => {
    const categoryMatch = activeCategory === "All" || item.category === activeCategory;
    const haystack = [item.title, item.description, item.category, item.platform, item.author].join(" ").toLocaleLowerCase();
    return categoryMatch && (!query || haystack.includes(query));
  });
  const sort = document.querySelector("#sort-select").value;
  if (sort === "popular") filtered.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  else if (sort === "az") filtered.sort((a, b) => a.title.localeCompare(b.title));
  else filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return filtered;
}

function render() {
  const visible = getVisibleItems();
  document.querySelector("#software-count").textContent = String(items.length).padStart(2, "0");
  softwareGrid.innerHTML = visible.map(cardMarkup).join("");
  const isEmpty = visible.length === 0;
  emptyState.hidden = !isEmpty;
  softwareGrid.hidden = isEmpty;
  document.querySelector("#catalog-end").hidden = isEmpty;
  if (isEmpty && (items.length || searchQuery || activeCategory !== "All")) {
    document.querySelector("#empty-title").textContent = searchQuery || activeCategory !== "All" ? "No matches this time." : "A little room for something good.";
    document.querySelector("#empty-message").textContent = searchQuery || activeCategory !== "All" ? "Try another search or category to find what you are looking for." : "Nothing here just yet. Be the first to share a useful tool with the community.";
  }
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/software", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Could not load the library.");
    const data = await response.json();
    items = Array.isArray(data) ? data : [];
  } catch {
    items = [];
    document.querySelector("#empty-title").textContent = "The library is taking a breather.";
    document.querySelector("#empty-message").textContent = "We could not connect to the software library. Refresh the page and try again.";
  }
  render();
}

function showModal() {
  uploadModal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => document.querySelector("#software-name").focus(), 50);
}

function hideModal() {
  uploadModal.hidden = true;
  document.body.style.overflow = "";
}

function showFeedback(message, type = "error") {
  feedback.textContent = message;
  feedback.classList.toggle("success", type === "success");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { toast.hidden = true; }, 5200);
}

function handleFile(file) {
  if (!file) return;
  const extension = `.${file.name.split(".").pop()}`.toLowerCase();
  if (!allowedExtensions.has(extension)) {
    selectedFile = null;
    filePrompt.textContent = "That file type is not supported. Choose an installer or archive.";
    fileHint.textContent = "Supported: EXE, MSI, DMG, ZIP, DEB, APK and more";
    showFeedback("Choose a supported installer or software archive.");
    return;
  }
  if (file.size > 500 * 1024 * 1024) {
    selectedFile = null;
    filePrompt.textContent = "That file is over the 500 MB limit.";
    fileHint.textContent = "Choose a smaller software installer or archive.";
    showFeedback("Files must be smaller than 500 MB.");
    return;
  }
  selectedFile = file;
  filePrompt.textContent = file.name;
  fileHint.textContent = `${formatBytes(file.size)} · Ready to add`;
  showFeedback("");
  if (!document.querySelector("#software-name").value) {
    document.querySelector("#software-name").value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  }
}

document.querySelectorAll("[data-open-upload]").forEach((button) => button.addEventListener("click", showModal));
document.querySelectorAll("[data-close-upload]").forEach((button) => button.addEventListener("click", hideModal));
uploadModal.addEventListener("click", (event) => { if (event.target === uploadModal) hideModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !uploadModal.hidden) hideModal();
  if (event.key === "/" && uploadModal.hidden && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
    event.preventDefault();
    document.querySelector("#search-input").focus();
  }
});

document.querySelector("#search-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#search-input").addEventListener("input", (event) => { searchQuery = event.target.value; render(); });
document.querySelector("#sort-select").addEventListener("change", render);
document.querySelector("#category-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  document.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("selected", chip === button));
  render();
});

fileDrop.addEventListener("click", () => fileInput.click());
fileDrop.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
for (const eventName of ["dragenter", "dragover"]) fileDrop.addEventListener(eventName, (event) => { event.preventDefault(); fileDrop.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) fileDrop.addEventListener(eventName, (event) => {
  event.preventDefault();
  fileDrop.classList.remove("dragging");
  if (eventName === "drop") handleFile(event.dataTransfer.files[0]);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFeedback("");
  if (!selectedFile) return showFeedback("Choose a software installer or archive first.");
  const submitButton = document.querySelector("#submit-upload");
  submitButton.disabled = true;
  submitButton.innerHTML = "Uploading…";
  const metadata = new URLSearchParams({
    title: document.querySelector("#software-name").value.trim(),
    version: document.querySelector("#software-version").value.trim(),
    category: document.querySelector("#software-category").value,
    platform: document.querySelector("#software-platform").value,
    author: document.querySelector("#software-author").value.trim(),
    description: document.querySelector("#software-description").value.trim(),
  });
  try {
    const response = await fetch(`/api/software?${metadata}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(selectedFile.name) },
      body: selectedFile,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your upload could not be saved.");
    if (result.status !== "pending") items.unshift(result);
    uploadForm.reset();
    selectedFile = null;
    filePrompt.innerHTML = 'Drop your file here, or <u>browse</u>';
    fileHint.textContent = "Installer or archive · up to 500 MB";
    activeCategory = "All";
    document.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("selected", chip.dataset.category === "All"));
    searchQuery = "";
    document.querySelector("#search-input").value = "";
    render();
    hideModal();
    showToast(result.status === "pending" ? "Submission received. It will appear in the library after review." : "Software added to the library.");
    window.scrollTo({ top: document.querySelector("#library").offsetTop - 20, behavior: "smooth" });
  } catch (error) {
    showFeedback(error.message || "Your upload could not be saved.");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Add to library <span>↗</span>';
  }
});

document.querySelector("#year").textContent = new Date().getFullYear();
loadCatalog();
