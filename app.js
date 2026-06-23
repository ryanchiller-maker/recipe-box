/* ============================================================
   My Recipe Box — all logic, no dependencies, fully offline.
   Data is stored in this browser via localStorage.
   ============================================================ */

const STORAGE_KEY = "recipeBox.v2";
const OLD_KEY     = "recipeBox.v1";
const PANTRY_KEY  = "recipeBox.pantry.v1";

/* ---------- State ---------- */
let recipes = [];
let pantry = [];
let formRating = 0;
let selectedShop = new Set();
let shopFlips = {};
let shopBought = {};
let shopConfirmed = {};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

/* ---------- Storage ---------- */
function load() {
  try { recipes = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { recipes = null; }
  if (!recipes) recipes = migrateOrSeed();
  try { pantry = JSON.parse(localStorage.getItem(PANTRY_KEY)); } catch { pantry = null; }
  if (!pantry) pantry = defaultPantry();
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes)); }
function savePantry() { localStorage.setItem(PANTRY_KEY, JSON.stringify(pantry)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function migrateOrSeed() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch {}
  if (Array.isArray(old) && old.length) {
    const migrated = old.map((r) => ({
      id: r.id || uid(),
      title: r.title || "Untitled",
      utensils: r.utensils || [],
      ingredients: r.ingredients || [],
      steps: r.steps || [],
      rating: r.rating || 0,
      notes: r.notes || "",
      createdAt: r.createdAt || Date.now(),
      updatedAt: r.updatedAt || Date.now(),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }
  return seedRecipes();
}

/* ---------- Helpers ---------- */
function linesToArray(text) { return text.split("\n").map((l) => l.trim()).filter(Boolean); }
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function starString(rating) {
  return '<span class="stars">' + "★".repeat(rating) +
    '<span class="empty">' + "★".repeat(5 - rating) + "</span></span>";
}
function normIngredient(line) {
  return line.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}
function isPantryItem(line) {
  const n = normIngredient(line);
  return pantry.some((p) => p && (n.includes(p) || p.includes(n)));
}

/* ---------- View switching ---------- */
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("recipesView").hidden = name !== "recipes";
  $("shoppingView").hidden = name !== "shopping";
  if (name === "shopping") renderShopping();
}

/* ---------- Recipes list ---------- */
function getVisibleRecipes() {
  const q = $("searchInput").value.trim().toLowerCase();
  let list = recipes.filter((r) => {
    if (!q) return true;
    return [r.title, (r.ingredients || []).join(" ")].join(" ").toLowerCase().includes(q);
  });
  const sort = $("sortSelect").value;
  list.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "rating") return (b.rating || 0) - (a.rating || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return list;
}
function renderRecipes() {
  const grid = $("cardGrid");
  const list = getVisibleRecipes();
  grid.innerHTML = "";
  list.forEach((r) => {
    const card = document.createElement("article");
    card.className = "card";
    card.onclick = () => openDetail(r.id);
    const meta = (r.rating ? starString(r.rating) + " · " : "") +
      (r.ingredients || []).length + " ingredients · " + (r.steps || []).length + " steps";
    card.innerHTML =
      '<h2 class="card-title">' + escapeHtml(r.title) + "</h2>" +
      '<div class="card-meta">' + meta + "</div>";
    grid.appendChild(card);
  });
  $("emptyState").hidden = recipes.length !== 0;
  if (recipes.length > 0 && list.length === 0) {
    grid.innerHTML = '<p style="color:var(--ink-soft)">No recipes match your search.</p>';
  }
  $("countLabel").textContent = recipes.length + " recipe" + (recipes.length === 1 ? "" : "s");
}
/* ---------- Detail view ---------- */
let detailId = null;
function ingredientGroupsHtml(r) {
  const have = [], need = [];
  (r.ingredients || []).forEach((i) => (isPantryItem(i) ? have : need).push(i));
  let html = "";
  if (need.length) {
    html += '<div class="ing-group ing-need"><div class="group-head">Need to buy</div><ul>' +
      need.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul></div>";
  }
  if (have.length) {
    html += '<div class="ing-group ing-have"><div class="group-head">Already have (pantry)</div><ul>' +
      have.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul></div>";
  }
  return html;
}
function openDetail(id) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return;
  detailId = id;
  const meta = (r.rating ? starString(r.rating) + " · " : "") +
    (r.ingredients || []).length + " ingredients · " + (r.steps || []).length + " steps";
  let html =
    "<h2>" + escapeHtml(r.title) + "</h2>" +
    '<div class="detail-meta">' + meta + "</div>";
  if ((r.utensils || []).length) {
    html += '<div class="detail-section"><h3>Required utensils</h3><ul>' +
      r.utensils.map((u) => "<li>" + escapeHtml(u) + "</li>").join("") + "</ul></div>";
  }
  html += '<div class="detail-section"><h3>Ingredients</h3>' + ingredientGroupsHtml(r) + "</div>";
  html += '<div class="detail-section"><h3>Instructions</h3><ol>' +
    (r.steps || []).map((s) => "<li>" + escapeHtml(s) + "</li>").join("") + "</ol></div>";
  if (r.notes) {
    html += '<div class="detail-section"><h3>Notes</h3><div class="detail-notes">' +
      escapeHtml(r.notes).replace(/\n/g, "<br>") + "</div></div>";
  }
  $("detailContent").innerHTML = html;
  showModal("detailModal");
}

/* ---------- Cook mode ---------- */
let cook = { id: null, idx: -1 };
let wakeLock = null;
async function requestWake() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); }
  catch (e) { /* not supported or denied - fine */ }
}
function releaseWake() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
}
function startCook(id) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return;
  cook = { id, idx: (r.utensils && r.utensils.length) ? -1 : 0 };
  closeModals();
  $("cookModal").hidden = false;
  document.body.style.overflow = "hidden";
  requestWake();
  renderCook();
}
function renderCook() {
  const r = recipes.find((x) => x.id === cook.id);
  if (!r) return;
  const steps = r.steps || [];
  const body = $("cookBody");
  if (cook.idx === -1) {
    body.innerHTML =
      '<p class="cook-stage-label">Before you start</p>' +
      '<h2 class="cook-title">' + escapeHtml(r.title) + "</h2>" +
      '<p style="color:var(--ink-soft);margin-top:0">Get these out (tap each as you do):</p>' +
      '<ul class="cook-utensils">' +
      (r.utensils || []).map((u, i) => '<li data-u="' + i + '">' + escapeHtml(u) + "</li>").join("") +
      "</ul>";
    body.querySelectorAll(".cook-utensils li").forEach((li) =>
      (li.onclick = () => li.classList.toggle("done")));
    $("cookProgress").textContent = "Get ready";
    $("cookBack").disabled = true;
    $("cookNext").textContent = "Start cooking →";
  } else {
    body.innerHTML =
      '<p class="cook-stage-label">Step ' + (cook.idx + 1) + " of " + steps.length + "</p>" +
      '<p class="cook-step-text">' + escapeHtml(steps[cook.idx]) + "</p>";
    $("cookProgress").textContent = "Step " + (cook.idx + 1) + " / " + steps.length;
    $("cookBack").disabled = false;
    $("cookNext").textContent = cook.idx === steps.length - 1 ? "✓ Done" : "Next →";
  }
}
function cookNext() {
  const r = recipes.find((x) => x.id === cook.id);
  const last = (r.steps || []).length - 1;
  if (cook.idx >= last) { closeModals(); return; }
  cook.idx += 1; renderCook();
}
function cookBack() {
  const r = recipes.find((x) => x.id === cook.id);
  const min = (r.utensils && r.utensils.length) ? -1 : 0;
  if (cook.idx > min) { cook.idx -= 1; renderCook(); }
}

