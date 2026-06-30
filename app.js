/* ============================================================
   My Recipe Box — all logic, no dependencies, fully offline.
   Data is stored in this browser via localStorage.
   ============================================================ */

const STORAGE_KEY = "recipeBox.v2";
const OLD_KEY     = "recipeBox.v1";
const PANTRY_KEY  = "recipeBox.pantry.v1";
const SUPPLIES_KEY = "recipeBox.supplies.v1";
const SUPPLIES_SYNCED_KEY = "recipeBox.suppliesSynced.v1";
const INGREDIENTS_KEY = "recipeBox.ingredients.v1";

/* Units you can measure an ingredient in (pick one or more per ingredient). */
const UNIT_OPTIONS = ["g", "kg", "ml", "L", "cup", "tbsp", "tsp", "piece", "clove", "can", "slice", "pinch"];

/* Special category names with distinct behaviour. */
const UNCAT_CAT = "Uncategorized";          // where pantry-staple adds land until filed
const NICHE_CAT = "Check before cooking";   // rarely-used items: confirm, don't routinely restock

/* Preferred display order for supply categories; unknown ones sort after, A-Z. */
const SUPPLY_CAT_ORDER = [UNCAT_CAT, "Pantry", NICHE_CAT, "Bathroom", "Cleaning", "Kitchen", "Household", "Other"];

/* ---------- State ---------- */
let recipes = [];
let pantry = [];
let supplies = [];
let ingredients = [];
let editingIngredientId = null;   // ingredient being edited in the modal
let ingReturnToForm = false;      // true when the editor was opened from the recipe form
let selectedShop = new Set();
let shopFlips = {};
let shopBought = {};
let shopConfirmed = {};
let supplyBought = {};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

/* ---------- Storage ---------- */
function load() {
  try { recipes = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { recipes = null; }
  if (!recipes) recipes = migrateOrSeed();
  try { pantry = JSON.parse(localStorage.getItem(PANTRY_KEY)); } catch { pantry = null; }
  if (!pantry) pantry = defaultPantry();
  try { supplies = JSON.parse(localStorage.getItem(SUPPLIES_KEY)); } catch { supplies = null; }
  if (!Array.isArray(supplies)) supplies = defaultSupplies();
  try { ingredients = JSON.parse(localStorage.getItem(INGREDIENTS_KEY)); } catch { ingredients = null; }
  if (!Array.isArray(ingredients)) ingredients = [];
  // One-time: fold existing pantry staples into the supplies inventory (Uncategorized).
  if (!localStorage.getItem(SUPPLIES_SYNCED_KEY)) {
    syncPantryToSupplies();
    localStorage.setItem(SUPPLIES_SYNCED_KEY, "1");
  }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes)); }
function savePantry() { localStorage.setItem(PANTRY_KEY, JSON.stringify(pantry)); }
function saveSupplies() { localStorage.setItem(SUPPLIES_KEY, JSON.stringify(supplies)); }
function saveIngredients() { localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(ingredients)); }
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
function normIngredient(line) {
  return line.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}
/* Ingredient classification is driven by your supplies inventory, never assumed.
   - matches a niche (Check before cooking) item you have   -> "check"  (confirm first)
   - matches a niche item you've flagged as run out          -> "need"
   - matches any other in-stock supply                       -> "have"
   - matches a supply you've flagged as run out / no match   -> "need"  */
function lineMatches(line, names) {
  const n = normIngredient(line);
  return names.some((p) => p && (n.includes(p) || p.includes(n)));
}
function matchContext() {
  const nicheNeed = [], nicheHave = [], have = [];
  supplies.forEach((s) => {
    const nm = (s.name || "").toLowerCase().trim();
    if (!nm) return;
    if (s.category === NICHE_CAT) (s.need ? nicheNeed : nicheHave).push(nm);
    else if (!s.need) have.push(nm);
  });
  return { nicheNeed, nicheHave, have };
}
function classifyIngredient(line, ctx) {
  ctx = ctx || matchContext();
  if (lineMatches(line, ctx.nicheNeed)) return "need";
  if (lineMatches(line, ctx.nicheHave)) return "check";
  if (lineMatches(line, ctx.have)) return "have";
  return "need";
}

