import { createServer } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = process.env.DATA_DIR || join(root, "data");
const uploadsDir = join(dataDir, "uploads");
const catalogFile = join(dataDir, "catalog.json");
const maxUploadBytes = 500 * 1024 * 1024;
const allowedExtensions = new Set([
  ".exe", ".msi", ".msix", ".dmg", ".pkg", ".zip", ".7z", ".rar",
  ".tar", ".gz", ".deb", ".rpm", ".appimage", ".apk", ".jar", ".iso",
]);
const categories = new Set(["Productivity", "Development", "Design", "Utilities", "Security", "Other"]);
const adminToken = process.env.ADMIN_TOKEN || "";

if (process.env.NODE_ENV === "production" && !adminToken) {
  throw new Error("Set ADMIN_TOKEN before starting Softspace in production.");
}
if (process.env.NODE_ENV === "production" && adminToken.length < 32) {
  throw new Error("ADMIN_TOKEN must be at least 32 characters in production.");
}

await mkdir(uploadsDir, { recursive: true });
let catalog = [];
try {
  const saved = JSON.parse(await readFile(catalogFile, "utf8"));
  if (Array.isArray(saved)) catalog = saved;
} catch (error) {
  if (error.code !== "ENOENT") console.error("Could not read catalog:", error);
}