/* ---------- Add / edit form ---------- */
function buildRatingInput() {
  const box = $("ratingStars");
  box.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement("span");
    star.textContent = "★";
    star.dataset.value = i;
    star.onclick = () => { formRating = formRating === i ? 0 : i; paintRating(); };
    box.appendChild(star);
  }
}
function paintRating() {
  [...$("ratingStars").children].forEach((s) =>
    s.classList.toggle("on", Number(s.dataset.value) <= formRating));
}
function openForm(id) {
  $("recipeForm").reset();
  formRating = 0;
  if (id) {
    const r = recipes.find((x) => x.id === id);
    $("formTitle").textContent = "Edit recipe";
    $("recipeId").value = r.id;
    $("fTitle").value = r.title;
    $("fUtensils").value = (r.utensils || []).join("\n");
    $("fIngredients").value = (r.ingredients || []).join("\n");
    $("fSteps").value = (r.steps || []).join("\n");
    $("fNotes").value = r.notes || "";
    formRating = r.rating || 0;
  } else {
    $("formTitle").textContent = "Add recipe";
    $("recipeId").value = "";
  }
  paintRating();
  showModal("formModal");
  $("fTitle").focus();
}
function handleSubmit(e) {
  e.preventDefault();
  const id = $("recipeId").value;
  const data = {
    title: $("fTitle").value.trim(),
    utensils: linesToArray($("fUtensils").value),
    ingredients: linesToArray($("fIngredients").value),
    steps: linesToArray($("fSteps").value),
    notes: $("fNotes").value.trim(),
    rating: formRating,
  };
  if (id) {
    Object.assign(recipes.find((x) => x.id === id), data, { updatedAt: Date.now() });
  } else {
    recipes.push(Object.assign({ id: uid(), createdAt: Date.now(), updatedAt: Date.now() }, data));
  }
  save();
  renderRecipes();
  closeModals();
}