/* ---------- View switching ---------- */
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("recipesView").hidden = name !== "recipes";
  $("shoppingView").hidden = name !== "shopping";
  $("suppliesView").hidden = name !== "supplies";
  $("nicheView").hidden = name !== "niche";
  $("ingredientsView").hidden = name !== "ingredients";
  if (name === "shopping") renderShopping();
  if (name === "supplies") renderSupplies();
  if (name === "niche") renderNiche();
  if (name === "ingredients") renderIngredients();
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
    const meta = (r.ingredients || []).length + " ingredients · " + (r.steps || []).length + " steps";
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
  const ctx = matchContext();
  const need = [], check = [], have = [];
  (r.ingredients || []).forEach((i) => {
    const c = classifyIngredient(i, ctx);
    (c === "need" ? need : c === "check" ? check : have).push(i);
  });
  const group = (cls, head, arr) =>
    '<div class="ing-group ' + cls + '"><div class="group-head">' + head + "</div><ul>" +
    arr.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul></div>";
  let html = "";
  if (need.length) html += group("ing-need", "Need to buy", need);
  if (check.length) html += group("ing-check", "Double-check you have it", check);
  if (have.length) html += group("ing-have", "Already have", have);
  return html;
}
function openDetail(id) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return;
  detailId = id;
  const meta = (r.ingredients || []).length + " ingredients · " + (r.steps || []).length + " steps";
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
function openForm(id) {
  $("recipeForm").reset();
  if (id) {
    const r = recipes.find((x) => x.id === id);
    $("formTitle").textContent = "Edit recipe";
    $("recipeId").value = r.id;
    $("fTitle").value = r.title;
    $("fUtensils").value = (r.utensils || []).join("\n");
    $("fIngredients").value = (r.ingredients || []).join("\n");
    $("fSteps").value = (r.steps || []).join("\n");
    $("fNotes").value = r.notes || "";
  } else {
    $("formTitle").textContent = "Add recipe";
    $("recipeId").value = "";
  }
  resetIngPickerRow();
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
  syncPantryToSupplies();   // new staples appear under "Uncategorized" in Supplies
  closeModals();
  renderRecipes();
}
/* Add any pantry-staple name that isn't already a supply, filed under Uncategorized.
   Additive only — removing a staple here never deletes a supply. */
function syncPantryToSupplies() {
  const existing = new Set(supplies.map((s) => (s.name || "").toLowerCase().trim()));
  let added = false;
  pantry.forEach((name) => {
    const nm = (name || "").trim();
    if (!nm || existing.has(nm.toLowerCase())) return;
    supplies.push({ id: uid(), name: nm, category: UNCAT_CAT, need: false });
    existing.add(nm.toLowerCase());
    added = true;
  });
  if (added) saveSupplies();
  return added;
}