let saveQueue = Promise.resolve();
function saveCatalog() {
  const snapshot = JSON.stringify(catalog, null, 2);
  saveQueue = saveQueue.then(() => writeFile(catalogFile, snapshot, "utf8"));
  return saveQueue;
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function contentDisposition(name) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function isAdmin(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!match || !adminToken) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(adminToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(req, maxBytes = 2048) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const app = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return json(res, 400, { error: "Invalid request URL." });
  }

  if (url.pathname === "/api/software" && req.method === "GET") {
    return json(res, 200, catalog.filter((item) => item.status === "approved" || !item.status));
  }

  if (url.pathname === "/api/review" && req.method === "GET") {
    if (!isAdmin(req)) return json(res, 401, { error: "Admin access is required." });
    return json(res, 200, catalog.filter((item) => item.status === "pending"));
  }

  const reviewMatch = url.pathname.match(/^\/api\/software\/([\da-f-]+)\/review$/i);
  if (reviewMatch && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 401, { error: "Admin access is required." });
    let body;
    try { body = await readJson(req); } catch { return json(res, 400, { error: "Invalid review request." }); }
    if (body.action !== "approve" && body.action !== "reject") {
      return json(res, 400, { error: "Choose approve or reject." });
    }
    const item = catalog.find((entry) => entry.id === reviewMatch[1]);
    if (!item || item.status !== "pending") return json(res, 404, { error: "This pending upload could not be found." });
    item.status = body.action === "approve" ? "approved" : "rejected";
    await saveCatalog();
    return json(res, 200, { id: item.id, status: item.status });
  }

  if (url.pathname === "/api/software" && req.method === "POST") {
    if (process.env.NODE_ENV === "production" && catalog.filter((item) => item.status === "pending").length >= 20) {
      req.resume();
      return json(res, 429, { error: "The review queue is full. Please try again later." });
    }
    const fileNameHeader = req.headers["x-file-name"];
    let fileName = "";
    try { fileName = decodeURIComponent(String(fileNameHeader ?? "")); } catch { /* reported below */ }
    const extension = extname(fileName).toLowerCase();
    const title = cleanText(url.searchParams.get("title"), 72);
    const description = cleanText(url.searchParams.get("description"), 240);
    const version = cleanText(url.searchParams.get("version"), 32);
    const category = cleanText(url.searchParams.get("category"), 32);
    const platform = cleanText(url.searchParams.get("platform"), 32);
    const author = cleanText(url.searchParams.get("author"), 40) || "Community";

    if (!fileName || !allowedExtensions.has(extension)) {
      return json(res, 415, { error: "Choose a supported installer or software archive." });
    }
    if (title.length < 2 || description.length < 8 || !version || !categories.has(category) || !platform) {
      return json(res, 400, { error: "Add a name, description, version, category, and platform." });
    }
    const declaredBytes = Number(req.headers["content-length"] || 0);
    if (declaredBytes > maxUploadBytes) {
      req.resume();
      return json(res, 413, { error: "Files must be smaller than 500 MB." });
    }
    try {
      const disk = await statfs(uploadsDir);
      const availableBytes = Number(disk.bavail) * Number(disk.bsize);
      if (declaredBytes && declaredBytes + 25 * 1024 * 1024 > availableBytes) {
        req.resume();
        return json(res, 507, { error: "There is not enough storage space for this upload." });
      }
    } catch (error) {
      console.error("Could not check upload storage:", error);
      return json(res, 500, { error: "Upload storage is unavailable." });
    }

    const id = randomUUID();
    const storageName = `${id}${extension}`;
    const storagePath = join(uploadsDir, storageName);
    let size = 0;
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > maxUploadBytes) {
          const error = new Error("Files must be smaller than 500 MB.");
          error.code = "UPLOAD_LIMIT";
          callback(error);
        } else callback(null, chunk);
      },
    });

    try {
      await pipeline(req, meter, createWriteStream(storagePath, { flags: "wx" }));
      if (size === 0) throw new Error("The selected file is empty.");
      const item = {
        id,
        title,
        description,
        version,
        category,
        platform,
        author,
        fileName: fileName.split(/[\\/]/).pop().replace(/[\r\n]/g, "_").slice(0, 180),
        size,
        downloads: 0,
        createdAt: new Date().toISOString(),
        status: process.env.NODE_ENV === "production" ? "pending" : "approved",
      };
      catalog.unshift(item);
      await saveCatalog();
      return json(res, 201, item);
    } catch (error) {
      await rm(storagePath, { force: true }).catch(() => {});
      if (error.code === "UPLOAD_LIMIT") return json(res, 413, { error: "Files must be smaller than 500 MB." });
      if (error.message === "The selected file is empty.") return json(res, 400, { error: error.message });
      console.error("Upload failed:", error);
      if (!res.headersSent && !res.destroyed) return json(res, 500, { error: "The upload could not be saved. Please try again." });
      return;
    }
  }

  const downloadMatch = url.pathname.match(/^\/api\/software\/([\da-f-]+)\/download$/i);
  if (downloadMatch && req.method === "GET") {
    const item = catalog.find((entry) => entry.id === downloadMatch[1]);
    if (!item || (item.status && item.status !== "approved")) return json(res, 404, { error: "This software could not be found." });
    const filePath = join(uploadsDir, `${item.id}${extname(item.fileName).toLowerCase()}`);
    try {
      const fileInfo = await stat(filePath);
      item.downloads += 1;
      await saveCatalog();
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": fileInfo.size,
        "content-disposition": contentDisposition(item.fileName),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      return createReadStream(filePath).pipe(res);
    } catch (error) {
      if (error.code === "ENOENT") return json(res, 404, { error: "The uploaded file is no longer available." });
      console.error("Download failed:", error);
      return json(res, 500, { error: "The file could not be downloaded." });
    }
  }

  if (req.method === "GET") {
    const staticFiles = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/index.html": ["index.html", "text/html; charset=utf-8"],
      "/styles.css": ["styles.css", "text/css; charset=utf-8"],
      "/app.js": ["app.js", "text/javascript; charset=utf-8"],
      "/review": ["review.html", "text/html; charset=utf-8"],
      "/review.html": ["review.html", "text/html; charset=utf-8"],
      "/review.js": ["review.js", "text/javascript; charset=utf-8"],
    };
    const file = staticFiles[url.pathname];
    if (file) {
      try {
        const contents = await readFile(join(publicDir, file[0]));
        res.writeHead(200, { "content-type": file[1], "cache-control": "no-cache", "x-content-type-options": "nosniff" });
        return res.end(contents);
      } catch (error) {
        console.error("Could not serve site:", error);
        return json(res, 500, { error: "The site could not be loaded." });
      }
    }
  }

  return json(res, 404, { error: "Not found." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Softspace is ready at http://localhost:${port}`);
});
