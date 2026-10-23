// Dexie: a friendly way to use the browser's built-in database (IndexedDB)
import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.mjs";


// ===== 1. LOAD DATA =====
// load the library json before starting
const response = await fetch("library.json");
const books = await response.json();


// ===== 1b. THE DATABASE ON THIS DEVICE =====
// One table, "edits": one record per book you've changed, found by its id
const db = new Dexie("exLibris");
db.version(2).stores({
    edits: "id",
    sessions: "++id, bookId"
});

// Lay your saved edits over the original books, so changes survive a reload
const edits = await db.edits.toArray();
for (const edit of edits) {
    const book = books.find(b => b.goodreads_id === edit.id);
    if (book) {
        Object.assign(book, edit);
    }
}


// ===== 2. ELEMENTS ON THE PAGE =====
// finds the empty elements from the HTML so the code can fill them or listen to them
const list = document.getElementById("books");
const panel = document.getElementById("panel");
const search = document.getElementById("search");
const categorySelect = document.getElementById("category");
const statusSelect = document.getElementById("status");
const sortSelect = document.getElementById("sort");
const shopSelect = document.getElementById("shop");
const ownedSelect = document.getElementById("owned");
const mainArea = document.querySelector("main");

let bookSelection = null;


// ===== 3. HELPERS =====
// helper function to create text for book information
function addText(parent, tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.append(element);
    return element; // in case caller wants to style it
}

async function saveEdit(id, changes) {
    const existing = (await db.edits.get(id)) ??  { id };
    await db.edits.put({ ...existing, ...changes });
}

// Put a control inside a label with a small heading, and add it to a parent
function addField(parent, labelText, control) {
    const label = document.createElement("label");
    label.className = "field";
    addText(label, "span", labelText);
    label.append(control);
    parent.append(label);
}

// shrink photos cause we dont want huge photos
async function shrinkPhoto(file, maxSize = 1200) {
    const image = await createImageBitmap(file);

    // scale down only, small photos stay small
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);

    // draw it onto a canvas of the new size, return back file
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    return await canvas.convertToBlob({type: "image/jpeg", quality: 0.8});
}

// Draw one book's reading sessions into a container, newest first
async function showSessions(book, container) {
    const sessions = await db.sessions.where("bookId").equals(book.goodreads_id).toArray();
    sessions.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    container.replaceChildren();

    if (sessions.length === 0) {
        addText(container, "p", "No sessions logged yet.");
        return;
    }
    // progress bar from the highest page logged so far
    const pages = sessions.map(s => s.page).filter(p => p);
    if (book.pages && pages.length > 0) {
        const reached = Math.max(...pages);
        const fraction = Math.min(reached / book.pages, 1);

        const width = 20;
        const filled = Math.round(fraction * width);
        const bar = "█".repeat(filled) + "░".repeat(width - filled);
        const percent = Math.round(fraction * 100);

        const line = addText(container, "p", `[${bar}] ${percent}% · page ${reached} of ${book.pages}`);
        line.className = "pbar";
    }

    for (const session of sessions) {
        const entry = document.createElement("div");
        entry.className = "session";

        // photo on the left as a small thumbnail (shown in full when the card is open)
        if (session.photo) {
            entry.classList.add("has-photo");
            const photo = document.createElement("img");
            photo.className = "session-photo";
            photo.alt = "";
            photo.src = URL.createObjectURL(session.photo);
            entry.append(photo);
        }

        // the words go in their own box, to the right of the photo
        const words = document.createElement("div");
        words.className = "session-words";
        const pageText = session.page ? ` · page ${session.page}` : "";
        const moodText = session.mood ? session.mood + " " : "";
        addText(words, "h4", moodText + session.date + pageText);
        if (session.note) {
            addText(words, "p", session.note);
        }
        entry.append(words);

        // tap the card to open or close it
        entry.addEventListener("click", () => {
            entry.classList.toggle("open");
        });

        // a button to delete this session, then redraw so it disappears
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.className = "delete";
        deleteButton.addEventListener("click", async (event) => {
            event.stopPropagation(); // don't also open or close the card
            await db.sessions.delete(session.id);
            await showSessions(book, container);
        });
        entry.append(deleteButton);

        container.append(entry);
    }
}