/* ---------- Household & pantry supplies ---------- */
function suppliesByCategory() {
  const groups = {};
  supplies.forEach((s) => {
    const c = (s.category || "Other").trim() || "Other";
    (groups[c] = groups[c] || []).push(s);
  });
  return Object.keys(groups)
    .sort((a, b) => {
      const ia = SUPPLY_CAT_ORDER.indexOf(a), ib = SUPPLY_CAT_ORDER.indexOf(b);
      const ra = ia === -1 ? 999 : ia, rb = ib === -1 ? 999 : ib;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    })
    .map((c) => ({
      category: c,
      items: groups[c].slice().sort((x, y) => x.name.localeCompare(y.name)),
    }));
}
function renderSupplies() {
  const wrap = $("suppliesList");
  if (!wrap) return;
  wrap.innerHTML = "";
  const nonNiche = supplies.filter((s) => s.category !== NICHE_CAT);
  const needCount = nonNiche.filter((s) => s.need).length;
  const uncat = nonNiche.filter((s) => s.category === UNCAT_CAT).length;
  let summary = nonNiche.length
    ? needCount + " item" + (needCount === 1 ? "" : "s") + " to restock — these appear on your Shopping list."
    : "No items yet. Tap “Edit items” to add your household consumables.";
  if (uncat) summary += " " + uncat + " uncategorized — tap “Edit items” to file them.";
  $("suppliesSummary").textContent = summary;
  suppliesByCategory().filter((group) => group.category !== NICHE_CAT).forEach((group) => {
    const need = group.items.filter((i) => i.need).length;
    const section = document.createElement("section");
    section.className = "supply-cat";
    section.innerHTML = '<h3 class="supply-cat-head">' + escapeHtml(group.category) +
      (need ? ' <span class="supply-cat-count">' + need + " to buy</span>" : "") + "</h3>";
    const hint = group.category === UNCAT_CAT
      ? "Came in from your pantry staples. Tap “Edit items” to move them under a category."
      : group.category === NICHE_CAT
      ? "Rarely-used items. You'll be asked to confirm these when a recipe needs them, instead of routinely restocking."
      : "";
    if (hint) {
      const p = document.createElement("p");
      p.className = "supply-cat-hint";
      p.textContent = hint;
      section.appendChild(p);
    }
    const list = document.createElement("div");
    list.className = "supply-items";
    group.items.forEach((item) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "supply-item" + (item.need ? " need" : "");
      row.innerHTML = '<span class="supply-tick">' + (item.need ? "🛒" : "") + "</span>" +
        '<span class="supply-name">' + escapeHtml(item.name) + "</span>" +
        (item.need ? '<span class="supply-flag">need</span>' : "");
      row.onclick = () => { item.need = !item.need; saveSupplies(); renderSupplies(); };
      list.appendChild(row);
    });
    section.appendChild(list);
    wrap.appendChild(section);
  });
}
function suppliesToText() {
  return suppliesByCategory()
    .filter((g) => g.category !== NICHE_CAT)
    .map((g) => g.category + ":\n" + g.items.map((i) => i.name).join("\n"))
    .join("\n\n");
}
function parseSupplies(text) {
  let cat = "Other";
  const out = [];
  text.split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.endsWith(":")) { cat = line.slice(0, -1).trim() || "Other"; return; }
    out.push({ name: line, category: cat });
  });
  return out;
}
function openSupplyEditor() {
  $("supplyText").value = suppliesToText();
  showModal("supplyModal");
}
function saveSupplyEditor() {
  // The Supplies editor manages everything except niche items (those live on the Niche tab).
  const parsed = parseSupplies($("supplyText").value).filter((p) => p.category !== NICHE_CAT);
  const prev = new Map(supplies.map((s) => [(s.category + "|" + s.name).toLowerCase(), s]));
  const rebuilt = parsed.map((p) => {
    const m = prev.get((p.category + "|" + p.name).toLowerCase());
    return { id: m ? m.id : uid(), name: p.name, category: p.category, need: m ? m.need : false };
  });
  supplies = rebuilt.concat(supplies.filter((s) => s.category === NICHE_CAT));
  saveSupplies();
  closeModals();
  renderSupplies();
}
function markAllRestocked() {
  const restockable = supplies.filter((s) => s.category !== NICHE_CAT);
  if (!restockable.some((s) => s.need)) { alert("Nothing is marked to restock right now."); return; }
  if (!confirm("Mark everything as restocked (back in stock)?")) return;
  restockable.forEach((s) => (s.need = false));
  saveSupplies();
  renderSupplies();
}

