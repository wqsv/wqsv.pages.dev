// this code is an abomination
// borrowed from the old website
// someone helped me write this; i just cant remember who. thanks to whoever was it.

const POSTS = [
  {
    title: "Using SoundCloud's API without an App",
    href: "2025/09-21-soundcloud-api",
    date: "2025-09-21",
    excerpt: "Exploring SoundCloud's API, browser session credentials, and the challenges of DataDome bot protection.",
    tags: ["api", "reverse-engineering"],
    readTime: 4
  },
  {
    title: "Wiping MFT",
    href: "2025/09-11-wipemft",
    date: "2025-09-11",
    excerpt: "A write-up detailing an NTFS MFT killer.",
    tags: ["mft", "ntfs"],
    readTime: 10
  },
  {
    title: "Hiding text in Discord PFPs",
    href: "2026/09-14-discord-steganography",
    date: "2026-09-30",
    excerpt: "A write-up detailing lossy steganography.",
    tags: ["steganography", "lossy"],
    readTime: 30
  }
];

const POSTS_PER_PAGE = 9;

const MONTHS = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December"
];

const state = {
  page: 1,
  query: "",
  year: "",
  month: "",
  sort: "newest",
  tag: ""
};

const $ = id => document.getElementById(id);

const searchInput = $("searchInput");
const yearFilter = $("yearFilter");
const monthFilter = $("monthFilter");
const sortSelect = $("sortSelect");
const postsList = $("postsList");
const pagination = $("pagination");
const resultCount = $("resultCount");
const tagFilters = $("tagFilters");

function dateParts(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > new Date(year, month, 0).getDate()
  ) {
    return null;
  }

  return { year, month, day };
}

function formatDate(date) {
  const parts = dateParts(date);

  if (!parts) return date || "";

  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");

  return `${parts.year}-${month}-${day}`;
}

function formatLongDate(date) {
  const parts = dateParts(date);
  if (!parts) return date || "";

  return `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function dateValue(date) {
  // ISO dates are sorted lexicoographically without timezone issues
  return dateParts(date) ? date : "";
}

function normalize(value) {
  return String(value ?? "").toLocaleLowerCase();
}

function getTags(post) {
  return Array.isArray(post.tags) ? post.tags : [];
}

function getSearchableText(post) {
  return [
    post.title,
    post.excerpt,
    ...getTags(post)
  ].join(" ");
}

function buildMonthOptions() {
  MONTHS.forEach((month, index) => {
    const option = document.createElement("option");
    option.value = String(index + 1).padStart(2, "0");
    option.textContent = month;
    monthFilter.appendChild(option);
  });
}

function buildYearOptions() {
  const years = [...new Set(
    POSTS.map(post => dateParts(post.date)?.year)
      .filter(Boolean)
  )].sort((a, b) => b - a);

  for (const year of years) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearFilter.appendChild(option);
  }
}

function buildTagFilters() {
  const counts = new Map();

  for (const post of POSTS) {
    for (const tag of getTags(post)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  tagFilters.replaceChildren();

  const allButton = createTagButton("All", "", POSTS.length);
  tagFilters.appendChild(allButton);

  const sortedTags = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [tag, count] of sortedTags) {
    tagFilters.appendChild(createTagButton(tag, tag, count));
  }

  updateTagButtons();
}

function createTagButton(label, value, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tag-chip";
  button.dataset.tag = value;
  button.setAttribute("aria-pressed", "false");

  const name = document.createElement("span");
  name.textContent = label;

  const number = document.createElement("span");
  number.className = "tag-count";
  number.textContent = count;

  button.append(name, number);

  button.addEventListener("click", () => {
    state.tag = value;
    state.page = 1;
    updateTagButtons();
    render();
  });

  return button;
}

function updateTagButtons() {
  for (const button of tagFilters.querySelectorAll(".tag-chip")) {
    const active = button.dataset.tag === state.tag;

    button.setAttribute("aria-pressed", String(active));
  }
}

function getFilteredPosts() {
  let posts = POSTS.filter(post => {
    const parts = dateParts(post.date);

    if (state.year && parts?.year !== Number(state.year)) {
      return false;
    }

    if (state.month && String(parts?.month ?? "").padStart(2, "0") !== state.month) {
      return false;
    }

    if (state.tag && !getTags(post).includes(state.tag)) {
      return false;
    }

    if (state.query && !normalize(getSearchableText(post)).includes(state.query)) {
      return false;
    }

    return true;
  });

  posts.sort((a, b) => {
    const dateA = dateValue(a.date);
    const dateB = dateValue(b.date);

    const comparison = dateB.localeCompare(dateA);
    return state.sort === "oldest" ? -comparison : comparison;
  });

  return posts;
}

function appendHighlightedText(parent, text, query) {
  const value = String(text ?? "");

  if (!query) {
    parent.appendChild(document.createTextNode(value));
    return;
  }

  const lower = normalize(value);
  let cursor = 0;
  let matchIndex;

  while ((matchIndex = lower.indexOf(query, cursor)) !== -1) {
    if (matchIndex > cursor) {
      parent.appendChild(document.createTextNode(value.slice(cursor, matchIndex)));
    }

    const mark = document.createElement("mark");
    mark.textContent = value.slice(matchIndex, matchIndex + query.length);
    parent.appendChild(mark);

    cursor = matchIndex + query.length;
  }

  if (cursor < value.length) {
    parent.appendChild(document.createTextNode(value.slice(cursor)));
  }
}

function createPostRow(post) {
  const row = document.createElement("article");
  row.className = "post-row";

  const date = document.createElement("time");
  date.className = "post-date";
  date.dateTime = post.date;
  date.textContent = formatDate(post.date);

  const main = document.createElement("div");
  main.className = "post-main";

  const title = document.createElement("a");
  title.className = "post-title";
  title.href = post.href;
  appendHighlightedText(title, post.title, state.query);

  const excerpt = document.createElement("p");
  excerpt.className = "post-excerpt";
  appendHighlightedText(excerpt, post.excerpt || "", state.query);

  main.append(title, excerpt);

  const details = document.createElement("div");
  details.className = "post-details";

  const readTime = document.createElement("span");
  readTime.className = "read-time";
  readTime.textContent = post.readTime ? `${post.readTime} min read` : "Reading time n/a";

  const tags = document.createElement("div");
  tags.className = "post-tags";
  tags.setAttribute("aria-label", "Post tags");

  for (const tag of getTags(post)) {
    const tagLink = document.createElement("a");
    tagLink.className = "post-tag";
    tagLink.href = "#archive-title";
    tagLink.textContent = `#${tag}`;
    tagLink.setAttribute("aria-label", `Filter by tag ${tag}`);

    tagLink.addEventListener("click", event => {
      event.preventDefault();

      state.tag = tag;
      state.page = 1;

      updateTagButtons();
      render();

      $("archive-title").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });

    tags.appendChild(tagLink);
  }

  details.append(readTime, tags);
  row.append(date, main, details);

  return row;
}