/* ---------- Pantry editor ---------- */
function openPantry() {
  $("pantryText").value = pantry.join("\n");
  showModal("pantryModal");
}
function savePantryFromForm() {
  pantry = linesToArray($("pantryText").value).map((p) => p.toLowerCase());
  savePantry();
  closeModals();
  renderRecipes();
}

/* ---------- Shopping list ---------- */
function renderShopping() {
  const pick = $("shopRecipeList");
  pick.innerHTML = "";
  if (recipes.length === 0) pick.innerHTML = '<p class="shop-empty">Add some recipes first.</p>';
  recipes.slice().sort((a, b) => a.title.localeCompare(b.title)).forEach((r) => {
    const checked = selectedShop.has(r.id);
    const row = document.createElement("label");
    row.className = "shop-pick-item" + (checked ? " checked" : "");
    row.innerHTML = '<input type="checkbox" ' + (checked ? "checked" : "") + "/><span>" +
      escapeHtml(r.title) + "</span>";
    row.querySelector("input").onchange = (e) => {
      if (e.target.checked) selectedShop.add(r.id); else selectedShop.delete(r.id);
      renderShopping();
    };
    pick.appendChild(row);
  });
  renderShopOutput();
}
function buildShopItems() {
  const map = new Map();
  recipes.filter((r) => selectedShop.has(r.id)).forEach((r) => {
    (r.ingredients || []).forEach((line) => {
      const key = normIngredient(line);
      if (!key) return;
      if (!map.has(key)) map.set(key, { name: line, from: new Set() });
      map.get(key).from.add(r.title);
    });
  });
  const items = [];
  map.forEach((v, key) => {
    const auto = isPantryItem(v.name) ? "have" : "need";
    items.push({ key, name: v.name, from: [...v.from], cat: shopFlips[key] || auto });
  });
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
function shopItemHtml(i) {
  const isBuy = i.cat === "need";
  const ticked = isBuy ? shopBought[i.key] : shopConfirmed[i.key];
  const attr = isBuy ? "data-buy" : "data-confirm";
  const checkbox = '<input type="checkbox" ' + attr + '="' + i.key + '" ' + (ticked ? "checked" : "") + "/>";
  const fromNote = i.from.length > 1 ? ' <span class="shop-from">x' + i.from.length + " recipes</span>" : "";
  const flipLabel = isBuy ? "I have it" : "need it";
  return '<div class="shop-item ' + (ticked ? "bought" : "") + '">' +
    checkbox +
    '<span class="name">' + escapeHtml(i.name) + fromNote + "</span>" +
    '<button class="flip" data-flip="' + i.key + '">' + flipLabel + "</button>" +
    "</div>";
}
function renderShopOutput() {
  const out = $("shopOutput");
  if (selectedShop.size === 0) {
    out.innerHTML = '<p class="shop-empty">Pick one or more recipes on the left to build your list.</p>';
    return;
  }
  const items = buildShopItems();
  const need = items.filter((i) => i.cat === "need");
  const have = items.filter((i) => i.cat === "have");
  const needBody = need.length
    ? need.map((i) => shopItemHtml(i)).join("")
    : '<p class="shop-empty">Nothing - all covered by your pantry!</p>';
  const haveBody = have.length
    ? '<p class="shop-note">Quick check - tick what you already have. Tap "need it" for anything you\'re out of.</p>' +
      have.map((i) => shopItemHtml(i)).join("")
    : '<p class="shop-empty">No pantry staples needed for these recipes.</p>';
  out.innerHTML =
    '<div class="shop-section need"><h3>To buy (' + need.length + ")</h3>" + needBody + "</div>" +
    '<div class="shop-section have"><h3>Double-check your pantry (' + have.length + ")</h3>" + haveBody + "</div>";

  out.querySelectorAll("[data-flip]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.flip;
    const cur = (buildShopItems().find((i) => i.key === k) || {}).cat;
    shopFlips[k] = cur === "need" ? "have" : "need";
    renderShopOutput();
  }));
  out.querySelectorAll("[data-buy]").forEach((c) => (c.onchange = () => {
    shopBought[c.dataset.buy] = c.checked;
    renderShopOutput();
  }));
  out.querySelectorAll("[data-confirm]").forEach((c) => (c.onchange = () => {
    shopConfirmed[c.dataset.confirm] = c.checked;
    renderShopOutput();
  }));
}
function shopListText() {
  const need = buildShopItems().filter((i) => i.cat === "need");
  return need.length ? need.map((i) => i.name).join("\n") : "";
}
function copyForNotes() {
  const text = shopListText();
  if (!text) { alert("Your 'to buy' list is empty."); return; }
  const done = () => { const t = $("copyToast"); t.hidden = false; setTimeout(() => (t.hidden = true), 4000); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); }
  catch (e) { alert("Couldn't copy automatically. Here's your list:\n\n" + text); }
  document.body.removeChild(ta);
}
function downloadTxt() {
  const text = shopListText();
  if (!text) { alert("Your 'to buy' list is empty."); return; }
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "shopping-list.txt"; a.click();
  URL.revokeObjectURL(url);
}

