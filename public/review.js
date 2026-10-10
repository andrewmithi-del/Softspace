const loginForm = document.querySelector("#review-login");
const tokenInput = document.querySelector("#admin-token");
const reviewList = document.querySelector("#review-list");
const feedback = document.querySelector("#review-feedback");
const sessionActions = document.querySelector("#review-session");
let adminToken = "";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function showFeedback(message, isError = true) {
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
  feedback.hidden = !message;
}

function renderItems(items) {
  reviewList.hidden = false;
  sessionActions.hidden = false;
  if (!items.length) {
    reviewList.innerHTML = '<div class="review-empty"><span>✳</span><h2>All caught up.</h2><p>There are no software submissions waiting for review.</p></div>';
    return;
  }
  reviewList.innerHTML = items.map((item) => `<article class="review-card" data-id="${escapeHtml(item.id)}">
    <div class="review-card-head"><div><span class="review-category">${escapeHtml(item.category)}</span><h2>${escapeHtml(item.title)}</h2></div><span class="review-platform">${escapeHtml(item.platform)}</span></div>
    <p class="review-description">${escapeHtml(item.description)}</p>
    <div class="review-meta"><span>Version ${escapeHtml(item.version)}</span><span>${escapeHtml(item.fileName)}</span><span>${Number(item.size / (1024 * 1024)).toFixed(1)} MB</span><span>By ${escapeHtml(item.author || "Community")}</span></div>
    <div class="review-card-actions"><button class="button button-light" data-review-action="approve" type="button">Approve for download</button><button class="review-reject" data-review-action="reject" type="button">Reject</button></div>
  </article>`).join("");
}

async function loadQueue() {
  showFeedback("Loading submissions…", false);
  try {
    const response = await fetch("/api/review", { headers: { authorization: `Bearer ${adminToken}`, accept: "application/json" }, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not open the review queue.");
    loginForm.hidden = true;
    showFeedback(result.length ? `${result.length} submission${result.length === 1 ? "" : "s"} waiting for review.` : "The review queue is clear.", false);
    renderItems(result);
  } catch (error) {
    showFeedback(error.message || "Could not open the review queue.");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = tokenInput.value;
  await loadQueue();
  if (loginForm.hidden) tokenInput.value = "";
});

reviewList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  if (!card) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/software/${encodeURIComponent(card.dataset.id)}/review`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: button.dataset.reviewAction }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not update this submission.");
    card.remove();
    const remaining = reviewList.querySelectorAll("[data-id]").length;
    showFeedback(remaining ? `${remaining} submission${remaining === 1 ? "" : "s"} still waiting.` : "The review queue is clear.", false);
    if (!remaining) renderItems([]);
  } catch (error) {
    button.disabled = false;
    showFeedback(error.message || "Could not update this submission.");
  }
});

document.querySelector("#review-sign-out").addEventListener("click", () => {
  adminToken = "";
  reviewList.hidden = true;
  sessionActions.hidden = true;
  loginForm.hidden = false;
  showFeedback("You have signed out.", false);
  tokenInput.focus();
});