/* ---------- Niche items (own tab) ---------- */
function nicheItems() {
  return supplies.filter((s) => s.category === NICHE_CAT)
    .slice().sort((a, b) => a.name.localeCompare(b.name));
}
function renderNiche() {
  const wrap = $("nicheList");
  if (!wrap) return;
  wrap.innerHTML = "";
  const items = nicheItems();
  const needCount = items.filter((i) => i.need).length;
  $("nicheSummary").textContent = items.length
    ? items.length + " niche item" + (items.length === 1 ? "" : "s") +
      (needCount ? " · " + needCount + " flagged to buy" : "")
    : "No niche items yet. Tap “Edit list” to add rarely-used ingredients like Chinese cooking wine.";
  const list = document.createElement("div");
  list.className = "supply-items";
  items.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "supply-item" + (item.need ? " need" : "");
    row.innerHTML = '<span class="supply-tick">' + (item.need ? "🛒" : "") + "</span>" +
      '<span class="supply-name">' + escapeHtml(item.name) + "</span>" +
      (item.need ? '<span class="supply-flag">need</span>' : "");
    row.onclick = () => { item.need = !item.need; saveSupplies(); renderNiche(); };
    list.appendChild(row);
  });
  wrap.appendChild(list);
}
function nicheToText() {
  return nicheItems().map((i) => i.name).join("\n");
}
function openNicheEditor() {
  $("nicheText").value = nicheToText();
  showModal("nicheModal");
}
function saveNicheEditor() {
  const names = linesToArray($("nicheText").value);
  const prev = new Map(nicheItems().map((s) => [s.name.toLowerCase(), s]));
  const rebuilt = names.map((nm) => {
    const m = prev.get(nm.toLowerCase());
    return { id: m ? m.id : uid(), name: nm, category: NICHE_CAT, need: m ? m.need : false };
  });
  supplies = supplies.filter((s) => s.category !== NICHE_CAT).concat(rebuilt);
  saveSupplies();
  closeModals();
  renderNiche();
}

/* ---------- Ingredients (master list with units) ---------- */
function unitChecksHtml(selected) {
  return UNIT_OPTIONS.map((u) =>
    '<label class="unit-check"><input type="checkbox" value="' + u + '"' +
    (selected.includes(u) ? " checked" : "") + "/>" + u + "</label>").join("");
}
function readCheckedUnits(containerId) {
  return [...$(containerId).querySelectorAll("input:checked")].map((c) => c.value);
}
function upsertIngredient(id, name, units) {
  if (id) {
    const ing = ingredients.find((x) => x.id === id);
    if (ing) { ing.name = name; ing.units = units; }
  } else {
    const existing = ingredients.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (existing) { existing.units = units; id = existing.id; }
    else { id = uid(); ingredients.push({ id, name, units }); }
  }
  saveIngredients();
  return id;
}
function renderIngredients() {
  const wrap = $("ingredientsList");
  if (!wrap) return;
  wrap.innerHTML = "";
  const list = ingredients.slice().sort((a, b) => a.name.localeCompare(b.name));
  $("ingredientsSummary").textContent = list.length
    ? list.length + " ingredient" + (list.length === 1 ? "" : "s") +
      " — used for search-and-add when you're entering a recipe."
    : "No ingredients yet. Tap “+ Add ingredient”, or create them on the fly while adding a recipe.";
  list.forEach((ing) => {
    const units = (ing.units && ing.units.length) ? ing.units.join(", ") : "no unit";
    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.innerHTML =
      '<button type="button" class="ingredient-main" data-edit="' + ing.id + '">' +
        '<span class="ingredient-name">' + escapeHtml(ing.name) + "</span>" +
        '<span class="ingredient-units">' + escapeHtml(units) + "</span></button>" +
      '<button type="button" class="ingredient-del" data-del="' + ing.id + '" aria-label="Delete">&times;</button>';
    wrap.appendChild(row);
  });
  wrap.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openIngredientEditor(b.dataset.edit)));
  wrap.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => deleteIngredient(b.dataset.del)));
}
function openIngredientEditor(id) {
  editingIngredientId = id || null;
  const ing = id ? ingredients.find((x) => x.id === id) : null;
  $("ingredientModalTitle").textContent = ing ? "Edit ingredient" : "New ingredient";
  $("ingName").value = ing ? ing.name : "";
  $("ingUnitChecks").innerHTML = unitChecksHtml(ing ? (ing.units || []) : []);
  showModal("ingredientModal");
  $("ingName").focus();
}
function saveIngredientFromModal() {
  const name = $("ingName").value.trim();
  if (!name) { alert("Give the ingredient a name."); return; }
  upsertIngredient(editingIngredientId, name, readCheckedUnits("ingUnitChecks"));
  closeModals();
  renderIngredients();
}
function deleteIngredient(id) {
  const ing = ingredients.find((x) => x.id === id);
  if (ing && confirm('Delete "' + ing.name + '" from your ingredients list?')) {
    ingredients = ingredients.filter((x) => x.id !== id);
    saveIngredients();
    renderIngredients();
  }
}

