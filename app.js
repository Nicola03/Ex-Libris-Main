// Dexie: a friendly way to use the browser's built-in database (IndexedDB)
import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.mjs";


// ===== 1. LOAD DATA =====
// load the library json before starting
const response = await fetch("library.json");
const books = await response.json();


// ===== 1b. THE DATABASE ON THIS DEVICE =====
// One table, "edits": one record per book you've changed, found by its id
const db = new Dexie("exLibris");
db.version(1).stores({
    edits: "id"
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


// ===== 3. HELPERS =====
// helper function to create text for book information
function addText(parent, tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.append(element);
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

// ===== 4. MAIN FUNCTIONS =====
// show book details in the panel
function showBook(book) {
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
}

// Draw a list of books on the page
function showList(booksToShow) {
    list.replaceChildren(); // empty the shelf first

    for (const book of booksToShow) {
        // Make a new, empty list item (<li>) – not on the page yet
        const item = document.createElement("li");
        
        // small book cover on the left of the book, empty if none
        const cover = window.COVERS[book.goodreads_id];
        const thumb = document.createElement(cover ? "img" : "div");
        thumb.className = "thumb";
        if (cover) {
            thumb.src = cover;
            thumb.alt = "";
        }
        item.append(thumb);

        // title and author put on the right
        const entry = document.createElement("div");
        entry.className = "entry";
        addText(entry, "span", book.title);
        addText(entry, "span", book.author);
        item.append(entry);

        // when this item is clicked show this book in the panel
        item.addEventListener("click", () => {
            // remove the highlight from whichever book had it
            list.querySelector(".selected")?.classList.remove("selected");
            // highlight this one, then show its details
            item.classList.add("selected");
            showBook(book);
        });

        // Add the item to the unordered list <ul> so it appears on the page
        list.append(item);
    }
}

// Filter by search, category and status, sort, then redraw
function applyFilters() {
    const text = search.value.toLowerCase();
    const category = categorySelect.value; // "" means "All categories"
    const status = statusSelect.value; 

    const matches = books.filter(book => {
        // ?? "" is a guard: if the title/author is null (missing), use empty text instead,
        // so .toLowerCase() doesn't crash on a book with no data
        const matchesText =
            (book.title ?? "").toLowerCase().includes(text) ||
            (book.author ?? "").toLowerCase().includes(text);

        // either no category picked, or the book is in the picked one
        const matchesCategory = category === "" || book.category === category;

        const matchesStatus = status === "" || book.status === status;

        // the book only shows if it passes all three tests
        return matchesText && matchesCategory && matchesStatus;
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

    showList(matches);
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