// display the highest page number as the default for when logging a session
async function highestPage(book) {
    const sessions = await db.sessions.where("bookId").equals(book.goodreads_id).toArray();
    const pages = sessions.map(s => s.page).filter(p => p);

    if (pages.length === 0) {
        return null;
    }
    
    return Math.max(...pages);
}

// ===== 4. MAIN FUNCTIONS =====
// show book details in the panel
async function showBook(book) {
    panel.replaceChildren();
    
    const cover = window.COVERS[book.goodreads_id];
    if (cover) {
        const img = document.createElement("img");
        img.src = cover;
        img.alt = book.title;
        img.className = "cover";
        panel.append(img);
    }

    addText(panel, "h2", book.title);
    addText(panel, "p", book.author);

    // a row for the editable fields
    const fields = document.createElement("div");
    fields.className = "fields";
    panel.append(fields);

    // dropdown to change book status, starting on its current one
    const statusPicker = document.createElement("select");
    for (const name of statuses) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        statusPicker.append(option);
    }
    statusPicker.value = book.status;
    addField(fields, "Status", statusPicker);

    // when new status, remember it, save it, redraw list
    statusPicker.addEventListener("change", async () => {
        book.status = statusPicker.value;
        await saveEdit(book.goodreads_id, { status: book.status });
        applyFilters();
    });

    // create rating box option
    const ratingBox = document.createElement("input");
    ratingBox.type = "number";
    ratingBox.min = 0;
    ratingBox.max = 5;
    ratingBox.step = 0.25;
    ratingBox.value = book.rating ?? "";
    addField(fields, "Rating", ratingBox);

    ratingBox.addEventListener("change", async () => {
        // inputs give text, so turn it into a number (or null if the box is empty)
        book.rating = ratingBox.value === "" ? null : Number(ratingBox.value);
        await saveEdit(book.goodreads_id, { rating: book.rating });
        applyFilters();
    });

    // create date read option
    const dateRead = document.createElement("input");
    dateRead.type = "date";
    dateRead.value = (book.date_read ?? "").replaceAll("/", "-");
    addField(fields, "Date read", dateRead);

    dateRead.addEventListener("change", async () => {
        // the picker gives dashes; store slashes like the rest of the data (or null if cleared)
        book.date_read = dateRead.value === "" ? null : dateRead.value.replaceAll("-", "/");
        await saveEdit(book.goodreads_id, { date_read: book.date_read });
        applyFilters();
    });

    if (book.series) {
        addText(panel, "p", book.series);
    }
    addText(panel, "p", book.synopsis);

    // --- log reading session ---

    const form = document.createElement("form");
    form.className = "logform";
    addText(form, "h3", "Log a session");

    const today = new Date().toLocaleDateString("en-CA"); // looks like 2026-10-23

    const sessionDate = document.createElement("input");
    sessionDate.type = "date";
    sessionDate.value = today;
    addField(form, "Date", sessionDate);

    const pageBox = document.createElement("input");
    pageBox.required = true;
    pageBox.type = "number";
    pageBox.min = 0;
    if (book.pages) {
        pageBox.max = book.pages;
    }
    addField(form, "Page reached", pageBox);

    const noteBox = document.createElement("textarea");
    addField(form, "Note", noteBox);

    // mood: a row of emoji buttons; the code remembers which one is picked
    const MOODS = ["😊", "😍", "😂", "🤔", "😢", "😱", "😤", "😴"];
    let mood = null;

    const moodRow = document.createElement("div");
    moodRow.className = "moods";
    for (const emoji of MOODS) {
        const button = document.createElement("button");
        button.type = "button"; // don't submit the form when clicked
        button.textContent = emoji;
        button.addEventListener("click", () => {
            // pick this mood, or clear it if it was already picked
            mood = mood === emoji ? null : emoji;
            // show which button is on
            for (const b of moodRow.children) {
                b.setAttribute("aria-pressed", b.textContent === mood);
            }
        });
        moodRow.append(button);
    }

    // a div, not a label, so clicking "Mood" doesn't press the first emoji
    const moodField = document.createElement("div");
    moodField.className = "field";
    addText(moodField, "span", "Mood");
    moodField.append(moodRow);
    form.append(moodField);

    // photo: pick one (or take one on a phone) and preview before save
    const photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = "image/*";
    addField(form, "Photo", photoInput);

    const preview = document.createElement("img");
    preview.className = "preview";
    preview.alt = "";
    preview.hidden = true;
    form.append(preview);

    photoInput.addEventListener("change", () => {
        const file = photoInput.files[0];
        if (!file) {
            preview.hidden = true;
            return;
        }
        preview.src = URL.createObjectURL(file);
        preview.hidden = false;
    });

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save session";
    form.append(saveButton);

    panel.append(form);

    // list the past sessions under the form

    const  sessionList = document.createElement("div");
    sessionList.className = "sessions";
    panel.append(sessionList);
    showSessions(book, sessionList); // no await: the rest of the panel doesn't wait for it

    // when the form is submitted, save the session as a new record
    form.addEventListener("submit", async (event) => {
        event.preventDefault(); // stop the browser reloading the page

        await db.sessions.add({
            bookId: book.goodreads_id,
            date: sessionDate.value.replaceAll("-", "/"),
            page: pageBox.value === "" ? null : Number(pageBox.value),
            note: noteBox.value,
            mood: mood,
            photo: photoInput.files[0] ? await shrinkPhoto(photoInput.files[0]) : null
        });

        // clear the form for next time, but keep today's date
        form.reset();
        sessionDate.value = today;

        // clear the mood too, and switch all the buttons off
        mood = null;
        for (const b of moodRow.children) {
            b.setAttribute("aria-pressed", false);
        }
        
        // make img space hidden by default
        preview.hidden = true;

        await showSessions(book, sessionList);

        // start the page box on where you're up to, so you only need to change it
        pageBox.value = (await highestPage(book)) ?? "";
    });

    pageBox.value = (await highestPage(book)) ?? "";
}