function renderPosts(posts) {
  postsList.replaceChildren();

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      "No posts match your filters. Try a different search or clear the filters.";

    postsList.appendChild(empty);
    return;
  }

  const start = (state.page - 1) * POSTS_PER_PAGE;
  const pagePosts = posts.slice(start, start + POSTS_PER_PAGE);

  const fragment = document.createDocumentFragment();

  for (const post of pagePosts) {
    fragment.appendChild(createPostRow(post));
  }

  postsList.appendChild(fragment);
}

function createPageButton(page, currentPage) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "page-button";
  button.textContent = String(page);
  button.disabled = page === currentPage;

  if (page === currentPage) {
    button.setAttribute("aria-current", "page");
  }

  button.setAttribute("aria-label", `Page ${page}`);

  button.addEventListener("click", () => {
    state.page = page;
    render();
    $("archive-title").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  return button;
}

function renderPagination(totalItems) {
  pagination.replaceChildren();

  const totalPages = Math.ceil(totalItems / POSTS_PER_PAGE);
  if (totalPages <= 1) return;
  const current = state.page;

  const visiblePages = new Set([1, totalPages]);

  for (
    let page = Math.max(1, current - 2);
    page <= Math.min(totalPages, current + 2);
    page++
  ) {
    visiblePages.add(page);
  }

  const pages = [...visiblePages].sort((a, b) => a - b);

  function addEllipsis() {
    const span = document.createElement("span");
    span.className = "page-ellipsis";
    span.textContent = "…";
    span.setAttribute("aria-hidden", "true");
    pagination.appendChild(span);
  }

  function addPage(page) {
    pagination.appendChild(createPageButton(page, current));
  }

  function addPreviousNext(label, target, disabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-button";
    button.textContent = label;
    button.disabled = disabled;
    button.setAttribute("aria-label", label === "←" ? "Previous page" : "Next page");

    button.addEventListener("click", () => {
      state.page = target;
      render();
      $("archive-title").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });

    pagination.appendChild(button);
  }

  addPreviousNext("←", current - 1, current === 1);

  let previous = 0;

  for (const page of pages) {
    if (previous && page - previous > 1) {
      addEllipsis();
    }

    addPage(page);
    previous = page;
  }

  addPreviousNext("→", current + 1, current === totalPages);

  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent =
    `Page ${current} of ${totalPages} · ${totalItems} posts`;

  pagination.appendChild(info);
}

function render() {
  const posts = getFilteredPosts();

  const totalPages = Math.max(
    1,
    Math.ceil(posts.length / POSTS_PER_PAGE)
  );

  // Keep the current page valid if the result count changes.
  state.page = Math.min(state.page, totalPages);

  resultCount.textContent =
    `${posts.length} ${posts.length === 1 ? "POST" : "POSTS"}`;

  renderPosts(posts);
  renderPagination(posts.length);
}

function resetFilters() {
  state.page = 1;
  state.query = "";
  state.year = "";
  state.month = "";
  state.sort = "newest";
  state.tag = "";

  searchInput.value = "";
  yearFilter.value = "";
  monthFilter.value = "";
  sortSelect.value = "newest";

  updateTagButtons();
  render();
}

function syncFilters() {
  state.query = normalize(searchInput.value.trim());
  state.year = yearFilter.value;
  state.month = monthFilter.value;
  state.sort = sortSelect.value;
  state.page = 1;

  render();
}

function init() {
  buildYearOptions();
  buildMonthOptions();
  buildTagFilters();

  searchInput.addEventListener("input", syncFilters);
  yearFilter.addEventListener("change", syncFilters);
  monthFilter.addEventListener("change", syncFilters);
  sortSelect.addEventListener("change", syncFilters);
  $("clearFilters").addEventListener("click", resetFilters);

  // "/" focuses search; Escape clears it when focused.
  document.addEventListener("keydown", event => {
    const target = event.target;
    const isTyping = target instanceof HTMLElement &&
      (target.isContentEditable ||
       ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

    if (
      event.key === "/" &&
      !isTyping &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      searchInput.focus();
    }

    if (
      event.key === "Escape" &&
      target === searchInput
    ) {
      if (searchInput.value) {
        searchInput.value = "";
        syncFilters();
      } else {
        searchInput.blur();
      }
    }
  });

  render();
}

document.addEventListener("DOMContentLoaded", init);