/* --- Ingredient picker inside the Add/Edit recipe form --- */
function findIngredientByName(name) {
  const n = (name || "").trim().toLowerCase();
  return ingredients.find((i) => i.name.toLowerCase() === n) || null;
}
/* Case-insensitive substring filter: typing "be" keeps "Beef mince" but drops "Bread"/"Bone broth". */
function filterIngredients(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return ingredients
    .filter((i) => i.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
}
function fillUnitDropdown(ing) {
  const units = ing && ing.units ? ing.units : [];
  $("ingUnit").innerHTML = '<option value="">(no unit)</option>' +
    units.map((u) => '<option value="' + u + '">' + u + "</option>").join("");
}
function hideIngSuggest() { const b = $("ingSuggest"); b.hidden = true; b.innerHTML = ""; }
function resetIngPickerRow() {
  $("ingPick").value = "";
  $("ingQty").value = "";
  fillUnitDropdown(null);
  $("ingInline").hidden = true;
  hideIngSuggest();
}
function renderIngSuggest() {
  const box = $("ingSuggest");
  const q = $("ingPick").value.trim();
  if (!q) { hideIngSuggest(); return; }
  const matches = filterIngredients(q);
  let html = matches.map((i) =>
    '<button type="button" class="ing-suggest-item" data-pick="' + i.id + '">' +
    '<span>' + escapeHtml(i.name) + "</span>" +
    (i.units && i.units.length ? '<span class="ing-suggest-units">' + escapeHtml(i.units.join(", ")) + "</span>" : "") +
    "</button>").join("");
  if (!findIngredientByName(q)) {
    html += '<button type="button" class="ing-suggest-item ing-suggest-create" data-create="1">＋ Create “' +
      escapeHtml(q) + "”</button>";
  }
  box.innerHTML = html;
  box.hidden = false;
  box.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => chooseIngredient(b.dataset.pick)));
  const create = box.querySelector("[data-create]");
  if (create) create.onclick = () => startCreateIngredient($("ingPick").value.trim());
}
function chooseIngredient(id) {
  const ing = ingredients.find((x) => x.id === id);
  if (!ing) return;
  $("ingPick").value = ing.name;
  fillUnitDropdown(ing);
  $("ingInline").hidden = true;
  hideIngSuggest();
  $("ingQty").focus();
}
function startCreateIngredient(name) {
  if (!name) return;
  hideIngSuggest();
  $("ingInlineName").textContent = name;
  $("ingInlineUnits").innerHTML = unitChecksHtml([]);
  $("ingInline").hidden = false;
}
function onIngPickInput() {
  const name = $("ingPick").value.trim();
  const exact = findIngredientByName(name);
  fillUnitDropdown(exact || null);
  $("ingInline").hidden = true;          // re-typing changes context; hide create panel until chosen
  if (exact) { hideIngSuggest(); } else { renderIngSuggest(); }
}
function onIngPickKey(e) {
  if (e.key !== "Enter") return;
  e.preventDefault();                    // don't submit the whole recipe form
  const name = $("ingPick").value.trim();
  const matches = filterIngredients(name);
  if (matches.length) chooseIngredient(matches[0].id);
  else if (name) startCreateIngredient(name);
}
function createIngredientInline() {
  const name = $("ingPick").value.trim();
  if (!name) return;
  upsertIngredient(null, name, readCheckedUnits("ingInlineUnits"));
  fillUnitDropdown(findIngredientByName(name));
  $("ingInline").hidden = true;
  $("ingQty").focus();
}
function buildIngLine(qty, unit, name) {
  return [qty, unit, name].map((s) => (s || "").trim()).filter(Boolean).join(" ");
}
function addIngredientLineToForm() {
  const name = $("ingPick").value.trim();
  if (!name) { $("ingPick").focus(); return; }
  const line = buildIngLine($("ingQty").value, $("ingUnit").value, name);
  const ta = $("fIngredients");
  ta.value = (ta.value && !ta.value.endsWith("\n")) ? ta.value + "\n" + line : ta.value + line;
  resetIngPickerRow();
  $("ingPick").focus();
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
  const ctx = matchContext();
  map.forEach((v, key) => {
    const auto = classifyIngredient(v.name, ctx);
    items.push({ key, name: v.name, from: [...v.from], cat: shopFlips[key] || auto });
  });
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
function shopItemHtml(i) {
  const fromNote = i.from.length > 1 ? ' <span class="shop-from">x' + i.from.length + " recipes</span>" : "";
  const name = '<span class="name">' + escapeHtml(i.name) + fromNote + "</span>";
  if (i.cat === "check") {
    return '<div class="shop-item check">' + name +
      '<button class="flip" data-flip="have:' + i.key + '">have it</button>' +
      '<button class="flip flip-need" data-flip="need:' + i.key + '">need it</button>' + "</div>";
  }
  if (i.cat === "have") {
    return '<div class="shop-item have">' + name +
      '<button class="flip flip-need" data-flip="need:' + i.key + '">need it</button>' + "</div>";
  }
  const ticked = shopBought[i.key];
  return '<div class="shop-item ' + (ticked ? "bought" : "") + '">' +
    '<input type="checkbox" data-buy="' + i.key + '" ' + (ticked ? "checked" : "") + "/>" +
    name + '<button class="flip" data-flip="have:' + i.key + '">I have it</button>' + "</div>";
}
function supplyShopHtml() {
  const groups = suppliesByCategory()
    .map((g) => ({ category: g.category, items: g.items.filter((i) => i.need) }))
    .filter((g) => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) return "";
  let body = "";
  groups.forEach((g) => {
    body += '<div class="shop-supply-cat">' + escapeHtml(g.category) + "</div>";
    body += g.items.map((i) => {
      const ticked = supplyBought[i.id];
      return '<div class="shop-item ' + (ticked ? "bought" : "") + '">' +
        '<input type="checkbox" data-supply="' + i.id + '" ' + (ticked ? "checked" : "") + "/>" +
        '<span class="name">' + escapeHtml(i.name) + "</span></div>";
    }).join("");
  });
  return '<div class="shop-section supplies"><h3>Household &amp; supplies (' + total + ")</h3>" + body + "</div>";
}
function renderShopOutput() {
  const out = $("shopOutput");
  let html = "";
  if (selectedShop.size > 0) {
    const items = buildShopItems();
    const need = items.filter((i) => i.cat === "need");
    const check = items.filter((i) => i.cat === "check");
    const have = items.filter((i) => i.cat === "have");
    html += '<div class="shop-section need"><h3>To buy (' + need.length + ")</h3>" +
      (need.length ? need.map((i) => shopItemHtml(i)).join("")
        : '<p class="shop-empty">Nothing from these recipes — you have it all.</p>') + "</div>";
    if (check.length) {
      html += '<div class="shop-section check"><h3>Double-check you still have these (' + check.length + ")</h3>" +
        '<p class="shop-note">Rarely-used items these recipes call for. Confirm you\'ve got some — tap "need it" if you\'re out.</p>' +
        check.map((i) => shopItemHtml(i)).join("") + "</div>";
    }
    if (have.length) {
      html += '<div class="shop-section have"><h3>Already have (' + have.length + ")</h3>" +
        '<p class="shop-note">Matched to your in-stock supplies. Tap "need it" if you\'re actually out.</p>' +
        have.map((i) => shopItemHtml(i)).join("") + "</div>";
    }
  }
  html += supplyShopHtml();
  if (!html) {
    out.innerHTML = '<p class="shop-empty">Pick one or more recipes on the left to build your list — ' +
      "or mark household items you've run out of on the Supplies tab.</p>";
    return;
  }
  out.innerHTML = html;

  out.querySelectorAll("[data-flip]").forEach((b) => (b.onclick = () => {
    const [target, key] = b.dataset.flip.split(":");
    shopFlips[key] = target;   // "have" or "need"
    renderShopOutput();
  }));
  out.querySelectorAll("[data-buy]").forEach((c) => (c.onchange = () => {
    shopBought[c.dataset.buy] = c.checked;
    renderShopOutput();
  }));
  out.querySelectorAll("[data-supply]").forEach((c) => (c.onchange = () => {
    supplyBought[c.dataset.supply] = c.checked;
    renderShopOutput();
  }));
}
function shopListText() {
  const recipeNeed = buildShopItems().filter((i) => i.cat === "need").map((i) => i.name);
  const supplyNeed = [];
  suppliesByCategory().forEach((g) =>
    g.items.filter((i) => i.need).forEach((i) => supplyNeed.push(i.name)));
  const seen = new Set(), out = [];
  recipeNeed.concat(supplyNeed).forEach((n) => {
    const k = n.toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(n); }
  });
  return out.join("\n");
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
  ["detailModal", "formModal", "pantryModal", "supplyModal", "nicheModal", "ingredientModal", "cookModal"].forEach((id) => ($(id).hidden = true));
  document.body.style.overflow = "";
  releaseWake();
}