/* full recipe as plain text, for pasting into Apple Notes */
function recipeToText(r) {
  let t = r.title + "\n\n";
  if ((r.utensils || []).length) {
    t += "UTENSILS\n" + r.utensils.map((u) => "- " + u).join("\n") + "\n\n";
  }
  t += "INGREDIENTS\n" + (r.ingredients || []).map((i) => "- " + i).join("\n") + "\n\n";
  t += "INSTRUCTIONS\n" + (r.steps || []).map((s, n) => (n + 1) + ". " + s).join("\n");
  if (r.notes) t += "\n\nNOTES\n" + r.notes;
  return t;
}
function copyRecipe() {
  const r = recipes.find((x) => x.id === detailId);
  if (!r) return;
  const text = recipeToText(r);
  const done = () => alert("Recipe copied! Paste it into Apple Notes.");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

/* ---------- Export / import recipes ---------- */
function exportJson() {
  const blob = new Blob([JSON.stringify(recipes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "recipes-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(url);
}
function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (!Array.isArray(incoming)) throw new Error("Not a recipe list");
      const merge = confirm("Found " + incoming.length +
        " recipe(s).\n\nOK = MERGE with your current recipes.\nCancel = REPLACE everything with the file.");
      const cleaned = incoming.map((r) => ({
        id: r.id || uid(),
        title: r.title || "Untitled",
        utensils: r.utensils || [],
        ingredients: r.ingredients || [],
        steps: r.steps || [],
        notes: r.notes || "",
        rating: r.rating || 0,
        createdAt: r.createdAt || Date.now(),
        updatedAt: r.updatedAt || Date.now(),
      }));
      if (merge) {
        const ids = new Set(recipes.map((r) => r.id));
        cleaned.forEach((r) => { if (ids.has(r.id)) r.id = uid(); recipes.push(r); });
      } else {
        recipes = cleaned;
      }
      save(); renderRecipes(); alert("Import complete.");
    } catch (err) {
      alert("Sorry, that file could not be read as recipes.\n\n" + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- Modal plumbing ---------- */
function showModal(id) { $(id).hidden = false; document.body.style.overflow = "hidden"; }
function closeModals() {
  ["detailModal", "formModal", "pantryModal", "cookModal"].forEach((id) => ($(id).hidden = true));
  document.body.style.overflow = "";
  releaseWake();
}

/* ---------- Init ---------- */
function init() {
  load();
  buildRatingInput();
  renderRecipes();

  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

  $("addBtn").onclick = () => openForm();
  $("pantryBtn").onclick = openPantry;
  $("pantrySave").onclick = savePantryFromForm;
  $("exportBtn").onclick = exportJson;
  $("importBtn").onclick = () => $("importInput").click();
  $("importInput").onchange = (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; };

  $("searchInput").oninput = renderRecipes;
  $("sortSelect").onchange = renderRecipes;
  $("recipeForm").onsubmit = handleSubmit;

  $("detailCook").onclick = () => startCook(detailId);
  $("detailCopy").onclick = copyRecipe;
  $("detailEdit").onclick = () => { closeModals(); openForm(detailId); };
  $("detailDelete").onclick = () => {
    const r = recipes.find((x) => x.id === detailId);
    if (r && confirm('Delete "' + r.title + '"? This cannot be undone.')) {
      recipes = recipes.filter((x) => x.id !== detailId);
      selectedShop.delete(detailId);
      save(); renderRecipes(); closeModals();
    }
  };

  $("cookNext").onclick = cookNext;
  $("cookBack").onclick = cookBack;

  $("copyNotesBtn").onclick = copyForNotes;
  $("downloadTxtBtn").onclick = downloadTxt;

  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModals));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });
  // iOS drops the wake lock when you switch away; re-acquire it if Cook mode is still open
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !$("cookModal").hidden) requestWake();
  });
}