// Build one book's list item: cover, title, author, click to open
function makeItem(book) {
    const item = document.createElement("li");

    // small book cover on the left, or an empty box if there isn't one
    const cover = window.COVERS[book.goodreads_id];
    const thumb = document.createElement(cover ? "img" : "div");
    thumb.className = "thumb";
    if (cover) {
        thumb.src = cover;
        thumb.alt = "";
    }
    item.append(thumb);

    // title and author on the right
    const entry = document.createElement("div");
    entry.className = "entry";
    addText(entry, "span", book.title);
    addText(entry, "span", book.author);
    item.append(entry);

    // when clicked, highlight it and show the book in the panel
    item.addEventListener("click", () => {
        list.querySelector(".selected")?.classList.remove("selected");
        item.classList.add("selected");
        bookSelection = book;
        showBook(book);
    });

    // keep the highlight after a redraw
    if (book === bookSelection) {
        item.classList.add("selected");
    }

    return item;
}

// Draw a list of books on the page
function showList(booksToShow) {
    list.replaceChildren(); // empty the shelf first
    for (const book of booksToShow) {
        list.append(makeItem(book));
    }
}

// Draw books grouped under a shop's section headings
function showShopList(booksToShow, shop) {
    list.replaceChildren();

    // group: {"classics": [book, book], "Horror", [book],...}
    const groups = {};
    for (const book of booksToShow) {
        const section = book[shop] ?? "Unsorted";
        if (!groups[section]) {
            groups[section] = []; // first book in this section: start its list
        }
        groups[section].push(book);
    }

    // sections A-Z, but "not usually stocked" area at bottom 
    const sections = Object.keys(groups).sort();
    sections.sort((a, b) => (a === "Not usually stocked") - (b === "Not usually stocked"));

    for (const section of sections) {
        const heading = addText(list, "li", `${section} (${groups[section].length})`);
        heading.className = "shop-heading";

        for (const book of groups[section]) {
            const item = makeItem(book);
            // other places this book might be shelved in this shop
            const also = book[shop + "_also"] ?? [];
            if (also.length > 0) {
                addText(item.querySelector(".entry"), "span", "Also: " + also.join(", ")).className = "also";
            }

            // "Got it" marks the book as owned; tap again to undo
            const gotIt = document.createElement("button");
            gotIt.className = "got-it";
            gotIt.textContent = book.owned ? "Owned ✓" : "Got it";
            gotIt.addEventListener("click", async (event) => {
                event.stopPropagation(); // don't also count as clicking the book
                book.owned = !book.owned;
                await saveEdit(book.goodreads_id, { owned: book.owned });
                applyFilters();
            });
            item.append(gotIt);

            list.append(item);
        }
    }

}

