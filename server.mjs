/* ============================================================================
   baogia.vtec.food — máy chủ một tệp, không phụ thuộc gói ngoài.
   /          trang báo giá (nội dung đã sửa nhét sẵn vào window.NOIDUNG)
   /cai-dat   cùng trang nhưng bật bộ sửa (sau khi nhập mật khẩu)
   /media/*   tệp mặc định (public/media) + tệp đã tải lên (du-lieu/media)
   /api/*     lưu nội dung, nhận tệp, nhận khách để lại số
   ============================================================================ */
import http from "node:http";
import https from "node:https";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync, createWriteStream, appendFileSync, unlinkSync, createReadStream, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.dirname(fileURLToPath(import.meta.url));
const DL = path.join(GOC, "du-lieu");
mkdirSync(path.join(DL, "media"), { recursive: true });

// .env: PORT, MATKHAU, BIMAT
const env = {};
if (existsSync(path.join(GOC, ".env")))
  for (const d of readFileSync(path.join(GOC, ".env"), "utf8").split("\n")) {
    const m = d.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
const PORT = +(env.PORT || 3077);
const MATKHAU = env.MATKHAU || "";
const BIMAT = env.BIMAT || "";
if (!MATKHAU || !BIMAT) { console.error("Thiếu MATKHAU/BIMAT trong .env"); process.exit(1); }

const kyPhien = (hetHan) => hetHan + "." + createHmac("sha256", BIMAT).update(String(hetHan)).digest("hex");
const phienOk = (cookie) => {
  const m = /(?:^|;\s*)phien=([0-9]+)\.([0-9a-f]{64})/.exec(cookie || ""); if (!m) return false;
  if (+m[1] < Date.now()) return false;
  const dung = createHmac("sha256", BIMAT).update(m[1]).digest("hex");
  try { return timingSafeEqual(Buffer.from(m[2]), Buffer.from(dung)); } catch { return false; }
};
const soSanhMK = (thu) => {
  const a = Buffer.from(String(thu)), b = Buffer.from(MATKHAU);
  return a.length === b.length && timingSafeEqual(a, b);
};

const MIME = { html:"text/html; charset=utf-8", webp:"image/webp", jpg:"image/jpeg", jpeg:"image/jpeg",
  png:"image/png", svg:"image/svg+xml", mp4:"video/mp4", webm:"video/webm", mov:"video/quicktime",
  json:"application/json; charset=utf-8", ico:"image/x-icon" };
const guiTep = (res, tep) => {
  const duoi = tep.split(".").pop().toLowerCase();
  const st = statSync(tep);
  let ct = MIME[duoi] || "application/octet-stream";
  // Nhận diện ảnh theo byte đầu (ảnh AI png lưu vào .jpg vẫn phục vụ đúng kiểu)
  try {
    const fd = openSync(tep, "r"); const hd = Buffer.alloc(12); readSync(fd, hd, 0, 12, 0); closeSync(fd);
    if (hd[0] === 0x89 && hd[1] === 0x50) ct = "image/png";
    else if (hd[0] === 0xFF && hd[1] === 0xD8) ct = "image/jpeg";
    else if (hd.slice(0, 4).toString("latin1") === "RIFF" && hd.slice(8, 12).toString("latin1") === "WEBP") ct = "image/webp";
    else if (hd.slice(0, 3).toString("latin1") === "GIF") ct = "image/gif";
  } catch {}
  res.writeHead(200, { "Content-Type": ct, "Content-Length": st.size, "Cache-Control": "public, max-age=3600" });
  createReadStream(tep).pipe(res);
};
const docThan = (req, max = 1024 * 1024) => new Promise((ok, loi) => {
  let n = 0; const phan = [];
  req.on("data", (c) => { n += c.length; if (n > max) { loi(new Error("to-qua")); req.destroy(); } else phan.push(c); });
  req.on("end", () => ok(Buffer.concat(phan))); req.on("error", loi);
});
// Tải một tệp qua HTTPS (dùng cho tự cập nhật từ GitHub công khai), theo chuyển hướng.
const taiGit = (url, lan = 0) => new Promise((ok, loi) => {
  if (lan > 4) return loi(new Error("Chuyển hướng quá nhiều"));
  https.get(url, { headers: { "User-Agent": "baogia-vtec-selfupdate" } }, (r) => {
    if ([301, 302, 307, 308].includes(r.statusCode) && r.headers.location) { r.resume(); return taiGit(r.headers.location, lan + 1).then(ok, loi); }
    if (r.statusCode !== 200) { r.resume(); return loi(new Error("GitHub trả " + r.statusCode)); }
    const ch = []; r.on("data", (c) => ch.push(c)); r.on("end", () => ok(Buffer.concat(ch)));
  }).on("error", loi);
});
// Gọi HTTPS tổng quát (POST JSON / multipart tới OpenAI). Trả { status, buf }.
const goiHTTPS = (urlStr, { method = "GET", headers = {}, body = null } = {}) => new Promise((ok, loi) => {
  const uu = new URL(urlStr);
  const r = https.request({ hostname: uu.hostname, path: uu.pathname + uu.search, method, headers, port: 443 }, (rp) => {
    const ch = []; rp.on("data", (c) => ch.push(c)); rp.on("end", () => ok({ status: rp.statusCode, buf: Buffer.concat(ch) }));
  });
  r.on("error", loi);
  r.setTimeout(180000, () => r.destroy(new Error("API quá lâu (180s)")));
  if (body) r.write(body);
  r.end();
});
// Khoá AI: ưu tiên du-lieu/ai-key.txt (đặt qua trang quản lý), rồi .env OPENAI_API_KEY
const docKhoaAI = () => {
  try { const f = path.join(DL, "ai-key.txt"); if (existsSync(f)) return readFileSync(f, "utf8").trim(); } catch {}
  return (env.OPENAI_API_KEY || "").trim();
};
const slotHopLe = (s) => {
  const ten = path.basename(String(s || "").replace(/[^\w.\-]+/g, "-"));
  const duoi = ten.split(".").pop().toLowerCase();
  return (ten && !ten.startsWith(".") && ["jpg", "jpeg", "png", "webp"].includes(duoi)) ? ten : null;
};
// ---- Google Gemini (tạo & sửa ảnh) ----
const GEMINI_MODEL = () => env.GEMINI_MODEL || "gemini-2.5-flash-image";
const geminiURL = () => "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL() + ":generateContent";
const tyLeHint = (size) => size === "1536x1024" ? "16:9 (ngang)" : size === "1024x1536" ? "9:16 (dọc)" : "1:1 (vuông)";
const goiGemini = async (khoa, parts) => {
  const body = JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } });
  const rp = await goiHTTPS(geminiURL(), { method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": khoa, "Content-Length": Buffer.byteLength(body) }, body });
  let j = null; try { j = JSON.parse(rp.buf.toString()); } catch {}
  if (rp.status !== 200) return { ok: false, loi: (j && j.error && j.error.message) || ("Gemini lỗi " + rp.status) };
  const ps = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const img = ps.find((p) => (p.inlineData && p.inlineData.data) || (p.inline_data && p.inline_data.data));
  if (!img) {
    const txt = ps.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
    const block = j && j.promptFeedback && j.promptFeedback.blockReason;
    return { ok: false, loi: block ? ("Bị chặn: " + block) : (txt || "Gemini không trả ảnh") };
  }
  const d = img.inlineData || img.inline_data;
  const mime = d.mimeType || d.mime_type || "image/png";
  return { ok: true, b64: d.data, fmt: mime.includes("jpeg") ? "jpeg" : mime.includes("webp") ? "webp" : "png" };
};
// Kho GitHub công khai để tự cập nhật trang (có thể đổi nhánh qua .env GH_NHANH)
const GH_REPO = "abasochung-collab/vtec";
// Các trang tĩnh trong public/ được phép tự cập nhật từ GitHub. dau = chuỗi bắt buộc để kiểm hợp lệ.
const TRANG_CAP_NHAT = [
  { ten: "trang.html", dau: "<!--NOIDUNG-->" },
  { ten: "1.html", dau: "<!doctype html" },
  { ten: "2.html", dau: "<!doctype html" },
  { ten: "cai-dat-media.html", dau: "<!doctype html" },
];
const trang = (cheDo) => {
  let s = readFileSync(path.join(GOC, "public", "trang.html"), "utf8");
  let nd = { chu: {}, media: {} };
  const tepND = path.join(DL, "noidung.json");
  if (existsSync(tepND)) { try { nd = JSON.parse(readFileSync(tepND, "utf8")); } catch {} }
  return s.replace("<!--NOIDUNG-->", `<script>window.NOIDUNG=${JSON.stringify(nd)};</script>`)
          .replace("<!--CHEDO-->", `<script>window.CHE_DO=${JSON.stringify(cheDo)};</script>`);
};
const trangDangNhap = (sai) => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Cài đặt bảng giá VTEC</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui;background:#08194A;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" action="/api/dang-nhap" style="display:grid;gap:12px;width:min(320px,86vw)">
<h1 style="font-size:20px;margin:0">Cài đặt bảng giá VTEC</h1>
${sai ? '<div style="background:#FFC42E;color:#51380A;padding:8px 10px;font-size:13px">Mật khẩu chưa đúng</div>' : ""}
<input type="password" name="matkhau" placeholder="Mật khẩu" autofocus
 style="padding:12px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.1);color:#fff;font-size:15px">
<button style="padding:12px;background:#33A6DC;border:0;color:#06243B;font-weight:700;font-size:14px;cursor:pointer">Vào trang cài đặt</button>
</form></body></html>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const coPhien = phienOk(req.headers.cookie);
  const tu401 = () => { res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Chưa đăng nhập /cai-dat"); };
  try {
    if (req.method === "GET" && u.pathname === "/") { res.writeHead(200, { "Content-Type": MIME.html, "Cache-Control": "no-store" }); return res.end(trang("xem")); }
    if (req.method === "GET" && u.pathname === "/cai-dat") {
      res.writeHead(200, { "Content-Type": MIME.html, "Cache-Control": "no-store" });
      return res.end(coPhien ? trang("sua") : trangDangNhap(u.searchParams.has("sai")));
    }
    if (req.method === "POST" && u.pathname === "/api/dang-nhap") {
      const than = (await docThan(req, 4096)).toString();
      const mk = decodeURIComponent((than.match(/matkhau=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
      if (!soSanhMK(mk)) { res.writeHead(303, { Location: "/cai-dat?sai" }); return res.end(); }
      const an = (req.headers["x-forwarded-proto"] === "https") ? "; Secure" : "";
      res.writeHead(303, { Location: "/cai-dat",
        "Set-Cookie": `phien=${kyPhien(Date.now() + 30 * 864e5)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${an}` });
      return res.end();
    }
    if (u.pathname === "/api/noidung") {
      if (req.method === "GET") { res.writeHead(200, { "Content-Type": MIME.json });
        return res.end(existsSync(path.join(DL, "noidung.json")) ? readFileSync(path.join(DL, "noidung.json")) : "{}"); }
      if (!coPhien) return tu401();
      if (req.method === "POST") {
        const than = await docThan(req, 2 * 1024 * 1024);
        JSON.parse(than.toString()); // phải là JSON hợp lệ
        writeFileSync(path.join(DL, "noidung.json"), than);
        res.writeHead(200); return res.end("ok");
      }
      if (req.method === "DELETE") {
        if (existsSync(path.join(DL, "noidung.json"))) unlinkSync(path.join(DL, "noidung.json"));
        res.writeHead(200); return res.end("ok");
      }
    }
    // Vị trí hiển thị (object-position) của ảnh/poster trong /1, /2 — GET công khai để trang áp, POST cần đăng nhập
    if (u.pathname === "/api/vitri") {
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": MIME.json });
        return res.end(existsSync(path.join(DL, "vitri.json")) ? readFileSync(path.join(DL, "vitri.json")) : "{}");
      }
      if (!coPhien) return tu401();
      if (req.method === "POST") {
        const than = await docThan(req, 256 * 1024);
        const o = JSON.parse(than.toString()); // phải là JSON hợp lệ
        writeFileSync(path.join(DL, "vitri.json"), JSON.stringify(o));
        res.writeHead(200); return res.end("ok");
      }
    }
    // ===== AI ảnh (OpenAI gpt-image-1) =====
    // Khoá AI: GET → đã cài chưa (không trả khoá); POST {khoa} → lưu/xoá
    if (u.pathname === "/api/ai-key") {
      if (!coPhien) return tu401();
      if (req.method === "GET") { res.writeHead(200, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ co: !!docKhoaAI() })); }
      if (req.method === "POST") {
        const o = JSON.parse((await docThan(req, 16 * 1024)).toString());
        const k = String(o.khoa || "").trim();
        if (!k) { try { unlinkSync(path.join(DL, "ai-key.txt")); } catch {} }
        else writeFileSync(path.join(DL, "ai-key.txt"), k);
        res.writeHead(200, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ co: !!k }));
      }
    }
    // Tạo ảnh mới từ mô tả → trả b64 để xem trước (chưa lưu)
    if (req.method === "POST" && u.pathname === "/api/ai-tao") {
      if (!coPhien) return tu401();
      const o = JSON.parse((await docThan(req, 64 * 1024)).toString());
      const khoa = docKhoaAI();
      if (!khoa) { res.writeHead(400, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: "Chưa cài khoá AI" })); }
      const size = ["1024x1024", "1536x1024", "1024x1536"].includes(o.size) ? o.size : "1024x1024";
      const mota = String(o.mota || "").slice(0, 4000);
      if (!mota.trim()) { res.writeHead(400, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: "Thiếu mô tả" })); }
      const kq = await goiGemini(khoa, [{ text: mota + "\n\nHãy tạo một hình ảnh, tỉ lệ khung " + tyLeHint(size) + "." }]);
      if (!kq.ok) { res.writeHead(502, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: kq.loi })); }
      res.writeHead(200, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: true, b64: kq.b64, fmt: kq.fmt }));
    }
    // Sửa ảnh có sẵn (xoá/đổi nền, mở rộng, nâng nét…) theo mô tả → trả b64 xem trước
    if (req.method === "POST" && u.pathname === "/api/ai-sua") {
      if (!coPhien) return tu401();
      const o = JSON.parse((await docThan(req, 64 * 1024)).toString());
      const khoa = docKhoaAI();
      if (!khoa) { res.writeHead(400, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: "Chưa cài khoá AI" })); }
      const nguonTen = path.basename(String(o.nguon || "").replace(/[^\w.\-]+/g, "-"));
      const nguonPath = [path.join(DL, "media", nguonTen), path.join(GOC, "public", "media", nguonTen)].find(existsSync);
      if (!nguonTen || !nguonPath) { res.writeHead(400, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: "Chưa có ảnh nguồn — tải ảnh lên ô này trước" })); }
      const mota = String(o.mota || "").slice(0, 4000);
      if (!mota.trim()) { res.writeHead(400, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: "Thiếu mô tả chỉnh sửa" })); }
      const anhBuf = readFileSync(nguonPath);
      const duoi = nguonTen.split(".").pop().toLowerCase();
      const srcMime = (MIME[duoi] || "image/jpeg").split(";")[0];
      const kq = await goiGemini(khoa, [{ text: mota }, { inlineData: { mimeType: srcMime, data: anhBuf.toString("base64") } }]);
      if (!kq.ok) { res.writeHead(502, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: false, loi: kq.loi })); }
      res.writeHead(200, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: true, b64: kq.b64, fmt: kq.fmt }));
    }
    // Lưu ảnh base64 (ảnh AI đã xem trước) vào đúng ô
    if (req.method === "POST" && u.pathname === "/api/tep-b64") {
      if (!coPhien) return tu401();
      const slot = slotHopLe(u.searchParams.get("ten"));
      if (!slot) { res.writeHead(400); return res.end("Tên ô không hợp lệ"); }
      const o = JSON.parse((await docThan(req, 25 * 1024 * 1024)).toString());
      const b64 = String(o.b64 || "").replace(/^data:[^,]+,/, "");
      if (!b64) { res.writeHead(400); return res.end("Thiếu dữ liệu ảnh"); }
      writeFileSync(path.join(DL, "media", slot), Buffer.from(b64, "base64"));
      res.writeHead(200, { "Content-Type": MIME.json }); return res.end(JSON.stringify({ ok: true, url: "/media/" + slot }));
    }
    if (req.method === "POST" && u.pathname === "/api/tep") {
      if (!coPhien) return tu401();
      const goc = (u.searchParams.get("ten") || "tep").replace(/[^\w.\-]+/g, "-").slice(-80);
      const duoi = goc.split(".").pop().toLowerCase();
      if (!["webp","jpg","jpeg","png","mp4","webm","mov"].includes(duoi)) { res.writeHead(400); return res.end("Chỉ nhận ảnh webp/jpg/png và video mp4/webm/mov"); }
      const ten = Date.now().toString(36) + "-" + goc;
      const dich = path.join(DL, "media", ten);
      const ghi = createWriteStream(dich);
      let n = 0, qua = false;
      req.on("data", (c) => { n += c.length; if (n > 200 * 1024 * 1024 && !qua) { qua = true; ghi.destroy(); req.destroy(); } });
      req.pipe(ghi);
      await new Promise((ok, loi) => { ghi.on("finish", ok); ghi.on("error", loi); req.on("error", loi); });
      if (qua) { try { unlinkSync(dich); } catch {} res.writeHead(413); return res.end("Tệp quá 200MB"); }
      res.writeHead(200, { "Content-Type": MIME.json });
      return res.end(JSON.stringify({ url: "/media/" + ten }));
    }
    if (req.method === "POST" && u.pathname === "/api/lien-he") {
      const than = await docThan(req, 10 * 1024);
      const d = JSON.parse(than.toString());
      appendFileSync(path.join(DL, "lien-he.jsonl"),
        JSON.stringify({ ten: String(d.ten||"").slice(0,200), sdt: String(d.sdt||"").slice(0,30),
          quanTam: String(d.quanTam||"").slice(0,100), luc: new Date().toISOString() }) + "\n");
      res.writeHead(200); return res.end("ok");
    }
    if (req.method === "GET" && u.pathname === "/api/lien-he") {
      if (!coPhien) return tu401();
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(existsSync(path.join(DL, "lien-he.jsonl")) ? readFileSync(path.join(DL, "lien-he.jsonl")) : "(chưa có ai để lại số)");
    }
    // Tự cập nhật: VPS tự tải trang.html mới nhất từ GitHub công khai và thay tại chỗ.
    // Chỉ chủ trang (đã đăng nhập /cai-dat) gọi được. KHÔNG đụng server.mjs để tránh hỏng máy chủ.
    if (req.method === "POST" && u.pathname === "/api/cap-nhat") {
      if (!coPhien) return tu401();
      const nhanh = env.GH_NHANH || "main";
      const kq = [];
      for (const t of TRANG_CAP_NHAT) {
        const nguon = "https://raw.githubusercontent.com/" + GH_REPO + "/" + encodeURIComponent(nhanh) + "/public/" + t.ten;
        try {
          const buf = await taiGit(nguon);
          const html = buf.toString("utf8");
          if (buf.length < 2048 || !/<!doctype html/i.test(html) || (t.dau && !html.includes(t.dau))) {
            kq.push({ ten: t.ten, ok: false, loi: "tệp không hợp lệ" }); continue;
          }
          const dich = path.join(GOC, "public", t.ten);
          const cu = existsSync(dich) ? statSync(dich).size : 0;
          try { if (existsSync(dich)) writeFileSync(dich + ".bak", readFileSync(dich)); } catch {}
          writeFileSync(dich, buf);
          kq.push({ ten: t.ten, ok: true, cu, moi: buf.length });
        } catch (e) { kq.push({ ten: t.ten, ok: false, loi: e.message }); }
      }
      const soOk = kq.filter((x) => x.ok).length;
      res.writeHead(soOk ? 200 : 502, { "Content-Type": MIME.json });
      return res.end(JSON.stringify({ ok: soOk > 0, nhanh, soOk, moi: (kq.find((x) => x.ok && x.ten === "trang.html") || {}).moi, ketQua: kq }));
    }
    {
      const mTrang = u.pathname.match(/^\/([12])\/?$/); // /1, /2 → public/1.html, public/2.html
      if (req.method === "GET" && mTrang) {
        const tep = path.join(GOC, "public", mTrang[1] + ".html");
        if (existsSync(tep)) { res.writeHead(200, { "Content-Type": MIME.html, "Cache-Control": "no-store" }); return res.end(readFileSync(tep)); }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Chưa có trang này");
      }
    }
    // Trang quản lý media cho /1, /2 (chỉ chủ trang đã đăng nhập)
    if (req.method === "GET" && u.pathname === "/cai-dat/media") {
      if (!coPhien) { res.writeHead(303, { Location: "/cai-dat" }); return res.end(); }
      const tep = path.join(GOC, "public", "cai-dat-media.html");
      if (existsSync(tep)) { res.writeHead(200, { "Content-Type": MIME.html, "Cache-Control": "no-store" }); return res.end(readFileSync(tep)); }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Chưa có trang quản lý media");
    }
    // Tải tệp lên đúng tên (ghi đè ô media cố định của /1, /2). Lưu vào du-lieu/media để /media/<ten> phục vụ.
    if (req.method === "POST" && u.pathname === "/api/tep-ten") {
      if (!coPhien) return tu401();
      const ten = path.basename((u.searchParams.get("ten") || "").replace(/[^\w.\-]+/g, "-"));
      const duoi = ten.split(".").pop().toLowerCase();
      if (!ten || ten.startsWith(".") || !["webp", "jpg", "jpeg", "png", "gif", "mp4", "webm", "mov"].includes(duoi)) {
        res.writeHead(400); return res.end("Tên tệp không hợp lệ");
      }
      const dich = path.join(DL, "media", ten);
      const ghi = createWriteStream(dich);
      let n = 0, qua = false;
      req.on("data", (c) => { n += c.length; if (n > 200 * 1024 * 1024 && !qua) { qua = true; ghi.destroy(); req.destroy(); } });
      req.pipe(ghi);
      await new Promise((ok, loi) => { ghi.on("finish", ok); ghi.on("error", loi); req.on("error", loi); });
      if (qua) { try { unlinkSync(dich); } catch {} res.writeHead(413); return res.end("Tệp quá 200MB"); }
      res.writeHead(200, { "Content-Type": MIME.json });
      return res.end(JSON.stringify({ ok: true, url: "/media/" + ten }));
    }
    if (req.method === "GET" && u.pathname.startsWith("/media/")) {
      const ten = path.basename(u.pathname); // chặn ../
      for (const thu of [path.join(DL, "media", ten), path.join(GOC, "public", "media", ten)])
        if (existsSync(thu)) return guiTep(res, thu);
      res.writeHead(404); return res.end("Không có tệp này");
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Không có trang này");
  } catch (e) {
    res.writeHead(e.message === "to-qua" ? 413 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Lỗi: " + e.message);
  }
}).listen(PORT, "127.0.0.1", () => console.log("baogia.vtec.food chạy ở cổng " + PORT));