/* ---------- Init ---------- */
function init() {
  load();
  renderRecipes();

  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

  $("addBtn").onclick = () => openForm();
  $("pantryBtn").onclick = openPantry;
  $("pantrySave").onclick = savePantryFromForm;
  $("supplyEditBtn").onclick = openSupplyEditor;
  $("supplySave").onclick = saveSupplyEditor;
  $("supplyRestockBtn").onclick = markAllRestocked;
  $("nicheEditBtn").onclick = openNicheEditor;
  $("nicheSave").onclick = saveNicheEditor;
  $("ingredientAddBtn").onclick = () => openIngredientEditor(null);
  $("ingredientSave").onclick = saveIngredientFromModal;
  $("ingPick").oninput = onIngPickInput;
  $("ingPick").onkeydown = onIngPickKey;
  $("ingPick").onfocus = onIngPickInput;
  $("ingPick").onblur = () => setTimeout(hideIngSuggest, 150);
  $("ingAddBtn").onclick = addIngredientLineToForm;
  $("ingInlineCreate").onclick = createIngredientInline;
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
function defaultSupplies() {
  const seed = {
    Pantry: ["olive oil", "flour", "sugar", "salt", "pasta", "rice", "canned tomatoes",
      "coffee", "tea", "cooking oil"],
    Bathroom: ["toilet paper", "toothpaste", "shampoo", "hand soap", "body wash",
      "deodorant", "floss"],
    Cleaning: ["dish soap", "laundry detergent", "sponges", "surface spray", "bin bags"],
    Kitchen: ["paper towels", "cling film", "aluminium foil", "baking paper", "ziplock bags"],
    Household: ["batteries", "light bulbs", "tissues"],
    [NICHE_CAT]: ["chinese cooking wine", "saffron", "fish sauce"],
  };
  const out = [];
  Object.keys(seed).forEach((cat) =>
    seed[cat].forEach((name) =>
      out.push({ id: uid(), name, category: cat, need: false })));
  return out;
}
function seedRecipes() {
  const now = Date.now();
  return [
    {
      id: uid(), createdAt: now, updatedAt: now,
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
      id: uid(), createdAt: now - 1000, updatedAt: now - 1000,
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