/* ---------- Defaults ---------- */
function defaultPantry() {
  return ["salt", "pepper", "olive oil", "vegetable oil", "garlic", "onion", "soy sauce",
    "sugar", "flour", "butter", "rice", "pasta", "vinegar", "water", "baking soda",
    "baking powder", "eggs", "honey", "chili flakes", "stock", "spices"];
}
function seedRecipes() {
  const now = Date.now();
  return [
    {
      id: uid(), createdAt: now, updatedAt: now, rating: 5,
      title: "Cozy Banana Bread",
      utensils: ["Large mixing bowl", "Loaf tin", "Fork (to mash)", "Measuring cups", "Wooden spoon"],
      ingredients: ["3 ripe bananas", "1/3 cup melted butter", "3/4 cup sugar", "1 egg",
        "1 tsp vanilla", "1 tsp baking soda", "Pinch of salt", "1 1/2 cups flour", "Walnuts (optional)"],
      steps: ["Preheat oven to 350F (175C) and grease a loaf tin.",
        "Mash the bananas in the bowl with a fork.",
        "Stir in the melted butter.",
        "Mix in sugar, egg, and vanilla.",
        "Sprinkle baking soda and salt over and stir in.",
        "Add the flour and mix until just combined.",
        "Pour into the tin and bake 50-60 minutes.",
        "Cool before slicing."],
      notes: "Add walnuts or chocolate chips for extra coziness.",
    },
    {
      id: uid(), createdAt: now - 1000, updatedAt: now - 1000, rating: 4,
      title: "Weeknight Tomato Pasta",
      utensils: ["Large pot", "Frying pan", "Colander", "Wooden spoon"],
      ingredients: ["400g spaghetti", "2 tbsp olive oil", "3 cloves garlic", "1 can crushed tomatoes",
        "Pinch of chili flakes", "Salt", "Fresh basil", "Parmesan"],
      steps: ["Boil the pasta in salted water until al dente.",
        "Warm olive oil and gently cook the garlic until fragrant.",
        "Add tomatoes and chili flakes; simmer 10 minutes.",
        "Season to taste.",
        "Toss the drained pasta in the sauce.",
        "Top with basil and parmesan."],
      notes: "",
    },
  ];
}

document.addEventListener("DOMContentLoaded", init);