// Filter by search, category and status, sort, then redraw
function applyFilters() {
    const text = search.value.toLowerCase();
    const category = categorySelect.value; // "" means "All categories"
    const status = statusSelect.value; 
    const owned = ownedSelect.value;
        
    const matches = books.filter(book => {
        // ?? "" is a guard: if the title/author is null (missing), use empty text instead,
        // so .toLowerCase() doesn't crash on a book with no data
        const matchesText =
            (book.title ?? "").toLowerCase().includes(text) ||
            (book.author ?? "").toLowerCase().includes(text);

        // either no category picked, or the book is in the picked one
        const matchesCategory = category === "" || book.category === category;

        const matchesStatus = status === "" || book.status === status;

        // all books, or only owned, or only not owned
        const matchesOwned =
            owned === "" ||
            (owned === "owned" && book.owned) ||
            (owned === "not-owned" && !book.owned);

        // the book only shows if it passes all three tests
        return matchesText && matchesCategory && matchesStatus && matchesOwned;
    });
    // sort the matching books by whatever the sort dropdown says
    const sortBy = sortSelect.value;

    if (sortBy === "title") {
        matches.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "author") {
        matches.sort((a, b) => a.author_sort.localeCompare(b.author_sort));
    } else if (sortBy === "added") {
        matches.sort((a, b) => b.date_added.localeCompare(a.date_added));
    } else if (sortBy === "rating") {
        matches.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    }

    const shop = shopSelect.value;
    // in shop mode, hide the panel and let the lsit use the full width
    mainArea.classList.toggle("shopping", shop !== "");
    if (shop) {
        showShopList(matches, shop);
    } else {
        showList(matches);
    }
}


// ===== 5. START-UP: set up the page when it opens =====
// category dropdown option filling
const categories = [...new Set(books.map(book => book.category))].sort();

for (const name of categories) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    categorySelect.append(option);
}

const statuses = [...new Set(books.map(book => book.status))].sort();

for (const stat of statuses) {
    const option = document.createElement("option");
    option.value = stat;
    option.textContent = stat;
    statusSelect.append(option);
     
}


//  draw the books when the page first loads, using the current filters and sort
applyFilters();


// ===== 6. EVENT LISTENERS: react to the user =====
// re-filter and re-sort whenever any control changes
search.addEventListener("input", applyFilters);
categorySelect.addEventListener("change", applyFilters);
statusSelect.addEventListener("change", applyFilters);
sortSelect.addEventListener("change", applyFilters);
shopSelect.addEventListener("change", applyFilters);
ownedSelect.addEventListener("change", applyFilters);